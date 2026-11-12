import {
  ChatMessageType as DbChatMessageType,
  prisma,
} from '@codecollab/database';
import {
  CHAT_LIMITS,
  ChatMessageDto,
  CreateChatMessageInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { consumeSlidingWindowLimit } from '../execution/execution.queue';
import {
  assertBranchInProject,
  assertFileInBranch,
  assertProjectAccess,
  assertValidUuid,
} from '../projects/project.auth';
import { resolveInheritedOverride } from '../projects/project.service';

const CHAT_SELECT = {
  id: true,
  projectId: true,
  branchId: true,
  userId: true,
  fileId: true,
  type: true,
  content: true,
  fileName: true,
  lineNumber: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      username: true,
      avatarUrl: true,
    },
  },
} as const;

type ChatRow = {
  id: string;
  projectId: string;
  branchId: string | null;
  userId: string | null;
  fileId: string | null;
  type: DbChatMessageType;
  content: string;
  fileName: string | null;
  lineNumber: number | null;
  createdAt: Date;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null;
};

export const mapChatMessageDto = (
  row: ChatRow,
  hideFileRef = false
): ChatMessageDto => ({
  id: row.id,
  projectId: row.projectId,
  branchId: row.branchId,
  type: row.type === 'SYSTEM' ? 'system' : 'user',
  content: row.content,
  author: row.user
    ? {
        id: row.user.id,
        username: row.user.username,
        ...(row.user.avatarUrl ? { avatarUrl: row.user.avatarUrl } : {}),
      }
    : null,
  fileRef:
    !hideFileRef && row.fileId && row.fileName
      ? {
          fileId: row.fileId,
          fileName: row.fileName,
          branchId: row.branchId,
          lineNumber: row.lineNumber,
        }
      : null,
  createdAt: row.createdAt.toISOString(),
});

/**
 * Lists cursor-paginated chat history strictly for authenticated project members,
 * redacting file references if a collaborator is denied access to a linked file.
 */
export const listProjectChatMessages = async (params: {
  projectId: string;
  userId: string;
  cursor?: string;
  limit: number;
}): Promise<{ messages: ChatMessageDto[]; nextCursor: string | null }> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validCursor = params.cursor
    ? assertValidUuid(params.cursor, 'cursor')
    : undefined;

  const { role } = await assertProjectAccess(validProjectId, params.userId);
  if (role === null) {
    throw new AppError(
      403,
      'CHAT_FORBIDDEN',
      'Only workspace members can access team chat'
    );
  }

  let cursorRow: { id: string; projectId: string; createdAt: Date } | null = null;
  if (validCursor) {
    const foundCursor = await prisma.chatMessage.findUnique({
      where: { id: validCursor },
      select: { id: true, projectId: true, createdAt: true },
    });
    if (foundCursor && foundCursor.projectId === validProjectId) {
      cursorRow = foundCursor;
    }
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      projectId: validProjectId,
      ...(cursorRow
        ? {
            OR: [
              { createdAt: { lt: cursorRow.createdAt } },
              {
                createdAt: cursorRow.createdAt,
                id: { lt: cursorRow.id },
              },
            ],
          }
        : {}),
    },
    select: CHAT_SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
  });

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1].id : null;

  const deniedCache = new Map<string, boolean>();
  const dtos: ChatMessageDto[] = [];

  for (const row of pageRows) {
    let hideFileRef = false;
    if (role !== 'owner' && row.fileId && row.branchId) {
      const cacheKey = `${row.branchId}:${row.fileId}`;
      let denied = deniedCache.get(cacheKey);
      if (denied === undefined) {
        const perm = await resolveInheritedOverride(
          row.branchId,
          row.fileId,
          params.userId
        );
        denied = perm === 'denied';
        deniedCache.set(cacheKey, denied);
      }
      hideFileRef = denied;
    }
    dtos.push(mapChatMessageDto(row, hideFileRef));
  }

  // Return oldest -> newest within the fetched page for natural bottom-anchored chat rendering
  dtos.reverse();
  return { messages: dtos, nextCursor };
};

