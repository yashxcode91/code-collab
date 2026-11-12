import { COLLAB_LIMITS, FileAccessPermission } from './project';

/**
 * 10 high-contrast collaborator cursor colors matching `COLLAB_LIMITS.MAX_CONCURRENT_EDITORS` (10),
 * tuned for readability on both dark (`#0b0e14`) and light (`#fcfcfd`) studio surfaces.
 */
export const COLLABORATOR_CURSOR_COLORS = [
  '#f97316', // 1. Signal Orange
  '#06b6d4', // 2. Cyan
  '#a855f7', // 3. Violet
  '#10b981', // 4. Emerald
  '#f43f5e', // 5. Rose
  '#3b82f6', // 6. Blue
  '#eab308', // 7. Amber
  '#ec4899', // 8. Pink
  '#14b8a6', // 9. Teal
  '#84cc16', // 10. Lime
] as const;

/**
 * Deterministically assigns a palette color from a user UUID so every client
 * sees the same cursor color for a given collaborator without extra DB storage.
 */
export const getCollaboratorColor = (userId: string): string => {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return COLLABORATOR_CURSOR_COLORS[hash % COLLABORATOR_CURSOR_COLORS.length];
};

/**
 * Machine-readable error codes emitted by the real-time Socket.IO gateway.
 */
export type RealtimeErrorCode =
  | 'UNAUTHORIZED'
  | 'INVALID_ID'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_FORBIDDEN'
  | 'BRANCH_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'INVALID_NODE_TYPE'
  | 'FILE_ACCESS_DENIED'
  | 'FILE_READ_ONLY'
  | 'BRANCH_PROTECTED'
  | 'FILE_LOCKED'
  | 'CONCURRENT_EDITOR_LIMIT'
  | 'INVALID_YJS_PAYLOAD'
  | 'PAYLOAD_TOO_LARGE'
  | 'FILE_TOO_LARGE'
  | 'NOT_IN_ROOM'
  | 'INTERNAL_ERROR';

export interface RealtimeErrorDetail {
  code: RealtimeErrorCode;
  message: string;
}

/**
 * Current cursor/selection range in 1-based Monaco line/column coordinates.
 */
export interface RealtimeCursorSelection {
  anchorLine: number;
  anchorColumn: number;
  headLine: number;
  headColumn: number;
}

/**
 * Ephemeral collaborator state tracked per open file room.
 */
export interface RealtimePresenceUser {
  userId: string;
  username: string;
  avatarUrl?: string;
  permission: Exclude<FileAccessPermission, 'denied'>;
  color: string;
  isTyping: boolean;
  focusLine: number | null;
  cursor: RealtimeCursorSelection | null;
  lastActiveAt: number;
}

export interface FileRoomTarget {
  projectId: string;
  branchId: string;
  fileId: string;
}

export interface FileJoinPayload extends FileRoomTarget {
  /** Optional encoded Y.Doc state vector so reconnects pull only missing binary diffs. */
  stateVector?: Uint8Array;
}

export interface FileJoinAckData {
  roomKey: string;
  fileId: string;
  branchId: string;
  permission: Exclude<FileAccessPermission, 'denied'>;
  version: number;
  preventSameLineEdit: boolean;
  maxConcurrentEditors: number;
  /** Binary Yjs update frame to hydrate the client's local `Y.Doc`. */
  yjsSyncUpdate: Uint8Array;
  presence: RealtimePresenceUser[];
}

export interface FileJoinAck {
  ok: boolean;
  error?: RealtimeErrorDetail;
  data?: FileJoinAckData;
}

export interface YjsUpdateClientPayload extends FileRoomTarget {
  /** Encoded Yjs CRDT binary delta produced by client `Y.Doc` edits. */
  update: Uint8Array;
}

export interface YjsUpdateAck {
  ok: boolean;
  error?: RealtimeErrorDetail;
}

export interface YjsUpdateServerPayload {
  fileId: string;
  branchId: string;
  senderId: string;
  update: Uint8Array;
}

export interface AwarenessUpdateClientPayload extends FileRoomTarget {
  cursor: RealtimeCursorSelection | null;
  focusLine: number | null;
  isTyping: boolean;
}

export interface AwarenessUpdateServerPayload {
  fileId: string;
  branchId: string;
  user: RealtimePresenceUser;
}

export interface PresenceStatePayload {
  fileId: string;
  branchId: string;
  users: RealtimePresenceUser[];
}

export interface FilePermissionChangedPayload extends FileRoomTarget {
  permission: FileAccessPermission;
  reason?: string;
}

export interface RealtimeErrorPayload extends RealtimeErrorDetail {
  fileId?: string;
}

/** Canonical Socket.IO room identifier isolating files across branches. */
export const buildFileRoomKey = (branchId: string, fileId: string): string =>
  `branch:${branchId}:file:${fileId}`;

/** Shared ceiling on incoming Yjs update frames (matches `COLLAB_LIMITS`). */
export const REALTIME_MAX_FRAME_BYTES = COLLAB_LIMITS.MAX_YJS_UPDATE_BYTES;

/** Typed Socket.IO events accepted by the server from connected clients. */
export interface ClientToServerEvents {
  'file:join': (
    payload: FileJoinPayload,
    callback?: (ack: FileJoinAck) => void
  ) => void;
  'file:leave': (
    payload: FileRoomTarget,
    callback?: (ack: { ok: boolean }) => void
  ) => void;
  'yjs:update': (
    payload: YjsUpdateClientPayload,
    callback?: (ack: YjsUpdateAck) => void
  ) => void;
  'awareness:update': (payload: AwarenessUpdateClientPayload) => void;
}

/** Typed Socket.IO events emitted by the server to connected clients. */
export interface ServerToClientEvents {
  'yjs:update': (payload: YjsUpdateServerPayload) => void;
  'awareness:update': (payload: AwarenessUpdateServerPayload) => void;
  'presence:state': (payload: PresenceStatePayload) => void;
  'file:permission': (payload: FilePermissionChangedPayload) => void;
  'realtime:error': (payload: RealtimeErrorPayload) => void;
}
