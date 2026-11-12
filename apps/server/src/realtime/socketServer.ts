import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { prisma } from '@codecollab/database';
import {
  buildExecutionRoomKey,
  buildFileRoomKey,
  buildProjectChatRoomKey,
  buildProjectWorkspaceRoomKey,
  ChatJoinLeaveSocketSchema,
  type ChatMessageDto,
  ChatSendSocketSchema,
  ChatTypingSocketSchema,
  ClientToServerEvents,
  EXECUTION_EVENTS_CHANNEL,
  EXECUTION_LIMITS,
  ExecutionJoinSocketSchema,
  ExecutionLeaveSocketSchema,
  type ExecutionRunDto,
  ExecutionStdinSchema,
  FileAccessPermission,
  REALTIME_MAX_FRAME_BYTES,
  RealtimeCursorSelection,
  RealtimeErrorCode,
  RealtimeErrorDetail,
  ServerToClientEvents,
  SignedWorkerEventEnvelopeSchema,
  type WorkerExecutionEvent,
  WorkerExecutionEventSchema,
} from '@codecollab/shared';
import {
  canonicalJsonStringify,
  closeRedisClient,
  createRedisSubscriber,
  getExecutionPubSubSecret,
  verifyPubSubStringSignature,
} from '../lib/redis';
import { AppError } from '../utils/AppError';
import { getAllowedOrigin } from '../middleware/csrf.middleware';
import { createProjectChatMessage } from '../modules/chat/chat.service';
import {
  consumeSlidingWindowLimit,
  publishExecutionStdin,
  reserveRunStdinBytes,
} from '../modules/execution/execution.queue';
import { getExecutionRunDetail } from '../modules/execution/execution.service';
import {
  assertBranchInProject,
  assertCanWriteFileNode,
  assertFileInBranch,
  assertProjectAccess,
  assertValidUuid,
  computeEffectiveFilePermission,
} from '../modules/projects/project.auth';
import {
  registerProjectRealtimeHooks,
  resolveInheritedOverride,
} from '../modules/projects/project.service';
import {
  RealtimeSocket,
  socketAuthMiddleware,
  SocketData,
} from './socketAuth';
import { parseSocketPayload } from './socketValidation';
import { yjsRoomManager, YjsRoomManager } from './yjsRoomManager';

export type TypedRealtimeIoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let activeIoServer: TypedRealtimeIoServer | null = null;
let activeRoomManager: YjsRoomManager = yjsRoomManager;
const activeRunLastSeq = new Map<string, number>();

const FILE_ROOM_KEY_RE = /^branch:([^:]+):file:([^:]+)$/;
const parseFileRoomKey = (
  roomKey: string
): { branchId: string; fileId: string } | null => {
  const match = FILE_ROOM_KEY_RE.exec(roomKey);
  if (!match) return null;
  return { branchId: match[1], fileId: match[2] };
};

const trackRunChunkSeq = (runId: string, seq: number) => {
  activeRunLastSeq.set(runId, seq);
  if (activeRunLastSeq.size > 2000) {
    const oldestKey = activeRunLastSeq.keys().next().value;
    if (oldestKey) activeRunLastSeq.delete(oldestKey);
  }
};

/** Broadcasts a REST-originated CRDT text update (e.g., branch merge) to connected room sockets. */
export const broadcastRestFileSync = (params: {
  branchId: string;
  fileId: string;
  delta: Uint8Array | null;
  senderId?: string;
}): void => {
  if (!activeIoServer || !params.delta || params.delta.byteLength === 0) {
    return;
  }
  const roomKey = buildFileRoomKey(params.branchId, params.fileId);
  activeIoServer.to(roomKey).emit('yjs:update', {
    branchId: params.branchId,
    fileId: params.fileId,
    senderId: params.senderId ?? 'system:merge',
    update: params.delta,
  });
};

/** Broadcasts newly queued runs to authorized workspace members, skipping denied per-file ACLs. */
export const broadcastExecutionQueued = async (
  run: ExecutionRunDto
): Promise<void> => {
  if (!activeIoServer) return;
  const workspaceRoom = buildProjectWorkspaceRoomKey(run.projectId);
  if (!run.fileId) {
    activeIoServer.to(workspaceRoom).emit('execution:queued', run);
    return;
  }

  const sockets = await activeIoServer.in(workspaceRoom).fetchSockets();
  for (const s of sockets) {
    const uid = s.data.user?.id;
    if (!uid) continue;
    try {
      const { role } = await assertProjectAccess(run.projectId, uid);
      if (role === null) continue;
      if (role !== 'owner') {
        const perm = await resolveInheritedOverride(
          run.branchId,
          run.fileId,
          uid
        );
        if (perm === 'denied') continue;
      }
      s.emit('execution:queued', run);
    } catch {
      // Ignore unauthorized/stale socket
    }
  }
};

/** Broadcasts pre-start QUEUED cancellation to connected run viewers. */
export const broadcastExecutionCancelled = (run: ExecutionRunDto): void => {
  if (!activeIoServer) return;
  activeIoServer.to(buildExecutionRoomKey(run.id)).emit('execution:cancelled', {
    runId: run.id,
    projectId: run.projectId,
    branchId: run.branchId,
    fileId: run.fileId,
    status: 'CANCELLED',
    exitCode: run.exitCode,
    failureKind: run.failureKind,
    errorMessage: run.errorMessage,
    durationMs: run.durationMs,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    stdoutTruncated: run.stdoutTruncated,
    stderrTruncated: run.stderrTruncated,
  });
};

