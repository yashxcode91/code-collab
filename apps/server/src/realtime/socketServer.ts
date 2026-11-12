import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  buildFileRoomKey,
  ClientToServerEvents,
  FileAccessPermission,
  REALTIME_MAX_FRAME_BYTES,
  RealtimeCursorSelection,
  RealtimeErrorCode,
  RealtimeErrorDetail,
  ServerToClientEvents,
} from '@codecollab/shared';
import { AppError } from '../utils/AppError';
import { getAllowedOrigin } from '../middleware/csrf.middleware';
import {
  assertBranchInProject,
  assertCanWriteFileNode,
  assertFileInBranch,
  assertProjectAccess,
  assertValidUuid,
  computeEffectiveFilePermission,
} from '../modules/projects/project.auth';
import { resolveInheritedOverride } from '../modules/projects/project.service';
import {
  RealtimeSocket,
  socketAuthMiddleware,
  SocketData,
} from './socketAuth';
import { yjsRoomManager, YjsRoomManager } from './yjsRoomManager';

export type TypedRealtimeIoServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const APP_ERROR_TO_REALTIME_CODE: Record<string, RealtimeErrorCode> = {
  INVALID_ID: 'INVALID_ID',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_FORBIDDEN: 'PROJECT_FORBIDDEN',
  BRANCH_NOT_FOUND: 'BRANCH_NOT_FOUND',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_READ_ONLY: 'FILE_READ_ONLY',
  BRANCH_PROTECTED: 'BRANCH_PROTECTED',
  FILE_LOCKED: 'FILE_LOCKED',
  INSUFFICIENT_ROLE: 'FILE_READ_ONLY',
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

  io.use(socketAuthMiddleware);

  io.on('connection', (socket: RealtimeSocket) => {
    const user = socket.data.user;

    socket.on('file:join', async (payload, callback) => {
      try {
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

    socket.on('disconnect', async () => {
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
  });

  return io;
};
