import crypto from 'node:crypto';
import path from 'node:path';
import {
  AgentFileChangeType,
  AgentStagedFile,
  FileNodeType,
  prisma,
} from '@codecollab/database';
import {
  AgentFileChangeTypeDto,
  AgentStagedFileDto,
  AGENT_LIMITS,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertProjectAccess,
} from '../projects/project.auth';
import { CodebaseIndexService } from '../ai/codebaseIndex.service';

export const normalizeFilePath = (rawPath: string): string => {
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, '/')).trim();
  // Strip leading slash if present
  return normalized.replace(/^\/+/, '');
};

export const toDtoChangeType = (
  type: AgentFileChangeType
): AgentFileChangeTypeDto => {
  switch (type) {
    case 'CREATE':
      return 'CREATE';
    case 'MODIFY':
      return 'MODIFY';
    case 'DELETE':
      return 'DELETE';
  }
};

export const toDbChangeType = (
  type: AgentFileChangeTypeDto
): AgentFileChangeType => {
  switch (type) {
    case 'CREATE':
      return 'CREATE';
    case 'MODIFY':
      return 'MODIFY';
    case 'DELETE':
      return 'DELETE';
  }
};

export const mapAgentStagedFileDto = (
  row: AgentStagedFile
): AgentStagedFileDto => ({
  id: row.id,
  sessionId: row.sessionId,
  fileId: row.fileId,
  filePath: row.filePath,
  changeType: toDtoChangeType(row.changeType),
  originalContent: row.originalContent,
  stagedContent: row.stagedContent,
  originalVersion: row.originalVersion,
  originalContentHash: row.originalContentHash,
  isApplied: row.isApplied,
  hasConflict: row.hasConflict,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class AgentStagingService {
  /**
   * Resolves the full logical path of all files on a given branch by traversing
   * parentId relations from root to leaf.
   */
  static async getBranchPathMap(branchId: string): Promise<{
    pathToIdMap: Map<string, string>;
    idToPathMap: Map<string, string>;
    filesByPath: Map<
      string,
      { id: string; name: string; content: string; version: number; nodeType: FileNodeType }
    >;
  }> {
    const allNodes = await prisma.projectFile.findMany({
      where: { branchId },
      select: {
        id: true,
        parentId: true,
        name: true,
        nodeType: true,
        content: true,
        version: true,
      },
    });

    const nodeById = new Map(allNodes.map((n) => [n.id, n]));
    const pathToIdMap = new Map<string, string>();
    const idToPathMap = new Map<string, string>();
    const filesByPath = new Map<
      string,
      { id: string; name: string; content: string; version: number; nodeType: FileNodeType }
    >();

    const resolvePath = (nodeId: string): string => {
      const cached = idToPathMap.get(nodeId);
      if (cached) return cached;

      const node = nodeById.get(nodeId);
      if (!node) return '';

      let fullPath: string;
      if (!node.parentId) {
        fullPath = node.name;
      } else {
        const parentPath = resolvePath(node.parentId);
        fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
      }

      const normalized = normalizeFilePath(fullPath);
      idToPathMap.set(nodeId, normalized);
      return normalized;
    };

    for (const node of allNodes) {
      const fullPath = resolvePath(node.id);
      pathToIdMap.set(fullPath, node.id);
      if (node.nodeType === 'FILE') {
        filesByPath.set(fullPath, node);
      }
    }

    return { pathToIdMap, idToPathMap, filesByPath };
  }

  /**
   * Finds a file in the branch by its relative path (e.g. "src/auth/jwt.ts").
   */
  static async findFileByPath(
    branchId: string,
    filePath: string
  ): Promise<{ id: string; name: string; content: string; version: number } | null> {
    const normalized = normalizeFilePath(filePath);
    const { filesByPath } = await this.getBranchPathMap(branchId);
    const match = filesByPath.get(normalized);
    if (!match) return null;
    return {
      id: match.id,
      name: match.name,
      content: match.content,
      version: match.version,
    };
  }

  /**
   * Gets effective file content: returns staged content if staged in this session,
   * otherwise falls back to persisted branch content, or null if deleted/not found.
   */
  static async getEffectiveFileContent(
    sessionId: string,
    branchId: string,
    filePath: string
  ): Promise<{ content: string; isStaged: boolean; originalContent?: string } | null> {
    const normalized = normalizeFilePath(filePath);

    // 1. Check if staged in current session
    const staged = await prisma.agentStagedFile.findUnique({
      where: {
        sessionId_filePath: {
          sessionId,
          filePath: normalized,
        },
      },
    });

    if (staged) {
      if (staged.changeType === 'DELETE') {
        return null;
      }
      return {
        content: staged.stagedContent,
        isStaged: true,
        originalContent: staged.originalContent ?? undefined,
      };
    }

    // 2. Check branch files
    const file = await this.findFileByPath(branchId, normalized);
    if (!file) return null;

    return {
      content: file.content,
      isStaged: false,
      originalContent: file.content,
    };
  }

  /**
   * Stages a file change in the quarantined staging buffer.
   * Does NOT mutate the live branch until user confirms atomic acceptance.
   */
  static async stageFile(params: {
    sessionId: string;
    branchId: string;
    filePath: string;
    content: string;
    changeType?: AgentFileChangeType;
  }): Promise<AgentStagedFile> {
    const { sessionId, branchId, content } = params;
    const normalized = normalizeFilePath(params.filePath);

    if (Buffer.byteLength(content, 'utf8') > AGENT_LIMITS.MAX_FILE_WRITE_BYTES) {
      throw new AppError(
        400,
        'FILE_TOO_LARGE',
        `Staged file content exceeds limit of ${AGENT_LIMITS.MAX_FILE_WRITE_BYTES} bytes`
      );
    }

    // Look up original file to record originalContent, originalVersion, hash and fileId
    const existingFile = await this.findFileByPath(branchId, normalized);

    let changeType = params.changeType;
    if (!changeType) {
      changeType = existingFile ? 'MODIFY' : 'CREATE';
    }

    const originalContent = existingFile ? existingFile.content : null;
    const originalVersion = existingFile ? existingFile.version : null;
    const originalContentHash = originalContent !== null
      ? crypto.createHash('sha256').update(originalContent, 'utf8').digest('hex')
      : null;

    return prisma.agentStagedFile.upsert({
      where: {
        sessionId_filePath: {
          sessionId,
          filePath: normalized,
        },
      },
      create: {
        sessionId,
        filePath: normalized,
        fileId: existingFile?.id ?? null,
        changeType,
        originalContent,
        stagedContent: content,
        originalVersion,
        originalContentHash,
        hasConflict: false,
        isApplied: false,
      },
      update: {
        fileId: existingFile?.id ?? null,
        changeType,
        stagedContent: content,
        originalVersion,
        originalContentHash,
        hasConflict: false,
        isApplied: false,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Retrieves all currently staged files for an agent session.
   */
  static async getStagedFiles(sessionId: string): Promise<AgentStagedFile[]> {
    return prisma.agentStagedFile.findMany({
      where: { sessionId },
      orderBy: { filePath: 'asc' },
    });
  }

  /**
   * Retrieves a single staged file by relative path for an agent session.
   */
  static async getStagedFile(
    sessionId: string,
    filePath: string
  ): Promise<AgentStagedFile | null> {
    const normalized = normalizeFilePath(filePath);
    return prisma.agentStagedFile.findUnique({
      where: {
        sessionId_filePath: {
          sessionId,
          filePath: normalized,
        },
      },
    });
  }

  /**
   * Atomically applies staged file mutations to the target project branch in a single
   * PostgreSQL database transaction, ensuring ACID safety across multi-file refactors.
   */
  static async applyStagedFiles(params: {
    sessionId: string;
    userId: string;
    filePaths?: string[];
  }): Promise<{ appliedCount: number; files: string[] }> {
    const { sessionId, userId, filePaths } = params;

    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      include: {
        branch: true,
        project: true,
      },
    });

    if (!session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Agent session not found');
    }

    // Assert user has editor permissions on the project
    await assertProjectAccess(session.projectId, userId, 'editor');
    const branch = await assertBranchInProject(
      session.projectId,
      session.branchId
    );

    if (branch.isProtected) {
      throw new AppError(
        403,
        'BRANCH_PROTECTED',
        'Cannot apply multi-file agent changes to a protected branch'
      );
    }

    let stagedList = await prisma.agentStagedFile.findMany({
      where: { sessionId, isApplied: false },
    });

    if (filePaths && filePaths.length > 0) {
      const allowedSet = new Set(filePaths.map(normalizeFilePath));
      stagedList = stagedList.filter((f) => allowedSet.has(f.filePath));
    }

    if (stagedList.length === 0) {
      return { appliedCount: 0, files: [] };
    }

    const appliedFiles: string[] = [];
    let conflictStagedId: string | null = null;

    try {
      // Execute atomic transaction across all files
      await prisma.$transaction(async (tx) => {
        for (const staged of stagedList) {
          const normalized = normalizeFilePath(staged.filePath);

          if (staged.changeType === 'DELETE') {
            // Delete file if exists
            const existing = await tx.projectFile.findFirst({
              where: { branchId: branch.id, name: path.posix.basename(normalized) },
            });
            if (existing) {
              await tx.projectFile.delete({ where: { id: existing.id } });
              // Invalidate embeddings
              await tx.codebaseEmbedding.deleteMany({
                where: { fileId: existing.id },
              });
            }
          } else {
            // CREATE or MODIFY
            const pathSegments = normalized.split('/').filter(Boolean);
            const fileName = pathSegments[pathSegments.length - 1];
            const folderSegments = pathSegments.slice(0, -1);

            // Ensure parent folders exist
            let currentParentId: string | null = null;
            for (const folderName of folderSegments) {
              let folder: { id: string } | null = await tx.projectFile.findFirst({
                where: {
                  branchId: branch.id,
                  parentId: currentParentId,
                  name: folderName,
                  nodeType: 'FOLDER',
                },
              });

              if (!folder) {
                folder = await tx.projectFile.create({
                  data: {
                    branchId: branch.id,
                    parentId: currentParentId,
                    parentKey: currentParentId ?? 'ROOT',
                    name: folderName,
                    nodeType: 'FOLDER',
                    content: '',
                  },
                });
              }
              currentParentId = folder.id;
            }

            // Check if destination file already exists
            const existingFile = await tx.projectFile.findFirst({
              where: {
                branchId: branch.id,
                parentId: currentParentId,
                name: fileName,
                nodeType: 'FILE',
              },
            });

            if (existingFile) {
              // Optimistic Concurrency Control (OCC) Guard:
              // Verify file version has not drifted since the AI staged this modification
              const whereClause: any = { id: existingFile.id };
              if (staged.originalVersion !== null && staged.originalVersion !== undefined) {
                whereClause.version = staged.originalVersion;
              }

              const updateResult = await tx.projectFile.updateMany({
                where: whereClause,
                data: {
                  content: staged.stagedContent,
                  version: { increment: 1 },
                  lockedById: null,
                  lockedAt: null,
                  updatedAt: new Date(),
                },
              });

              if (updateResult.count === 0) {
                // Row was modified concurrently! Save conflict ID to persist outside transaction
                conflictStagedId = staged.id;
                throw new AppError(
                  409,
                  'CONCURRENCY_CONFLICT',
                  `Concurrent modification detected on '${normalized}'. The file was modified by another session since it was staged.`
                );
              }

              appliedFiles.push(normalized);
            } else {
              await tx.projectFile.create({
                data: {
                  branchId: branch.id,
                  parentId: currentParentId,
                  parentKey: currentParentId ?? 'ROOT',
                  name: fileName,
                  nodeType: 'FILE',
                  content: staged.stagedContent,
                  version: 1,
                },
              });
              appliedFiles.push(normalized);
            }
          }

          // Mark staged record as applied
          await tx.agentStagedFile.update({
            where: { id: staged.id },
            data: { isApplied: true },
          });
        }

        // Mark session as COMPLETED if all staged files are applied
        const remainingUnapplied = await tx.agentStagedFile.count({
          where: { sessionId, isApplied: false },
        });

        if (remainingUnapplied === 0) {
          await tx.agentSession.update({
            where: { id: sessionId },
            data: {
              status: 'COMPLETED',
              updatedAt: new Date(),
            },
          });
        }
      });
    } catch (err: any) {
      if (conflictStagedId) {
        // Persist hasConflict flag outside the rolled-back transaction so the UI can flag it
        await prisma.agentStagedFile.update({
          where: { id: conflictStagedId },
          data: { hasConflict: true },
        });
      }
      throw err;
    }

    // Fire background incremental re-indexing for updated vector embeddings
    CodebaseIndexService.triggerBranchIndexing(
      session.projectId,
      session.branchId,
      userId
    ).catch((err) => {
      console.warn('[AgentStaging] Background reindex trigger warning:', err);
    });

    return {
      appliedCount: appliedFiles.length,
      files: appliedFiles,
    };
  }

  /**
   * Discards staged changes without applying them to the branch.
   */
  static async discardStagedFiles(params: {
    sessionId: string;
    filePaths?: string[];
  }): Promise<{ discardedCount: number }> {
    const { sessionId, filePaths } = params;

    let deleteFilter: any = { sessionId, isApplied: false };
    if (filePaths && filePaths.length > 0) {
      deleteFilter.filePath = { in: filePaths.map(normalizeFilePath) };
    }

    const { count } = await prisma.agentStagedFile.deleteMany({
      where: deleteFilter,
    });

    return { discardedCount: count };
  }
}