/** Broadcasts persisted workspace chat messages while redacting file references denied to a recipient. */
export const broadcastChatMessage = async (
  message: ChatMessageDto
): Promise<void> => {
  if (!activeIoServer) return;
  const chatRoom = buildProjectChatRoomKey(message.projectId);
  if (!message.fileRef || !message.fileRef.branchId) {
    activeIoServer.to(chatRoom).emit('chat:message', message);
    return;
  }

  const sockets = await activeIoServer.in(chatRoom).fetchSockets();
  for (const s of sockets) {
    const uid = s.data.user?.id;
    if (!uid) continue;
    try {
      const { role } = await assertProjectAccess(message.projectId, uid);
      if (role === null) continue;
      if (role !== 'owner') {
        const perm = await resolveInheritedOverride(
          message.fileRef.branchId,
          message.fileRef.fileId,
          uid
        );
        if (perm === 'denied') {
          s.emit('chat:message', { ...message, fileRef: null });
          continue;
        }
      }
      s.emit('chat:message', message);
    } catch {
      // Skip invalid socket
    }
  }
};

/** Live-evicts a removed collaborator from workspace chat, execution, and Yjs rooms. */
export const evictUserFromProjectRealtime = async (params: {
  projectId: string;
  userId: string;
}): Promise<void> => {
  if (!activeIoServer) return;
  const sockets = await activeIoServer.fetchSockets();
  const chatRoom = buildProjectChatRoomKey(params.projectId);
  const workspaceRoom = buildProjectWorkspaceRoomKey(params.projectId);
  const branchProjectCache = new Map<string, string | null>();

  for (const s of sockets) {
    if (s.data.user?.id !== params.userId) continue;
    let touchedProject = s.rooms.has(chatRoom) || s.rooms.has(workspaceRoom);
    s.leave(chatRoom);
    s.leave(workspaceRoom);

    for (const roomKey of Array.from(s.rooms)) {
      if (roomKey.startsWith('execution:')) {
        const runId = roomKey.slice('execution:'.length);
        const run = await prisma.executionRun
          .findUnique({ where: { id: runId }, select: { projectId: true } })
          .catch(() => null);
        if (run?.projectId === params.projectId) {
          touchedProject = true;
          s.leave(roomKey);
          s.emit('realtime:error', {
            code: 'PROJECT_FORBIDDEN',
            message: 'Your access to this workspace has been revoked',
            projectId: params.projectId,
            runId,
          });
        }
        continue;
      }

      const parsedFileRoom = parseFileRoomKey(roomKey);
      if (parsedFileRoom) {
        const meta = activeRoomManager.getRoomMeta(roomKey);
        let roomProjectId = meta?.projectId ?? null;
        if (!roomProjectId) {
          if (branchProjectCache.has(parsedFileRoom.branchId)) {
            roomProjectId = branchProjectCache.get(parsedFileRoom.branchId) ?? null;
          } else {
            const branch = await prisma.projectBranch
              .findUnique({
                where: { id: parsedFileRoom.branchId },
                select: { projectId: true },
              })
              .catch(() => null);
            roomProjectId = branch?.projectId ?? null;
            branchProjectCache.set(parsedFileRoom.branchId, roomProjectId);
          }
        }

        if (roomProjectId === params.projectId) {
          touchedProject = true;
          s.leave(roomKey);
          const remaining = await activeRoomManager.removeSocketFromRoom(
            roomKey,
            s.id
          );
          if (remaining !== null && remaining.length > 0) {
            activeIoServer.to(roomKey).emit('presence:state', {
              fileId: parsedFileRoom.fileId,
              branchId: parsedFileRoom.branchId,
              users: remaining,
            });
          }
          s.emit('file:permission', {
            projectId: params.projectId,
            branchId: parsedFileRoom.branchId,
            fileId: parsedFileRoom.fileId,
            permission: 'denied',
            reason: 'Your access to this workspace has been revoked',
          });
          s.emit('realtime:error', {
            code: 'PROJECT_FORBIDDEN',
            message: 'Your access to this workspace has been revoked',
            projectId: params.projectId,
            fileId: parsedFileRoom.fileId,
          });
        }
      }
    }

    if (touchedProject) {
      s.emit('realtime:error', {
        code: 'PROJECT_FORBIDDEN',
        message: 'Your access to this workspace has been revoked',
        projectId: params.projectId,
      });
    }
  }
};

/** Live-evicts or downgrades a collaborator across execution & Yjs rooms after file ACL changes. */
export const evictUserFromFileExecutionRealtime = async (params: {
  projectId: string;
  branchId: string;
  targetUserId: string;
  permission?: FileAccessPermission;
}): Promise<void> => {
  if (!activeIoServer) return;
  const sockets = await activeIoServer.fetchSockets();
  const branchFilePrefix = `branch:${params.branchId}:file:`;

  for (const s of sockets) {
    if (s.data.user?.id !== params.targetUserId) continue;
    for (const roomKey of Array.from(s.rooms)) {
      if (roomKey.startsWith('execution:')) {
        const runId = roomKey.slice('execution:'.length);
        const run = await prisma.executionRun
          .findUnique({
            where: { id: runId },
            select: { branchId: true, fileId: true, projectId: true },
          })
          .catch(() => null);
        if (!run || run.branchId !== params.branchId || !run.fileId) continue;

        const perm = await resolveInheritedOverride(
          run.branchId,
          run.fileId,
          params.targetUserId
        );
        if (perm === 'denied') {
          s.leave(roomKey);
          s.emit('realtime:error', {
            code: 'FILE_ACCESS_DENIED',
            message: 'Your access to this executed file has been revoked',
            projectId: run.projectId,
            runId,
            fileId: run.fileId,
          });
        }
        continue;
      }

      if (roomKey.startsWith(branchFilePrefix)) {
        const fileId = roomKey.slice(branchFilePrefix.length);
        try {
          const ctx = await authorizeFileContext({
            projectId: params.projectId,
            branchId: params.branchId,
            fileId,
            userId: params.targetUserId,
          });

          if (ctx.permission === 'denied') {
            s.leave(roomKey);
            const remaining = await activeRoomManager.removeSocketFromRoom(
              roomKey,
              s.id
            );
            if (remaining !== null && remaining.length > 0) {
              activeIoServer.to(roomKey).emit('presence:state', {
                fileId,
                branchId: params.branchId,
                users: remaining,
              });
            }
            s.emit('file:permission', {
              projectId: params.projectId,
              branchId: params.branchId,
              fileId,
              permission: 'denied',
              reason: 'Your access to this file has been revoked',
            });
            s.emit('realtime:error', {
              code: 'FILE_ACCESS_DENIED',
              message: 'Your access to this file has been revoked',
              projectId: params.projectId,
              fileId,
            });
          } else {
            const updatedPresence =
              activeRoomManager.updateSocketMemberPermission(
                roomKey,
                s.id,
                ctx.permission
              );
            if (updatedPresence !== null) {
              activeIoServer.to(roomKey).emit('presence:state', {
                fileId,
                branchId: params.branchId,
                users: updatedPresence,
              });
            }
            s.emit('file:permission', {
              projectId: params.projectId,
              branchId: params.branchId,
              fileId,
              permission: ctx.permission,
            });
          }
        } catch {
          // File or access was removed
        }
      }
    }
  }
};

