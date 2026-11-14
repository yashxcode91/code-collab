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
    const minScore = request.minScore ?? RAG_LIMITS.MIN_SIMILARITY_SCORE;
    const provider = getEmbeddingProvider();

    // 1. Generate query embedding
    const queryVector = await provider.embedText(query);
    const vectorSqlString = `[${queryVector.join(',')}]`;

    // Overfetch slightly (topK * 3) so that after ACL filtering and extension filtering,
    // we still return up to topK results without making extra database rounds
    const fetchLimit = Math.max(15, topK * 3);

    // 2. pgvector cosine similarity search
    // Note: In pgvector, `<=>` is cosine distance (0 to 2). Cosine similarity = 1 - distance.
    const rawResults = await prisma.$queryRaw<
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

    // 3. Server-side Pre-Prompt ACL Filtering & Extension Filtering
    const permittedResults: SemanticSearchResultDto[] = [];

    for (const row of rawResults) {
      if (row.similarity < minScore) {
        continue;
      }

      // Check file extension filter if specified
      if (
        request.fileExtensionFilter &&
        request.fileExtensionFilter.length > 0
      ) {
        const matchesExt = request.fileExtensionFilter.some((ext) =>
          row.filePath.endsWith(ext)
        );
        if (!matchesExt) {
          continue;
        }
      }

      // Enforce file permission via resolveInheritedOverride
      const override = await resolveInheritedOverride(
        branchId,
        row.fileId,
        userId
      );

      if (override === 'denied') {
        // Drop candidate chunk immediately from context
        continue;
      }

      permittedResults.push({
        id: row.id,
        fileId: row.fileId,
        filePath: row.filePath,
        startLine: row.startLine,
        endLine: row.endLine,
        content: row.content,
        similarity: Number(row.similarity.toFixed(4)),
      });

      if (permittedResults.length >= topK) {
        break;
      }
    }

    const latencyMs = Date.now() - startTime;

    return {
      query,
      results: permittedResults,
      totalMatches: permittedResults.length,
      latencyMs,
    };
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