/**
 * Persists a workspace chat message (Owner & Editor only), enforces Redis sliding-window
 * spam limits, and verifies optional `branchId`/`fileId` containment & ACLs.
 */
export const createProjectChatMessage = async (params: {
  projectId: string;
  userId: string;
  input: CreateChatMessageInput;
}): Promise<ChatMessageDto> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');

  const { role } = await assertProjectAccess(
    validProjectId,
    params.userId,
    'editor'
  );

  const [projectAllowed, globalAllowed] = await Promise.all([
    consumeSlidingWindowLimit({
      key: `codecollab:ratelimit:chat:${validProjectId}:${params.userId}`,
      maxRequests: CHAT_LIMITS.RATE_LIMIT_MAX_MESSAGES,
      windowSec: CHAT_LIMITS.RATE_LIMIT_WINDOW_SEC,
    }),
    consumeSlidingWindowLimit({
      key: `codecollab:ratelimit:chat-global:${params.userId}`,
      maxRequests: CHAT_LIMITS.RATE_LIMIT_MAX_MESSAGES * 3,
      windowSec: CHAT_LIMITS.RATE_LIMIT_WINDOW_SEC,
    }),
  ]);

  if (!projectAllowed || !globalAllowed) {
    throw new AppError(
      429,
      'RATE_LIMIT_EXCEEDED',
      `Chat rate limit exceeded (max ${CHAT_LIMITS.RATE_LIMIT_MAX_MESSAGES} messages per ${CHAT_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`
    );
  }

  let validBranchId: string | null = null;
  if (params.input.branchId) {
    validBranchId = assertValidUuid(params.input.branchId, 'branch');
    await assertBranchInProject(validProjectId, validBranchId);
  }

  let validFileId: string | null = null;
  let resolvedFileName: string | null = null;

  if (params.input.fileId) {
    validFileId = assertValidUuid(params.input.fileId, 'file');
    if (validBranchId) {
      const file = await assertFileInBranch(
        validBranchId,
        validFileId,
        params.userId
      );
      if (file.nodeType !== 'FILE') {
        throw new AppError(
          400,
          'INVALID_NODE_TYPE',
          'Chat file references can only link to files, not folders'
        );
      }
      if (role !== 'owner') {
        const perm = await resolveInheritedOverride(
          validBranchId,
          file.id,
          params.userId
        );
        if (perm === 'denied') {
          throw new AppError(
            403,
            'FILE_ACCESS_DENIED',
            'You cannot reference a restricted file in chat'
          );
        }
      }
      resolvedFileName = file.name;
    } else {
      const file = await prisma.projectFile.findUnique({
        where: { id: validFileId },
        include: {
          branch: { select: { id: true, projectId: true } },
        },
      });
      if (!file || file.branch.projectId !== validProjectId) {
        throw new AppError(
          404,
          'FILE_NOT_FOUND',
          'Referenced file not found in this workspace'
        );
      }
      if (file.nodeType !== 'FILE') {
        throw new AppError(
          400,
          'INVALID_NODE_TYPE',
          'Chat file references can only link to files, not folders'
        );
      }
      validBranchId = file.branch.id;
      if (role !== 'owner') {
        const perm = await resolveInheritedOverride(
          validBranchId,
          file.id,
          params.userId
        );
        if (perm === 'denied') {
          throw new AppError(
            403,
            'FILE_ACCESS_DENIED',
            'You cannot reference a restricted file in chat'
          );
        }
      }
      resolvedFileName = file.name;
    }
  }

  const created = await prisma.chatMessage.create({
    data: {
      projectId: validProjectId,
      branchId: validBranchId,
      userId: params.userId,
      fileId: validFileId,
      type: DbChatMessageType.USER,
      content: params.input.content,
      fileName: resolvedFileName,
      lineNumber: validFileId ? (params.input.lineNumber ?? null) : null,
    },
    select: CHAT_SELECT,
  });

  return mapChatMessageDto(created);
};