/** Synchronizes live Yjs permissions when a member role changes (`editor` <-> `viewer`). */
const syncProjectMemberRoleRealtime = async (params: {
  projectId: string;
  targetUserId: string;
}): Promise<void> => {
  if (!activeIoServer) return;
  const sockets = await activeIoServer.fetchSockets();

  for (const s of sockets) {
    if (s.data.user?.id !== params.targetUserId) continue;
    for (const roomKey of Array.from(s.rooms)) {
      const parsedFileRoom = parseFileRoomKey(roomKey);
      if (!parsedFileRoom) continue;
      const meta = activeRoomManager.getRoomMeta(roomKey);
      if (meta && meta.projectId !== params.projectId) continue;

      try {
        const ctx = await authorizeFileContext({
          projectId: params.projectId,
          branchId: parsedFileRoom.branchId,
          fileId: parsedFileRoom.fileId,
          userId: params.targetUserId,
        });
        if (ctx.permission === 'denied') continue;

        const updatedPresence = activeRoomManager.updateSocketMemberPermission(
          roomKey,
          s.id,
          ctx.permission
        );
        if (updatedPresence !== null) {
          activeIoServer.to(roomKey).emit('presence:state', {
            fileId: parsedFileRoom.fileId,
            branchId: parsedFileRoom.branchId,
            users: updatedPresence,
          });
        }
        s.emit('file:permission', {
          projectId: params.projectId,
          branchId: parsedFileRoom.branchId,
          fileId: parsedFileRoom.fileId,
          permission: ctx.permission,
        });
      } catch {
        // Ignore mismatched project branches
      }
    }
  }
};

/** Evicts all connected sockets from rooms of a deleted project, branch, or deleted file IDs. */
const evictAllSocketsFromDeletedProject = async (params: {
  projectId: string;
}): Promise<void> => {
  if (!activeIoServer) return;
  const sockets = await activeIoServer.fetchSockets();
  const chatRoom = buildProjectChatRoomKey(params.projectId);
  const workspaceRoom = buildProjectWorkspaceRoomKey(params.projectId);

  for (const s of sockets) {
    const inWorkspace = s.rooms.has(chatRoom) || s.rooms.has(workspaceRoom);
    s.leave(chatRoom);
    s.leave(workspaceRoom);
    for (const roomKey of Array.from(s.rooms)) {
      if (
        roomKey.startsWith('execution:') ||
        parseFileRoomKey(roomKey) !== null
      ) {
        const meta = activeRoomManager.getRoomMeta(roomKey);
        if (meta && meta.projectId === params.projectId) {
          s.leave(roomKey);
        }
      }
    }
    if (inWorkspace) {
      s.emit('realtime:error', {
        code: 'PROJECT_NOT_FOUND',
        message: 'This workspace has been deleted',
        projectId: params.projectId,
      });
    }
  }
};

const evictDeletedBranchSockets = async (params: {
  projectId: string;
  branchId: string;
  runIds: string[];
}): Promise<void> => {
  if (!activeIoServer) return;
  const sockets = await activeIoServer.fetchSockets();
  const branchPrefix = `branch:${params.branchId}:file:`;
  const runRooms = new Set(params.runIds.map((id) => buildExecutionRoomKey(id)));

  for (const s of sockets) {
    for (const roomKey of Array.from(s.rooms)) {
      if (roomKey.startsWith(branchPrefix) || runRooms.has(roomKey)) {
        s.leave(roomKey);
      }
    }
  }
};

const evictDeletedFilesSockets = async (params: {
  projectId: string;
  branchId: string;
  fileIds: string[];
}): Promise<void> => {
  if (!activeIoServer) return;
  const targetRooms = new Set(
    params.fileIds.map((id) => buildFileRoomKey(params.branchId, id))
  );
  const sockets = await activeIoServer.fetchSockets();
  for (const s of sockets) {
    for (const roomKey of Array.from(s.rooms)) {
      if (targetRooms.has(roomKey)) {
        s.leave(roomKey);
      }
    }
  }
};

