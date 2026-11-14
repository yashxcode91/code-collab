import crypto from 'crypto';
import {
  CodebaseIndexStatusDto,
  RAG_LIMITS,
  SemanticSearchRequestDto,
  SemanticSearchResponseDto,
  SemanticSearchResultDto,
} from '@codecollab/shared';
import { prisma } from '@codecollab/database';
import { chunkSourceFile } from './chunker';
import { getEmbeddingProvider } from './providers/embedding.provider';
import { resolveInheritedOverride } from '../projects/project.service';

// =====================================================================
// Codebase Indexing & Semantic Search Service (pgvector RAG)
// =====================================================================

export class CodebaseIndexService {
  /**
   * Retrieves the current or latest indexing task status for a given branch.
   */
  public static async getBranchIndexStatus(
    projectId: string,
    branchId: string
  ): Promise<CodebaseIndexStatusDto> {
    const latestTask = await prisma.codebaseIndexTask.findFirst({
      where: { projectId, branchId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestTask) {
      return {
        status: 'IDLE',
        totalFiles: 0,
        indexedFiles: 0,
        totalChunks: 0,
      };
    }

    return {
      taskId: latestTask.id,
      status: latestTask.status,
      totalFiles: latestTask.totalFiles,
      indexedFiles: latestTask.indexedFiles,
      totalChunks: latestTask.totalChunks,
      lastIndexedAt: (latestTask.completedAt ?? latestTask.updatedAt).toISOString(),
      errorMessage: latestTask.errorMessage,
    };
  }

  /**
   * Triggers an asynchronous or immediate codebase indexing job for a branch.
   *
   * Invariants enforced:
   * 1. Unique active task lock: Rejects concurrent indexing if a task is already PENDING/PROCESSING.
   * 2. Hash-based incremental indexing: Unmodified chunks are not re-embedded.
   * 3. Pruning: Obsolete trailing chunks from truncated files are removed.
   */
  public static async triggerBranchIndexing(
    projectId: string,
    branchId: string,
    requestedById: string,
    forceReindex = false
  ): Promise<{ taskId: string; alreadyRunning: boolean }> {
    // Check if an indexing task is already running or pending on this branch
    const existingActive = await prisma.codebaseIndexTask.findFirst({
      where: {
        branchId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (existingActive) {
      return { taskId: existingActive.id, alreadyRunning: true };
    }

    // Recover any stale tasks on the branch before creating a new one
    await this.recoverStaleTasks(branchId);

    const task = await prisma.codebaseIndexTask.create({
      data: {
        projectId,
        branchId,
        requestedById,
        status: 'PENDING',
      },
    });

    // Execute background indexing pipeline
    // In Node runtime, process asynchronously so the HTTP response returns immediately
    const indexingPromise = this.processIndexingJob(task.id, forceReindex);

    // In unit test environments, we await completion so assertions can verify state synchronously
    if (process.env.NODE_ENV === 'test') {
      await indexingPromise;
    } else {
      indexingPromise.catch((err) => {
        console.error(`[CodebaseIndexer] Error executing job ${task.id}:`, err);
      });
    }

    return { taskId: task.id, alreadyRunning: false };
  }

  /**
   * Worker pipeline that chunks branch files, computes hashes, invokes the embedding
   * adapter, and upserts vectors into `codebase_embeddings` with pgvector.
   */
  public static async processIndexingJob(
    taskId: string,
    forceReindex = false
  ): Promise<void> {
    const task = await prisma.codebaseIndexTask.findUnique({
      where: { id: taskId },
      include: {
        branch: {
          include: {
            files: {
              where: { nodeType: 'FILE' },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });

    if (!task) {
      return;
    }

    const { projectId, branchId } = task;
    const files = task.branch.files;
    const provider = getEmbeddingProvider();

    await prisma.codebaseIndexTask.update({
      where: { id: taskId },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
        totalFiles: files.length,
        indexedFiles: 0,
        totalChunks: 0,
      },
    });

    try {
      let cumulativeChunks = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Skip files that exceed indexing size threshold (250 KB)
        if (Buffer.byteLength(file.content, 'utf8') > RAG_LIMITS.MAX_FILE_BYTES_FOR_INDEXING) {
          await prisma.codebaseIndexTask.update({
            where: { id: taskId },
            data: { indexedFiles: i + 1 },
          });
          continue;
        }

        // Chunk file
        const chunks = chunkSourceFile(file.id, file.name, file.content);

        // Fetch existing chunk hashes for this file
        const existingEmbeddings = await prisma.codebaseEmbedding.findMany({
          where: { fileId: file.id },
          select: { chunkIndex: true, contentHash: true },
        });

        const existingHashMap = new Map<number, string>(
          existingEmbeddings.map((e) => [e.chunkIndex, e.contentHash])
        );

        for (const chunk of chunks) {
          const isUnchanged =
            !forceReindex &&
            existingHashMap.get(chunk.chunkIndex) === chunk.contentHash;

          if (isUnchanged) {
            // Already has valid vector in database with matching SHA-256 hash
            continue;
          }

          // Generate vector embedding
          const embeddingVector = await provider.embedText(chunk.content);
          const vectorSqlString = `[${embeddingVector.join(',')}]`;
          const recordId = crypto.randomUUID();

          // Raw pgvector UPSERT into codebase_embeddings
          await prisma.$executeRaw`
            INSERT INTO "codebase_embeddings" (
              "id", "projectId", "branchId", "fileId", "filePath",
              "chunkIndex", "startLine", "endLine", "content", "contentHash",
              "tokenCount", "embedding", "updatedAt"
            ) VALUES (
              ${recordId}, ${projectId}, ${branchId}, ${chunk.fileId}, ${chunk.filePath},
              ${chunk.chunkIndex}, ${chunk.startLine}, ${chunk.endLine}, ${chunk.content}, ${chunk.contentHash},
              ${chunk.tokenCount}, ${vectorSqlString}::vector, NOW()
            )
            ON CONFLICT ("fileId", "chunkIndex") DO UPDATE SET
              "startLine" = EXCLUDED."startLine",
              "endLine" = EXCLUDED."endLine",
              "content" = EXCLUDED."content",
              "contentHash" = EXCLUDED."contentHash",
              "tokenCount" = EXCLUDED."tokenCount",
              "embedding" = EXCLUDED."embedding",
              "updatedAt" = NOW();
          `;
        }

        // Pruning Invariant: Delete any obsolete trailing chunks if the file shrank
        await prisma.$executeRaw`
          DELETE FROM "codebase_embeddings"
          WHERE "fileId" = ${file.id} AND "chunkIndex" >= ${chunks.length};
        `;

        cumulativeChunks += chunks.length;

        await prisma.codebaseIndexTask.update({
          where: { id: taskId },
          data: {
            indexedFiles: i + 1,
            totalChunks: cumulativeChunks,
          },
        });
      }

      await prisma.codebaseIndexTask.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          totalChunks: cumulativeChunks,
        },
      });
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown indexing failure';

      console.error(`[CodebaseIndexService] Task ${taskId} failed:`, err);

      await prisma.codebaseIndexTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          errorMessage,
          completedAt: new Date(),
        },
      });
    }
  }

  /**
   * Executes semantic vector similarity search across a branch's codebase embeddings.
   *
   * CRITICAL SECURITY INVARIANT:
   * Enforces server-side pre-prompt ACL filtering (`resolveInheritedOverride`).
   * Chunks belonging to files where the user has DENIED permission are stripped
   * immediately on the server before entering any AI prompt or API response.
   */
  /**
   * Executes code search across a branch's files.
   * Priority: Direct fast text/syntax matching across files and contents (sub-millisecond).
   * Preserves full semantic vector search capability in `runSemanticVectorSearch` for future reactivation.
   */
  public static async semanticSearch(
    projectId: string,
    branchId: string,
    userId: string,
    request: SemanticSearchRequestDto
  ): Promise<SemanticSearchResponseDto> {
    const startTime = Date.now();
    const query = request.query.trim();

    if (!query) {
      return {
        query,
        results: [],
        totalMatches: 0,
        latencyMs: 0,
      };
    }

    const topK = Math.min(
      RAG_LIMITS.MAX_SIMILARITY_TOP_K,
      request.topK ?? RAG_LIMITS.DEFAULT_SIMILARITY_TOP_K
    );
    const permittedResults: SemanticSearchResultDto[] = [];
    const lowerQuery = query.toLowerCase();

    // 1. Direct High-Speed Code Search (File Names & Content)
    try {
      const matchingFiles = await prisma.projectFile.findMany({
        where: {
          branchId,
          nodeType: 'FILE',
          OR: [
            { content: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { name: 'asc' },
        take: topK * 3,
      });

      for (const file of matchingFiles) {
        if (
          request.fileExtensionFilter &&
          request.fileExtensionFilter.length > 0
        ) {
          const matchesExt = request.fileExtensionFilter.some((ext) =>
            file.name.endsWith(ext)
          );
          if (!matchesExt) continue;
        }

        const override = await resolveInheritedOverride(
          branchId,
          file.id,
          userId
        );
        if (override === 'denied') continue;

        const lines = file.content.split('\n');
        const matchIndices: number[] = [];

        lines.forEach((lineText, idx) => {
          if (lineText.toLowerCase().includes(lowerQuery)) {
            matchIndices.push(idx);
          }
        });

        if (matchIndices.length > 0) {
          // Add top matching line occurrences in this file
          for (const matchIdx of matchIndices.slice(0, 3)) {
            const startLine = Math.max(1, matchIdx + 1);
            const endLine = Math.min(lines.length, matchIdx + 4);
            const snippet = lines.slice(matchIdx, endLine).join('\n');

            permittedResults.push({
              id: `match-${file.id}-${startLine}`,
              fileId: file.id,
              filePath: file.name,
              startLine,
              endLine,
              content: snippet || file.content.slice(0, 200),
              similarity: 1.0,
            });

            if (permittedResults.length >= topK) break;
          }
        } else if (file.name.toLowerCase().includes(lowerQuery)) {
          // File name itself matched
          permittedResults.push({
            id: `match-${file.id}-filename`,
            fileId: file.id,
            filePath: file.name,
            startLine: 1,
            endLine: Math.min(lines.length, 5),
            content: lines.slice(0, 5).join('\n') || file.name,
            similarity: 0.95,
          });
        }

        if (permittedResults.length >= topK) break;
      }
    } catch (err) {
      console.warn('[CodebaseIndexService] Direct text search error:', err);
    }

    // 2. If direct search returned 0 results, fall back to preserved semantic vector search
    if (permittedResults.length === 0) {
      const vectorResults = await this.runSemanticVectorSearch(
        projectId,
        branchId,
        userId,
        query,
        topK,
        request.minScore ?? RAG_LIMITS.MIN_SIMILARITY_SCORE,
        request.fileExtensionFilter
      );
      permittedResults.push(...vectorResults);
    }

    const latencyMs = Date.now() - startTime;

    return {
      query,
      results: permittedResults.slice(0, topK),
      totalMatches: permittedResults.length,
      latencyMs,
    };
  }

  /**
   * Preserved pgvector semantic similarity search pipeline for future reactivation.
   */
  public static async runSemanticVectorSearch(
    projectId: string,
    branchId: string,
    userId: string,
    query: string,
    topK: number,
    minScore: number,
    fileExtensionFilter?: string[]
  ): Promise<SemanticSearchResultDto[]> {
    const provider = getEmbeddingProvider();
    const fetchLimit = Math.max(15, topK * 3);

    let rawResults: Array<{
      id: string;
      fileId: string;
      filePath: string;
      startLine: number;
      endLine: number;
      content: string;
      similarity: number;
    }> = [];

    try {
      const queryVector = await provider.embedText(query);
      const vectorSqlString = `[${queryVector.join(',')}]`;

      rawResults = await prisma.$queryRaw<
        Array<{
          id: string;
          fileId: string;
          filePath: string;
          startLine: number;
          endLine: number;
          content: string;
          similarity: number;
        }>
      >`
        SELECT 
          id, "fileId", "filePath", "startLine", "endLine", content,
          (1 - (embedding <=> ${vectorSqlString}::vector))::float AS similarity
        FROM "codebase_embeddings"
        WHERE "projectId" = ${projectId} 
          AND "branchId" = ${branchId}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${vectorSqlString}::vector ASC
        LIMIT ${fetchLimit};
      `;
    } catch (err) {
      console.warn('[CodebaseIndexService] Vector query error:', err);
    }

    const permittedResults: SemanticSearchResultDto[] = [];

    for (const row of rawResults) {
      if (row.similarity < minScore) continue;

      if (fileExtensionFilter && fileExtensionFilter.length > 0) {
        const matchesExt = fileExtensionFilter.some((ext) =>
          row.filePath.endsWith(ext)
        );
        if (!matchesExt) continue;
      }

      const override = await resolveInheritedOverride(
        branchId,
        row.fileId,
        userId
      );
      if (override === 'denied') continue;

      permittedResults.push({
        id: row.id,
        fileId: row.fileId,
        filePath: row.filePath,
        startLine: row.startLine,
        endLine: row.endLine,
        content: row.content,
        similarity: Number(row.similarity.toFixed(4)),
      });

      if (permittedResults.length >= topK) break;
    }

    return permittedResults;
  }

  /**
   * Recovers tasks that have been stuck in 'PROCESSING' for more than 10 minutes
   * (e.g. if the server restarted during indexing).
   */
  public static async recoverStaleTasks(branchId?: string): Promise<number> {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const whereClause: {
      status: 'PROCESSING';
      updatedAt: { lt: Date };
      branchId?: string;
    } = {
      status: 'PROCESSING',
      updatedAt: { lt: tenMinutesAgo },
    };

    if (branchId) {
      whereClause.branchId = branchId;
    }

    const result = await prisma.codebaseIndexTask.updateMany({
      where: whereClause,
      data: {
        status: 'FAILED',
        errorMessage: 'Task timed out or was interrupted by worker restart',
        completedAt: new Date(),
      },
    });

    return result.count;
  }
}
