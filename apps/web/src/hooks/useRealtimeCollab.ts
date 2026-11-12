import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import {
  buildFileRoomKey,
  COLLAB_LIMITS,
  type ClientToServerEvents,
  type FileAccessPermission,
  type FilePermissionChangedPayload,
  REALTIME_MAX_FRAME_BYTES,
  type RealtimeCursorSelection,
  type RealtimeErrorCode,
  type RealtimePresenceUser,
  type ServerToClientEvents,
} from '@codecollab/shared';

export type RealtimeConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

export type RealtimeSyncStatus = 'offline' | 'syncing' | 'synced';

export interface RealtimeErrorState {
  code: RealtimeErrorCode;
  message: string;
}

interface UseRealtimeCollabParams {
  projectId: string;
  branchId: string | null;
  fileId: string | null;
  enabled: boolean;
  onContentSynced?: (
    fileId: string,
    content: string,
    savedVersion?: number,
  ) => void;
  onPermissionChanged?: (payload: FilePermissionChangedPayload) => void;
}

export interface UseRealtimeCollabResult {
  socket: TypedClientSocket | null;
  connectionStatus: RealtimeConnectionStatus;
  syncStatus: RealtimeSyncStatus;
  roomReady: boolean;
  activeRoomKey: string | null;
  ydoc: Y.Doc | null;
  ytext: Y.Text | null;
  presenceUsers: RealtimePresenceUser[];
  serverPermission: FileAccessPermission | null;
  preventSameLineEdit: boolean | null;
  maxConcurrentEditors: number | null;
  realtimeError: RealtimeErrorState | null;
  clearRealtimeError: () => void;
  publishAwareness: (input: {
    cursor: RealtimeCursorSelection | null;
    focusLine: number | null;
    isTyping: boolean;
  }) => void;
}

export type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface ActiveRoomSession {
  projectId: string;
  branchId: string;
  fileId: string;
  roomKey: string;
  doc: Y.Doc;
  hydratedOnce: boolean;
  updateHandlerAttached: boolean;
}

/**
 * Manages the authenticated Socket.IO + Yjs room lifecycle for the active Studio file,
 * reconnecting transparently with Yjs state vectors, syncing remote CRDT deltas into
 * the local `Y.Doc`, updating live collaborator awareness, and surfacing server lock/ACL revocations.
 */