/** Forcefully disconnects all Socket.IO clients authenticated with a revoked/logged-out JWT hash. */
export const disconnectSocketsByTokenHash = async (
  tokenHash: string
): Promise<void> => {
  if (!activeIoServer || !tokenHash) return;
  const sockets = await activeIoServer.fetchSockets();
  for (const s of sockets) {
    if (s.data.user?.tokenHash !== tokenHash) continue;
    s.emit('realtime:error', {
      code: 'UNAUTHORIZED',
      message: 'Your session has been signed out',
    });
    s.disconnect(true);
  }
};

const APP_ERROR_TO_REALTIME_CODE: Record<string, RealtimeErrorCode> = {
  INVALID_ID: 'INVALID_ID',
  INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  INVALID_NODE_TYPE: 'INVALID_NODE_TYPE',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_FORBIDDEN: 'PROJECT_FORBIDDEN',
  BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_READ_ONLY: 'FILE_READ_ONLY',
  BRANCH_PROTECTED: 'BRANCH_PROTECTED',
  FILE_LOCKED: 'FILE_LOCKED',
  INSUFFICIENT_ROLE: 'FILE_READ_ONLY',
  EXECUTION_NOT_FOUND: 'EXECUTION_NOT_FOUND',
  EXECUTION_FORBIDDEN: 'EXECUTION_FORBIDDEN',
  EXECUTION_NOT_RUNNING: 'EXECUTION_NOT_RUNNING',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  CHAT_FORBIDDEN: 'CHAT_FORBIDDEN',
};

const toRealtimeError = (err: unknown): RealtimeErrorDetail => {
  if (err instanceof AppError) {
    return {
      code: APP_ERROR_TO_REALTIME_CODE[err.code] ?? 'INTERNAL_ERROR',
      message: err.message,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected real-time server error occurred',
  };
};

const toUint8Array = (raw: unknown): Uint8Array | null => {
  if (raw instanceof Uint8Array) {
    return raw;
  }
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw);
  }
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
};

const toBoundedInt = (value: unknown, min = 1, max = 1_000_000): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const intVal = Math.trunc(value);
  if (intVal < min || intVal > max) {
    return null;
  }
  return intVal;
};

const sanitizeCursor = (raw: unknown): RealtimeCursorSelection | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const anchorLine = toBoundedInt(obj.anchorLine);
  const anchorColumn = toBoundedInt(obj.anchorColumn);
  const headLine = toBoundedInt(obj.headLine);
  const headColumn = toBoundedInt(obj.headColumn);

  if (!anchorLine || !anchorColumn || !headLine || !headColumn) {
    return null;
  }

  return { anchorLine, anchorColumn, headLine, headColumn };
};

interface AuthorizedFileContext {
  permission: FileAccessPermission;
  preventSameLineEdit: boolean;
  maxConcurrentEditors: number;
  assertWritable: () => void;
}

const authorizeFileContext = async (params: {
  projectId: string;
  branchId: string;
  fileId: string;
  userId: string;
}): Promise<AuthorizedFileContext> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validBranchId = assertValidUuid(params.branchId, 'branch');
  const validFileId = assertValidUuid(params.fileId, 'file');

  const { project, role } = await assertProjectAccess(
    validProjectId,
    params.userId
  );
  const branch = await assertBranchInProject(project.id, validBranchId);
  const file = await assertFileInBranch(branch.id, validFileId, params.userId);

  if (file.nodeType !== 'FILE') {
    throw new AppError(
      400,
      'INVALID_NODE_TYPE',
      'Real-time collaboration rooms only support files, not folders'
    );
  }

  const override = await resolveInheritedOverride(
    branch.id,
    file.id,
    params.userId
  );

  const permission = computeEffectiveFilePermission({
    role,
    userId: params.userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: file.lockedById,
    override,
  });

  return {
    permission,
    preventSameLineEdit: project.preventSameLineEdit,
    maxConcurrentEditors: project.maxConcurrentEditors,
    assertWritable: () =>
      assertCanWriteFileNode({
        role,
        userId: params.userId,
        branchIsProtected: branch.isProtected,
        fileLockedById: file.lockedById,
        lockedByUsername: file.lockedBy?.username,
        override,
      }),
  };
};

/**
 * Attaches the authenticated Socket.IO + Yjs real-time collaboration gateway
 * to our HTTP server. Enforces workspace/branch/file ACLs, exclusive file locks,
 * protected branches, max concurrent editor caps, and binary payload ceilings.
 */