export function useRealtimeCollab({
  projectId,
  branchId,
  fileId,
  enabled,
  onContentSynced,
  onPermissionChanged,
}: UseRealtimeCollabParams): UseRealtimeCollabResult {
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>('disconnected');
  const [syncStatus, setSyncStatus] = useState<RealtimeSyncStatus>('offline');
  const [roomReady, setRoomReady] = useState(false);
  const [activeRoomKey, setActiveRoomKey] = useState<string | null>(null);
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [presenceUsers, setPresenceUsers] = useState<RealtimePresenceUser[]>(
    [],
  );
  const [serverPermission, setServerPermission] =
    useState<FileAccessPermission | null>(null);
  const [preventSameLineEdit, setPreventSameLineEdit] = useState<
    boolean | null
  >(null);
  const [maxConcurrentEditors, setMaxConcurrentEditors] = useState<
    number | null
  >(null);
  const [realtimeError, setRealtimeError] = useState<RealtimeErrorState | null>(
    null,
  );
  const [sharedSocket, setSharedSocket] = useState<TypedClientSocket | null>(
    null,
  );

  const socketRef = useRef<TypedClientSocket | null>(null);
  const activeSessionRef = useRef<ActiveRoomSession | null>(null);
  const pendingAckCountRef = useRef(0);
  const lastAwarenessSentRef = useRef(0);
  const trailingAwarenessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingAwarenessPayloadRef = useRef<{
    cursor: RealtimeCursorSelection | null;
    focusLine: number | null;
    isTyping: boolean;
  } | null>(null);

  const onContentSyncedRef = useRef(onContentSynced);
  onContentSyncedRef.current = onContentSynced;

  const onPermissionChangedRef = useRef(onPermissionChanged);
  onPermissionChangedRef.current = onPermissionChanged;

  const clearRealtimeError = useCallback(() => {
    setRealtimeError(null);
  }, []);

  const attachLocalUpdateForwarder = useCallback(
    (session: ActiveRoomSession, socket: TypedClientSocket) => {
      if (session.updateHandlerAttached) return;
      session.updateHandlerAttached = true;

      session.doc.on('update', (update: Uint8Array, origin: unknown) => {
        if (origin === 'server-sync' || origin === 'remote') {
          return;
        }
        if (activeSessionRef.current?.roomKey !== session.roomKey) {
          return;
        }
        if (update.byteLength > REALTIME_MAX_FRAME_BYTES) {
          setRealtimeError({
            code: 'PAYLOAD_TOO_LARGE',
            message: 'Edit delta exceeds 256 KB maximum frame limit',
          });
          return;
        }
        if (!socket.connected) {
          setSyncStatus('offline');
          return;
        }

        pendingAckCountRef.current += 1;
        setSyncStatus('syncing');

        socket.emit(
          'yjs:update',
          {
            projectId: session.projectId,
            branchId: session.branchId,
            fileId: session.fileId,
            update,
          },
          (ack) => {
            pendingAckCountRef.current = Math.max(
              0,
              pendingAckCountRef.current - 1,
            );

            if (activeSessionRef.current?.roomKey !== session.roomKey) {
              return;
            }

            if (ack?.ok) {
              if (pendingAckCountRef.current === 0) {
                setSyncStatus('synced');
                onContentSyncedRef.current?.(
                  session.fileId,
                  session.doc.getText('monaco').toString(),
                );
              }
            } else if (ack?.error) {
              setRealtimeError(ack.error);
              setSyncStatus(
                pendingAckCountRef.current === 0 ? 'synced' : 'syncing',
              );
            }
          },
        );
      });
    },
    [],
  );

  const joinRoomSession = useCallback(
    (socket: TypedClientSocket, session: ActiveRoomSession) => {
      if (!socket.connected) return;

      const stateVector = session.hydratedOnce
        ? Y.encodeStateVector(session.doc)
        : undefined;

      socket.emit(
        'file:join',
        {
          projectId: session.projectId,
          branchId: session.branchId,
          fileId: session.fileId,
          ...(stateVector ? { stateVector } : {}),
        },
        (ack) => {
          // Discard late join callbacks if user already switched tabs/branches
          if (activeSessionRef.current?.roomKey !== session.roomKey) {
            return;
          }

          if (!ack?.ok || !ack.data) {
            setRoomReady(false);
            setSyncStatus('offline');
            setRealtimeError(
              ack?.error ?? {
                code: 'INTERNAL_ERROR',
                message: 'Unable to join real-time collaboration room',
              },
            );
            return;
          }

          if (ack.data.yjsSyncUpdate && ack.data.yjsSyncUpdate.byteLength > 0) {
            Y.applyUpdate(
              session.doc,
              new Uint8Array(ack.data.yjsSyncUpdate),
              'server-sync',
            );
          }

          session.hydratedOnce = true;
          attachLocalUpdateForwarder(session, socket);

          setRealtimeError(null);
          setActiveRoomKey(ack.data.roomKey);
          setYdoc(session.doc);
          setPresenceUsers(ack.data.presence);
          setServerPermission(ack.data.permission);
          setPreventSameLineEdit(ack.data.preventSameLineEdit);
          setMaxConcurrentEditors(ack.data.maxConcurrentEditors);
          setRoomReady(true);
          setSyncStatus('synced');

          onContentSyncedRef.current?.(
            session.fileId,
            session.doc.getText('monaco').toString(),
            ack.data.version,
          );
        },
      );
    },
    [attachLocalUpdateForwarder],
  );

  // 1. Manage Socket.IO client connection lifetime per mounted Studio project
  useEffect(() => {
    if (!enabled || !projectId) {
      setConnectionStatus('disconnected');
      setSyncStatus('offline');
      return;
    }

    setConnectionStatus('connecting');

    const socket: TypedClientSocket = io({
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;
    setSharedSocket(socket);

    socket.on('connect', () => {
      setConnectionStatus('connected');
      const current = activeSessionRef.current;
      if (current) {
        joinRoomSession(socket, current);
      }
    });

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected');
      setSyncStatus('offline');
      setRoomReady(false);
    });

    socket.on('connect_error', (err) => {
      setConnectionStatus('error');
      setSyncStatus('offline');
      setRoomReady(false);
      setRealtimeError({
        code: 'UNAUTHORIZED',
        message:
          err.message === 'UNAUTHORIZED' || err.message === 'INVALID_TOKEN'
            ? 'Session authentication required for live collaboration'
            : 'Unable to reach real-time collaboration server',
      });
    });

    socket.on('yjs:update', (msg) => {
      const current = activeSessionRef.current;
      if (
        !current ||
        current.branchId !== msg.branchId ||
        current.fileId !== msg.fileId
      ) {
        return;
      }

      Y.applyUpdate(current.doc, new Uint8Array(msg.update), 'remote');
      onContentSyncedRef.current?.(
        current.fileId,
        current.doc.getText('monaco').toString(),
      );
    });

    socket.on('presence:state', (msg) => {
      const current = activeSessionRef.current;
      if (
        !current ||
        current.branchId !== msg.branchId ||
        current.fileId !== msg.fileId
      ) {
        return;
      }
      setPresenceUsers(msg.users);
    });

    socket.on('awareness:update', (msg) => {
      const current = activeSessionRef.current;
      if (
        !current ||
        current.branchId !== msg.branchId ||
        current.fileId !== msg.fileId
      ) {
        return;
      }

      setPresenceUsers((prev) => {
        const next = prev.filter((u) => u.userId !== msg.user.userId);
        next.push(msg.user);
        next.sort((a, b) => a.username.localeCompare(b.username));
        return next;
      });
    });

    socket.on('file:permission', (msg) => {
      const current = activeSessionRef.current;
      if (
        current &&
        current.branchId === msg.branchId &&
        current.fileId === msg.fileId
      ) {
        setServerPermission(msg.permission);
        if (msg.permission === 'denied') {
          current.doc.destroy();
          activeSessionRef.current = null;
          pendingAckCountRef.current = 0;
          setYdoc(null);
          setPresenceUsers([]);
          setRoomReady(false);
          setSyncStatus('offline');
        }
      }
      onPermissionChangedRef.current?.(msg);
    });

    socket.on('realtime:error', (err) => {
      if (err.runId) {
        return;
      }
      const current = activeSessionRef.current;
      if (
        err.code === 'UNAUTHORIZED' ||
        err.code === 'PROJECT_FORBIDDEN' ||
        err.code === 'PROJECT_NOT_FOUND' ||
        (err.code === 'FILE_ACCESS_DENIED' &&
          (!err.fileId || err.fileId === current?.fileId))
      ) {
        if (current) {
          current.doc.destroy();
          activeSessionRef.current = null;
          pendingAckCountRef.current = 0;
        }
        setYdoc(null);
        setPresenceUsers([]);
        setRoomReady(false);
        setSyncStatus('offline');
      }
      if (err.fileId && current && err.fileId !== current.fileId) {
        return;
      }
      setRealtimeError({ code: err.code, message: err.message });
    });

    return () => {
      if (trailingAwarenessTimerRef.current) {
        clearTimeout(trailingAwarenessTimerRef.current);
        trailingAwarenessTimerRef.current = null;
      }
      pendingAwarenessPayloadRef.current = null;
      const current = activeSessionRef.current;
      if (current && socket.connected) {
        socket.emit('file:leave', {
          projectId: current.projectId,
          branchId: current.branchId,
          fileId: current.fileId,
        });
      }
      if (current) {
        current.doc.destroy();
        activeSessionRef.current = null;
      }
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setSharedSocket(null);
      pendingAckCountRef.current = 0;
      setConnectionStatus('disconnected');
      setSyncStatus('offline');
      setRoomReady(false);
      setActiveRoomKey(null);
      setYdoc(null);
      setPresenceUsers([]);
      setServerPermission(null);
    };
  }, [enabled, projectId, joinRoomSession]);

  // 2. Switch Y.Doc rooms cleanly whenever `(branchId, fileId)` changes
  useEffect(() => {
    const socket = socketRef.current;
    const prev = activeSessionRef.current;

    if (prev) {
      if (socket?.connected) {
        socket.emit('file:leave', {
          projectId: prev.projectId,
          branchId: prev.branchId,
          fileId: prev.fileId,
        });
      }
      prev.doc.destroy();
      activeSessionRef.current = null;
      pendingAckCountRef.current = 0;
    }

    setRoomReady(false);
    setActiveRoomKey(null);
    setYdoc(null);
    setPresenceUsers([]);
    setServerPermission(null);
    setRealtimeError(null);
    setSyncStatus('offline');

    if (!enabled || !projectId || !branchId || !fileId) {
      return;
    }

    const roomKey = buildFileRoomKey(branchId, fileId);
    const doc = new Y.Doc();
    const session: ActiveRoomSession = {
      projectId,
      branchId,
      fileId,
      roomKey,
      doc,
      hydratedOnce: false,
      updateHandlerAttached: false,
    };

    activeSessionRef.current = session;
    setActiveRoomKey(roomKey);

    if (socket?.connected) {
      joinRoomSession(socket, session);
    }

    return () => {
      if (activeSessionRef.current === session) {
        if (socket?.connected) {
          socket.emit('file:leave', {
            projectId: session.projectId,
            branchId: session.branchId,
            fileId: session.fileId,
          });
        }
        session.doc.destroy();
        activeSessionRef.current = null;
        pendingAckCountRef.current = 0;
      }
    };
  }, [enabled, projectId, branchId, fileId, joinRoomSession]);

  const publishAwareness = useCallback(
    (input: {
      cursor: RealtimeCursorSelection | null;
      focusLine: number | null;
      isTyping: boolean;
    }) => {
      const socket = socketRef.current;
      const session = activeSessionRef.current;
      if (!socket?.connected || !session || !session.hydratedOnce) {
        return;
      }

      const emitNow = (payload: {
        cursor: RealtimeCursorSelection | null;
        focusLine: number | null;
        isTyping: boolean;
      }) => {
        const activeSocket = socketRef.current;
        const activeSession = activeSessionRef.current;
        if (
          !activeSocket?.connected ||
          !activeSession ||
          !activeSession.hydratedOnce
        ) {
          return;
        }
        lastAwarenessSentRef.current = Date.now();
        activeSocket.emit('awareness:update', {
          projectId: activeSession.projectId,
          branchId: activeSession.branchId,
          fileId: activeSession.fileId,
          cursor: payload.cursor,
          focusLine: payload.focusLine,
          isTyping: payload.isTyping,
        });
      };

      const now = Date.now();
      const elapsed = now - lastAwarenessSentRef.current;
      const isClear =
        input.cursor === null && input.focusLine === null && !input.isTyping;

      if (isClear || elapsed >= COLLAB_LIMITS.AWARENESS_THROTTLE_MS) {
        if (trailingAwarenessTimerRef.current) {
          clearTimeout(trailingAwarenessTimerRef.current);
          trailingAwarenessTimerRef.current = null;
        }
        pendingAwarenessPayloadRef.current = null;
        emitNow(input);
        return;
      }

      // Queue trailing-edge delivery with +25ms cushion so server throttle never drops final cursor
      pendingAwarenessPayloadRef.current = input;
      if (!trailingAwarenessTimerRef.current) {
        trailingAwarenessTimerRef.current = setTimeout(() => {
          trailingAwarenessTimerRef.current = null;
          const queued = pendingAwarenessPayloadRef.current;
          pendingAwarenessPayloadRef.current = null;
          if (queued) {
            emitNow(queued);
          }
        }, COLLAB_LIMITS.AWARENESS_THROTTLE_MS + 25 - elapsed);
      }
    },
    [],
  );

  return {
    socket: sharedSocket,
    connectionStatus,
    syncStatus,
    roomReady,
    activeRoomKey,
    ydoc,
    ytext: ydoc ? ydoc.getText('monaco') : null,
    presenceUsers,
    serverPermission,
    preventSameLineEdit,
    maxConcurrentEditors,
    realtimeError,
    clearRealtimeError,
    publishAwareness,
  };
}