export const createRealtimeServer = (
  httpServer: HttpServer,
  roomManager: YjsRoomManager = yjsRoomManager
): TypedRealtimeIoServer => {
  const io: TypedRealtimeIoServer = new Server(httpServer, {
    cors: {
      origin: (requestOrigin, callback) => {
        if (requestOrigin && requestOrigin === getAllowedOrigin()) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    },
    maxHttpBufferSize: REALTIME_MAX_FRAME_BYTES + 16_384,
  });

  activeIoServer = io;
  activeRoomManager = roomManager;

  // Dedicated Redis Pub/Sub bridge consuming validated & DB-verified WorkerExecutionEvents
  const workerEventsSub = createRedisSubscriber();
  const verifiedRunScopeCache = new Map<
    string,
    { projectId: string; branchId: string; fileId: string | null }
  >();
  const runEmitQueues = new Map<string, Promise<void>>();

  const emitValidatedWorkerEvent = (ev: WorkerExecutionEvent) => {
    const roomKey = buildExecutionRoomKey(ev.runId);

    if (ev.type === 'started') {
      activeRunLastSeq.set(ev.runId, 0);
      io.to(roomKey).emit('execution:started', {
        runId: ev.runId,
        projectId: ev.projectId,
        branchId: ev.branchId,
        fileId: ev.fileId,
        status: 'RUNNING',
        exitCode: null,
        failureKind: null,
        errorMessage: null,
        durationMs: null,
        startedAt: ev.startedAt,
        endedAt: null,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      return;
    }

    if (ev.type === 'stdout' || ev.type === 'stderr') {
      trackRunChunkSeq(ev.runId, ev.seq);
      const eventName =
        ev.type === 'stdout' ? 'execution:stdout' : 'execution:stderr';
      io.to(roomKey).emit(eventName, {
        runId: ev.runId,
        projectId: ev.projectId,
        branchId: ev.branchId,
        seq: ev.seq,
        chunk: ev.chunk,
        truncated: ev.truncated,
        timestamp: ev.timestamp,
      });
      return;
    }

    if (
      ev.type === 'completed' ||
      ev.type === 'failed' ||
      ev.type === 'timeout' ||
      ev.type === 'cancelled'
    ) {
      const terminalEventMap = {
        completed: 'execution:completed',
        failed: 'execution:failed',
        timeout: 'execution:timeout',
        cancelled: 'execution:cancelled',
      } as const;

      io.to(roomKey).emit(terminalEventMap[ev.type], {
        runId: ev.runId,
        projectId: ev.projectId,
        branchId: ev.branchId,
        fileId: ev.fileId,
        status: ev.status,
        exitCode: ev.exitCode,
        failureKind: ev.failureKind,
        errorMessage: ev.errorMessage,
        durationMs: ev.durationMs,
        startedAt: ev.startedAt,
        endedAt: ev.endedAt,
        stdoutTruncated: ev.stdoutTruncated,
        stderrTruncated: ev.stderrTruncated,
      });
      setTimeout(() => {
        activeRunLastSeq.delete(ev.runId);
        verifiedRunScopeCache.delete(ev.runId);
      }, 60_000).unref();
    }
  };

  void workerEventsSub.subscribe(EXECUTION_EVENTS_CHANNEL).catch((err) => {
    console.error('⚠️ [realtime] Failed to subscribe to worker events:', err);
  });

  workerEventsSub.on('message', (channel, rawPayload) => {
    if (channel !== EXECUTION_EVENTS_CHANNEL) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawPayload);
    } catch {
      return;
    }

    const secret = getExecutionPubSubSecret();
    let ev: WorkerExecutionEvent | null = null;

    const envelope = SignedWorkerEventEnvelopeSchema.safeParse(decoded);
    if (envelope.success) {
      if (secret) {
        const canonical = canonicalJsonStringify(envelope.data.event);
        if (!verifyPubSubStringSignature(canonical, envelope.data.sig, secret)) {
          return;
        }
      }
      ev = envelope.data.event;
    } else {
      if (secret || process.env.NODE_ENV === 'production') {
        return;
      }
      const parsed = WorkerExecutionEventSchema.safeParse(decoded);
      if (!parsed.success) return;
      ev = parsed.data;
    }

    const validatedEvent = ev;
    const prevQueue = runEmitQueues.get(validatedEvent.runId) ?? Promise.resolve();
    const nextQueue = prevQueue
      .catch(() => undefined)
      .then(async () => {
        let scope = verifiedRunScopeCache.get(validatedEvent.runId);
        if (!scope) {
          const dbRun = await prisma.executionRun
            .findUnique({
              where: { id: validatedEvent.runId },
              select: { projectId: true, branchId: true, fileId: true },
            })
            .catch(() => null);
          if (!dbRun) return;
          scope = {
            projectId: dbRun.projectId,
            branchId: dbRun.branchId,
            fileId: dbRun.fileId,
          };
          verifiedRunScopeCache.set(validatedEvent.runId, scope);
          if (verifiedRunScopeCache.size > 2000) {
            const oldestKey = verifiedRunScopeCache.keys().next().value;
            if (oldestKey) verifiedRunScopeCache.delete(oldestKey);
          }
        }

        if (
          scope.projectId !== validatedEvent.projectId ||
          scope.branchId !== validatedEvent.branchId ||
          scope.fileId !== validatedEvent.fileId
        ) {
          return;
        }

        emitValidatedWorkerEvent(validatedEvent);
      })
      .finally(() => {
        if (runEmitQueues.get(validatedEvent.runId) === nextQueue) {
          runEmitQueues.delete(validatedEvent.runId);
        }
      });

    runEmitQueues.set(validatedEvent.runId, nextQueue);
  });

  registerProjectRealtimeHooks({
    evictProjectMember: (p) => {
      void evictUserFromProjectRealtime(p);
    },
    evictProjectAll: (p) => {
      void evictAllSocketsFromDeletedProject(p);
    },
    evictFileAccess: (p) => {
      void evictUserFromFileExecutionRealtime(p);
    },
    syncMemberRole: (p) => {
      void syncProjectMemberRoleRealtime(p);
    },
    evictDeletedBranch: (p) => {
      void evictDeletedBranchSockets(p);
    },
    evictDeletedFiles: (p) => {
      void evictDeletedFilesSockets(p);
    },
  });

  httpServer.once('close', () => {
    if (activeIoServer === io) {
      activeIoServer = null;
    }
    void closeRedisClient(workerEventsSub);
  });

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: RealtimeSocket) => {
    const user = socket.data.user;
    const socketWindowCounters = new Map<
      string,
      { count: number; resetAt: number }
    >();

    const allowSocketEvent = (
      bucket: string,
      maxEvents: number,
      windowMs: number
    ): boolean => {
      const now = Date.now();
      const current = socketWindowCounters.get(bucket);
      if (!current || now >= current.resetAt) {
        socketWindowCounters.set(bucket, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (current.count >= maxEvents) {
        return false;
      }
      current.count += 1;
      return true;
    };

    socket.on('file:join', async (payload, callback) => {
      try {
        if (!allowSocketEvent('file:join', 30, 10_000)) {
          callback?.({
            ok: false,
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many file room join attempts; slow down',
            },
          });
          return;
        }
        if (!payload || typeof payload !== 'object') {
          callback?.({
            ok: false,
            error: { code: 'INVALID_ID', message: 'Invalid join payload' },
          });
          return;
        }

        const ctx = await authorizeFileContext({
          projectId: payload.projectId,
          branchId: payload.branchId,
          fileId: payload.fileId,
          userId: user.id,
        });

        if (ctx.permission === 'denied') {
          callback?.({
            ok: false,
            error: {
              code: 'FILE_ACCESS_DENIED',
              message: 'You do not have access to this file',
            },
          });
          return;
        }

        const canJoinSeat = roomManager.canAdmitUserSeat({
          projectId: payload.projectId,
          userId: user.id,
          permission: ctx.permission,
          maxConcurrentEditors: ctx.maxConcurrentEditors,
        });

        if (!canJoinSeat) {
          callback?.({
            ok: false,
            error: {
              code: 'CONCURRENT_EDITOR_LIMIT',
              message: `Concurrent editor cap reached (${ctx.maxConcurrentEditors} active editors max)`,
            },
          });
          return;
        }

        const room = await roomManager.getOrLoadRoom({
          projectId: payload.projectId,
          branchId: payload.branchId,
          fileId: payload.fileId,
        });

        await socket.join(room.roomKey);
        roomManager.addSocketMember(room, {
          socketId: socket.id,
          userId: user.id,
          username: user.username,
          avatarUrl: user.avatarUrl,
          permission: ctx.permission,
        });

        const clientStateVector = payload.stateVector
          ? toUint8Array(payload.stateVector) ?? undefined
          : undefined;
        const yjsSyncUpdate = roomManager.encodeSyncUpdate(
          room,
          clientStateVector
        );
        const presence = roomManager.getRoomPresence(room.roomKey);

        socket.to(room.roomKey).emit('presence:state', {
          fileId: room.fileId,
          branchId: room.branchId,
          users: presence,
        });

        callback?.({
          ok: true,
          data: {
            roomKey: room.roomKey,
            fileId: room.fileId,
            branchId: room.branchId,
            permission: ctx.permission,
            version: room.version,
            preventSameLineEdit: ctx.preventSameLineEdit,
            maxConcurrentEditors: ctx.maxConcurrentEditors,
            yjsSyncUpdate,
            presence,
          },
        });
      } catch (err) {
        if (err instanceof AppError && err.code === 'INVALID_NODE_TYPE') {
          callback?.({
            ok: false,
            error: { code: 'INVALID_NODE_TYPE', message: err.message },
          });
          return;
        }
        callback?.({
          ok: false,
          error: toRealtimeError(err),
        });
      }
    });

    socket.on('file:leave', async (payload, callback) => {
      try {
        if (!payload || typeof payload !== 'object') {
          callback?.({ ok: false });
          return;
        }
        const validBranchId = assertValidUuid(payload.branchId, 'branch');
        const validFileId = assertValidUuid(payload.fileId, 'file');
        const roomKey = buildFileRoomKey(validBranchId, validFileId);

        await socket.leave(roomKey);
        const remaining = await roomManager.removeSocketFromRoom(
          roomKey,
          socket.id
        );

        if (remaining !== null && remaining.length > 0) {
          io.to(roomKey).emit('presence:state', {
            fileId: validFileId,
            branchId: validBranchId,
            users: remaining,
          });
        }

        callback?.({ ok: true });
      } catch {
        callback?.({ ok: false });
      }
    });

    socket.on('yjs:update', async (payload, callback) => {
      try {
        if (!allowSocketEvent('yjs:update', 180, 5_000)) {
          const error: RealtimeErrorDetail = {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Edit update rate limit exceeded; slow down',
          };
          socket.emit('realtime:error', error);
          callback?.({ ok: false, error });
          return;
        }
        if (!payload || typeof payload !== 'object') {
          const error: RealtimeErrorDetail = {
            code: 'INVALID_YJS_PAYLOAD',
            message: 'Invalid Yjs update payload',
          };
          socket.emit('realtime:error', error);
          callback?.({ ok: false, error });
          return;
        }

        const validProjectId = assertValidUuid(payload.projectId, 'project');
        const validBranchId = assertValidUuid(payload.branchId, 'branch');
        const validFileId = assertValidUuid(payload.fileId, 'file');
        const roomKey = buildFileRoomKey(validBranchId, validFileId);

        if (!socket.rooms.has(roomKey)) {
          const error: RealtimeErrorDetail = {
            code: 'NOT_IN_ROOM',
            message: 'Join the file room before broadcasting edits',
          };
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        const bytes = toUint8Array(payload.update);
        if (!bytes || bytes.byteLength === 0) {
          const error: RealtimeErrorDetail = {
            code: 'INVALID_YJS_PAYLOAD',
            message: 'Yjs update frame must be a non-empty binary payload',
          };
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        if (bytes.byteLength > REALTIME_MAX_FRAME_BYTES) {
          const error: RealtimeErrorDetail = {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Yjs update exceeds maximum frame limit of ${REALTIME_MAX_FRAME_BYTES} bytes`,
          };
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        // Re-verify live DB ACLs, role, branch protection, and locks before mutating CRDT state
        const ctx = await authorizeFileContext({
          projectId: validProjectId,
          branchId: validBranchId,
          fileId: validFileId,
          userId: user.id,
        });

        if (ctx.permission === 'denied') {
          await socket.leave(roomKey);
          const remaining = await roomManager.removeSocketFromRoom(
            roomKey,
            socket.id
          );
          if (remaining !== null && remaining.length > 0) {
            io.to(roomKey).emit('presence:state', {
              fileId: validFileId,
              branchId: validBranchId,
              users: remaining,
            });
          }

          const error: RealtimeErrorDetail = {
            code: 'FILE_ACCESS_DENIED',
            message: 'Your access to this file has been revoked',
          };
          socket.emit('file:permission', {
            projectId: validProjectId,
            branchId: validBranchId,
            fileId: validFileId,
            permission: 'denied',
            reason: error.message,
          });
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        try {
          ctx.assertWritable();
        } catch (writeErr) {
          const error = toRealtimeError(writeErr);
          socket.emit('file:permission', {
            projectId: validProjectId,
            branchId: validBranchId,
            fileId: validFileId,
            permission: 'read_only',
            reason: error.message,
          });
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        const applyResult = roomManager.applyClientUpdate(
          roomKey,
          bytes,
          socket.id
        );
        if (!applyResult.ok) {
          const error: RealtimeErrorDetail = {
            code: applyResult.code,
            message: applyResult.message,
          };
          socket.emit('realtime:error', { ...error, fileId: validFileId });
          callback?.({ ok: false, error });
          return;
        }

        socket.to(roomKey).emit('yjs:update', {
          fileId: validFileId,
          branchId: validBranchId,
          senderId: user.id,
          update: bytes,
        });

        callback?.({ ok: true });
      } catch (err) {
        const error = toRealtimeError(err);
        socket.emit('realtime:error', error);
        callback?.({ ok: false, error });
      }
    });

    socket.on('awareness:update', (payload) => {
      try {
        if (!payload || typeof payload !== 'object') return;

        const validBranchId = assertValidUuid(payload.branchId, 'branch');
        const validFileId = assertValidUuid(payload.fileId, 'file');
        const roomKey = buildFileRoomKey(validBranchId, validFileId);

        if (!socket.rooms.has(roomKey)) return;

        const cursor = sanitizeCursor(payload.cursor);
        const focusLine = toBoundedInt(payload.focusLine);
        const isTyping = Boolean(payload.isTyping);

        const updatedUser = roomManager.updateMemberAwareness(
          roomKey,
          socket.id,
          {
            cursor,
            focusLine,
            isTyping,
          }
        );

        if (!updatedUser) return;

        socket.to(roomKey).emit('awareness:update', {
          fileId: validFileId,
          branchId: validBranchId,
          user: updatedUser,
        });
      } catch {
        // Ignore malformed ephemeral awareness frames without terminating socket
      }
    });

    // Hook `disconnecting` rather than `disconnect` so `socket.rooms` is still populated
    // for downstream room/PubSub ref-count cleanup before Socket.IO evicts room memberships.
    socket.on('disconnecting', async () => {
      const affected = await roomManager.removeSocketFromAllRooms(socket.id);
      for (const roomInfo of affected) {
        if (roomInfo.users.length > 0) {
          io.to(roomInfo.roomKey).emit('presence:state', {
            fileId: roomInfo.fileId,
            branchId: roomInfo.branchId,
            users: roomInfo.users,
          });
        }
      }
    });

    // =====================================================================
    // Day 4: Live Code Execution Events
    // =====================================================================

    socket.on('execution:join', async (payload, callback) => {
      if (!allowSocketEvent('execution:join', 30, 10_000)) {
        callback?.({
          ok: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many execution room join attempts; slow down',
          },
        });
        return;
      }

      const parsed = parseSocketPayload(ExecutionJoinSocketSchema, payload);
      if (!parsed.ok) {
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      try {
        const detail = await getExecutionRunDetail({
          projectId: parsed.data.projectId,
          runId: parsed.data.runId,
          userId: user.id,
        });
        const { sourceCode: _omittedSourceCode, ...run } = detail;

        await socket.join(buildExecutionRoomKey(run.id));
        await socket.join(buildProjectWorkspaceRoomKey(run.projectId));

        callback?.({
          ok: true,
          data: {
            run,
            lastChunkSeq: activeRunLastSeq.get(run.id) ?? 0,
          },
        });
      } catch (err) {
        callback?.({ ok: false, error: toRealtimeError(err) });
      }
    });

    socket.on('execution:leave', async (payload, callback) => {
      const parsed = parseSocketPayload(ExecutionLeaveSocketSchema, payload);
      if (!parsed.ok) {
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      await socket.leave(buildExecutionRoomKey(parsed.data.runId));
      callback?.({ ok: true });
    });

    socket.on('execution:stdin', async (payload, callback) => {
      const parsed = parseSocketPayload(ExecutionStdinSchema, payload);
      if (!parsed.ok) {
        socket.emit('realtime:error', parsed.error);
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      const { runId, data } = parsed.data;

      try {
        const withinRate = await consumeSlidingWindowLimit({
          key: `codecollab:ratelimit:stdin:${user.id}`,
          maxRequests: EXECUTION_LIMITS.STDIN_RATE_LIMIT_MAX_CHUNKS,
          windowSec: EXECUTION_LIMITS.STDIN_RATE_LIMIT_WINDOW_SEC,
        });
        if (!withinRate) {
          const error: RealtimeErrorDetail = {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Stdin input rate limit exceeded; slow down input bursts',
          };
          socket.emit('realtime:error', { ...error, runId });
          callback?.({ ok: false, error });
          return;
        }

        const run = await prisma.executionRun.findUnique({
          where: { id: runId },
          select: {
            id: true,
            projectId: true,
            branchId: true,
            fileId: true,
            userId: true,
            status: true,
          },
        });

        if (!run) {
          const error: RealtimeErrorDetail = {
            code: 'EXECUTION_NOT_FOUND',
            message: 'Execution run not found',
          };
          socket.emit('realtime:error', { ...error, runId });
          callback?.({ ok: false, error });
          return;
        }

        const { role } = await assertProjectAccess(
          run.projectId,
          user.id,
          'editor'
        );

        if (run.userId !== user.id && role !== 'owner') {
          const error: RealtimeErrorDetail = {
            code: 'EXECUTION_FORBIDDEN',
            message:
              'Only the run creator or workspace owner can stream stdin to this run',
          };
          socket.emit('realtime:error', {
            ...error,
            projectId: run.projectId,
            runId,
          });
          callback?.({ ok: false, error });
          return;
        }

        if (run.fileId && role !== 'owner') {
          const perm = await resolveInheritedOverride(
            run.branchId,
            run.fileId,
            user.id
          );
          if (perm === 'denied') {
            const error: RealtimeErrorDetail = {
              code: 'FILE_ACCESS_DENIED',
              message: 'You do not have permission to interact with this run',
            };
            socket.emit('realtime:error', {
              ...error,
              projectId: run.projectId,
              runId,
              fileId: run.fileId,
            });
            callback?.({ ok: false, error });
            return;
          }
        }

        if (run.status !== 'RUNNING') {
          const error: RealtimeErrorDetail = {
            code: 'EXECUTION_NOT_RUNNING',
            message: 'Execution is not currently running',
          };
          socket.emit('realtime:error', {
            ...error,
            projectId: run.projectId,
            runId,
          });
          callback?.({ ok: false, error });
          return;
        }

        const utf8Bytes = Buffer.byteLength(data, 'utf8');
        const withinBudget = await reserveRunStdinBytes(run.id, utf8Bytes);
        if (!withinBudget) {
          const error: RealtimeErrorDetail = {
            code: 'PAYLOAD_TOO_LARGE',
            message: `Cumulative stdin limit (${EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES} bytes) exceeded for this run`,
          };
          socket.emit('realtime:error', {
            ...error,
            projectId: run.projectId,
            runId,
          });
          callback?.({ ok: false, error });
          return;
        }

        await publishExecutionStdin(run.id, data);
        callback?.({ ok: true });
      } catch (err) {
        const error = toRealtimeError(err);
        if (error.code === 'FILE_READ_ONLY') {
          error.code = 'EXECUTION_FORBIDDEN';
          error.message = 'Editor permissions are required to send stdin';
        }
        socket.emit('realtime:error', { ...error, runId });
        callback?.({ ok: false, error });
      }
    });

    // =====================================================================
    // Day 4: Real-Time Workspace Chat Events
    // =====================================================================

    socket.on('chat:join', async (payload, callback) => {
      if (!allowSocketEvent('chat:join', 30, 10_000)) {
        callback?.({
          ok: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many chat join requests; slow down',
          },
        });
        return;
      }
      const parsed = parseSocketPayload(ChatJoinLeaveSocketSchema, payload);
      if (!parsed.ok) {
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      try {
        const { role } = await assertProjectAccess(
          parsed.data.projectId,
          user.id
        );
        if (role === null) {
          callback?.({
            ok: false,
            error: {
              code: 'CHAT_FORBIDDEN',
              message: 'Only workspace members can join team chat',
            },
          });
          return;
        }

        await socket.join(buildProjectChatRoomKey(parsed.data.projectId));
        await socket.join(buildProjectWorkspaceRoomKey(parsed.data.projectId));
        callback?.({ ok: true });
      } catch (err) {
        callback?.({ ok: false, error: toRealtimeError(err) });
      }
    });

    socket.on('chat:leave', async (payload, callback) => {
      const parsed = parseSocketPayload(ChatJoinLeaveSocketSchema, payload);
      if (!parsed.ok) {
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      await socket.leave(buildProjectChatRoomKey(parsed.data.projectId));
      callback?.({ ok: true });
    });

    socket.on('chat:send', async (payload, callback) => {
      const parsed = parseSocketPayload(ChatSendSocketSchema, payload);
      if (!parsed.ok) {
        socket.emit('realtime:error', parsed.error);
        callback?.({ ok: false, error: parsed.error });
        return;
      }

      const { projectId, branchId, content, fileId, lineNumber } = parsed.data;
      const chatRoom = buildProjectChatRoomKey(projectId);

      if (!socket.rooms.has(chatRoom)) {
        const error: RealtimeErrorDetail = {
          code: 'NOT_IN_ROOM',
          message: 'Join the workspace chat room before sending messages',
        };
        socket.emit('realtime:error', { ...error, projectId });
        callback?.({ ok: false, error });
        return;
      }

      try {
        const message = await createProjectChatMessage({
          projectId,
          userId: user.id,
          input: { branchId, content, fileId, lineNumber },
        });

        await broadcastChatMessage(message);
        callback?.({ ok: true, data: message });
      } catch (err) {
        const error = toRealtimeError(err);
        if (error.code === 'FILE_READ_ONLY') {
          error.code = 'CHAT_FORBIDDEN';
          error.message = 'Editor permissions are required to send chat messages';
        }
        socket.emit('realtime:error', { ...error, projectId });
        callback?.({ ok: false, error });
      }
    });

    socket.on('chat:typing', async (payload) => {
      if (!allowSocketEvent('chat:typing', 20, 10_000)) return;
      const parsed = parseSocketPayload(ChatTypingSocketSchema, payload);
      if (!parsed.ok) return;

      const { projectId, isTyping } = parsed.data;
      const chatRoom = buildProjectChatRoomKey(projectId);
      if (!socket.rooms.has(chatRoom)) return;

      try {
        await assertProjectAccess(projectId, user.id, 'editor');
        socket.to(chatRoom).emit('chat:typing', {
          projectId,
          userId: user.id,
          username: user.username,
          isTyping,
        });
      } catch {
        // Ignore unauthorized/ephemeral typing updates
      }
    });
  });

  return io;
};
