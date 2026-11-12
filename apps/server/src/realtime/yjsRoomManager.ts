import * as Y from 'yjs';
import { prisma } from '@codecollab/database';
import {
  buildFileRoomKey,
  COLLAB_LIMITS,
  COLLABORATOR_CURSOR_COLORS,
  FileAccessPermission,
  getCollaboratorColor,
  RealtimeCursorSelection,
  RealtimePresenceUser,
} from '@codecollab/shared';

const DEFAULT_FLUSH_DEBOUNCE_MS = 1200;
const YJS_TEXT_KEY = 'monaco';

export interface SocketRoomMember {
  socketId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  permission: Exclude<FileAccessPermission, 'denied'>;
  presence: RealtimePresenceUser;
  lastAwarenessAt: number;
}

export interface ActiveYjsRoom {
  roomKey: string;
  projectId: string;
  branchId: string;
  fileId: string;
  doc: Y.Doc;
  version: number;
  dirty: boolean;
  flushTimer: NodeJS.Timeout | null;
  persistChain: Promise<void>;
  members: Map<string, SocketRoomMember>;
}

/**
 * Manages live in-memory `Y.Doc` rooms keyed by `branch:{branchId}:file:{fileId}`,
 * handles cold-start seeding from PostgreSQL (`yjsState` -> fallback `content`),
 * debounced & graceful-shutdown persistence of both CRDT binary state and text `content`,
 * workspace concurrent-editor seat counting, and ephemeral cursor/presence rosters.
 */
export class YjsRoomManager {
  private readonly rooms = new Map<string, ActiveYjsRoom>();
  private readonly loadingRooms = new Map<string, Promise<ActiveYjsRoom>>();
  private readonly debounceMs: number;

  constructor(debounceMs = DEFAULT_FLUSH_DEBOUNCE_MS) {
    this.debounceMs = debounceMs;
  }

  /** Gets an already-loaded room or cold-loads it safely without duplicate race loads. */
  async getOrLoadRoom(params: {
    projectId: string;
    branchId: string;
    fileId: string;
  }): Promise<ActiveYjsRoom> {
    const roomKey = buildFileRoomKey(params.branchId, params.fileId);
    const existing = this.rooms.get(roomKey);
    if (existing) {
      return existing;
    }

    const inFlight = this.loadingRooms.get(roomKey);
    if (inFlight) {
      return inFlight;
    }

    const loadPromise = this.coldLoadRoom(roomKey, params).finally(() => {
      this.loadingRooms.delete(roomKey);
    });
    this.loadingRooms.set(roomKey, loadPromise);
    return loadPromise;
  }

  private async coldLoadRoom(
    roomKey: string,
    params: { projectId: string; branchId: string; fileId: string }
  ): Promise<ActiveYjsRoom> {
    const file = await prisma.projectFile.findUnique({
      where: { id: params.fileId },
      select: {
        id: true,
        branchId: true,
        nodeType: true,
        content: true,
        yjsState: true,
        version: true,
      },
    });

    if (!file || file.branchId !== params.branchId || file.nodeType !== 'FILE') {
      throw new Error('FILE_NOT_FOUND');
    }

    const doc = new Y.Doc();
    let hydratedDirty = false;

    if (file.yjsState && file.yjsState.length > 0) {
      try {
        Y.applyUpdate(doc, new Uint8Array(file.yjsState), 'db-hydrate');
      } catch {
        // Corrupt binary snapshot: fall back cleanly to plain-text `content`
        doc.transact(() => {
          const yText = doc.getText(YJS_TEXT_KEY);
          if (file.content.length > 0) {
            yText.insert(0, file.content);
          }
        }, 'db-seed');
        hydratedDirty = true;
      }
    } else {
      doc.transact(() => {
        const yText = doc.getText(YJS_TEXT_KEY);
        if (file.content.length > 0) {
          yText.insert(0, file.content);
        }
      }, 'db-seed');
    }

    const room: ActiveYjsRoom = {
      roomKey,
      projectId: params.projectId,
      branchId: params.branchId,
      fileId: params.fileId,
      doc,
      version: file.version,
      dirty: hydratedDirty,
      flushTimer: null,
      persistChain: Promise.resolve(),
      members: new Map(),
    };

    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (
        origin === 'db-hydrate' ||
        origin === 'db-seed' ||
        origin === 'rest-sync'
      ) {
        return;
      }
      room.dirty = true;
      this.scheduleFlush(room);
    });

    this.rooms.set(roomKey, room);
    if (hydratedDirty) {
      this.scheduleFlush(room);
    }

    return room;
  }

  private scheduleFlush(room: ActiveYjsRoom): void {
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
    }
    room.flushTimer = setTimeout(() => {
      room.flushTimer = null;
      void this.flushRoom(room.roomKey);
    }, this.debounceMs);
  }

  /** Counts unique users currently occupying an `'edit'` seat across all open rooms in a project. */
  getActiveEditorUserIds(projectId: string): Set<string> {
    const editors = new Set<string>();
    for (const room of this.rooms.values()) {
      if (room.projectId !== projectId) continue;
      for (const member of room.members.values()) {
        if (member.permission === 'edit') {
          editors.add(member.userId);
        }
      }
    }
    return editors;
  }

  /** Checks whether admitting `userId` with `permission` respects `project.maxConcurrentEditors`. */
  canAdmitUserSeat(params: {
    projectId: string;
    userId: string;
    permission: Exclude<FileAccessPermission, 'denied'>;
    maxConcurrentEditors: number;
  }): boolean {
    if (params.permission !== 'edit') {
      return true;
    }
    const activeEditors = this.getActiveEditorUserIds(params.projectId);
    if (activeEditors.has(params.userId)) {
      return true;
    }
    return activeEditors.size < params.maxConcurrentEditors;
  }

  private assignRoomColor(room: ActiveYjsRoom, userId: string): string {
    const usedColors = new Set<string>();
    for (const existing of room.members.values()) {
      if (existing.userId === userId) {
        return existing.presence.color;
      }
      usedColors.add(existing.presence.color);
    }

    const preferred = getCollaboratorColor(userId);
    if (!usedColors.has(preferred)) {
      return preferred;
    }

    const freeColor = COLLABORATOR_CURSOR_COLORS.find(
      (c) => !usedColors.has(c)
    );
    return freeColor ?? preferred;
  }

  /** Registers or refreshes a socket's membership inside an active room. */
  addSocketMember(
    room: ActiveYjsRoom,
    params: {
      socketId: string;
      userId: string;
      username: string;
      avatarUrl?: string;
      permission: Exclude<FileAccessPermission, 'denied'>;
    }
  ): SocketRoomMember {
    const presence: RealtimePresenceUser = {
      userId: params.userId,
      username: params.username,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
      permission: params.permission,
      color: this.assignRoomColor(room, params.userId),
      isTyping: false,
      focusLine: null,
      cursor: null,
      lastActiveAt: Date.now(),
    };

    const member: SocketRoomMember = {
      socketId: params.socketId,
      userId: params.userId,
      username: params.username,
      ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
      permission: params.permission,
      presence,
      lastAwarenessAt: 0,
    };

    room.members.set(params.socketId, member);
    return member;
  }

  /** Updates ephemeral cursor/focus state for a connected room member, with burst flood protection. */
  updateMemberAwareness(
    roomKey: string,
    socketId: string,
    input: {
      cursor: RealtimeCursorSelection | null;
      focusLine: number | null;
      isTyping: boolean;
    }
  ): RealtimePresenceUser | null {
    const room = this.rooms.get(roomKey);
    if (!room) return null;

    const member = room.members.get(socketId);
    if (!member) return null;

    const now = Date.now();
    const isExplicitClear =
      input.cursor === null && input.focusLine === null && !input.isTyping;

    if (
      !isExplicitClear &&
      now - member.lastAwarenessAt < COLLAB_LIMITS.AWARENESS_THROTTLE_MS
    ) {
      return null;
    }

    member.lastAwarenessAt = now;
    member.presence = {
      ...member.presence,
      cursor: input.cursor,
      focusLine: input.focusLine,
      isTyping: Boolean(input.isTyping),
      lastActiveAt: now,
    };

    return member.presence;
  }

  /** Returns deduplicated user presence list for a room (multiple tabs for the same user merge cleanly). */
  getRoomPresence(roomKey: string): RealtimePresenceUser[] {
    const room = this.rooms.get(roomKey);
    if (!room) return [];

    const byUser = new Map<string, RealtimePresenceUser>();
    for (const member of room.members.values()) {
      const prev = byUser.get(member.userId);
      if (!prev) {
        byUser.set(member.userId, member.presence);
        continue;
      }

      // Prefer most recently active tab, while keeping highest granted permission (`edit` > `read_only`)
      const latest =
        member.presence.lastActiveAt >= prev.lastActiveAt ? member.presence : prev;
      const mergedPermission: Exclude<FileAccessPermission, 'denied'> =
        prev.permission === 'edit' || member.presence.permission === 'edit'
          ? 'edit'
          : 'read_only';

      byUser.set(member.userId, {
        ...latest,
        permission: mergedPermission,
      });
    }

    return Array.from(byUser.values()).sort((a, b) =>
      a.username.localeCompare(b.username)
    );
  }

  /** Applies an untrusted client Yjs delta safely and verifies document size constraints. */
  applyClientUpdate(
    roomKey: string,
    update: Uint8Array,
    originSocketId: string
  ): { ok: true } | { ok: false; code: 'NOT_IN_ROOM' | 'INVALID_YJS_PAYLOAD' | 'FILE_TOO_LARGE'; message: string } {
    const room = this.rooms.get(roomKey);
    if (!room) {
      return {
        ok: false,
        code: 'NOT_IN_ROOM',
        message: 'File room is not active',
      };
    }

    const prevSnapshot = Y.encodeStateAsUpdate(room.doc);
    try {
      Y.applyUpdate(room.doc, update, originSocketId);
    } catch {
      return {
        ok: false,
        code: 'INVALID_YJS_PAYLOAD',
        message: 'Malformed Yjs binary update frame',
      };
    }

    const currentTextLength = room.doc.getText(YJS_TEXT_KEY).length;
    if (currentTextLength > COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS) {
      // Roll back document cleanly if a single update exceeds max file character ceiling
      const rollbackDoc = new Y.Doc();
      Y.applyUpdate(rollbackDoc, prevSnapshot, 'rollback');
      const diffFromBroken = Y.encodeStateAsUpdate(
        rollbackDoc,
        Y.encodeStateVector(room.doc)
      );
      if (diffFromBroken.byteLength > 0) {
        Y.applyUpdate(room.doc, diffFromBroken, 'rollback');
      }
      rollbackDoc.destroy();
      return {
        ok: false,
        code: 'FILE_TOO_LARGE',
        message: `File exceeds maximum size of ${COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS} characters`,
      };
    }

    return { ok: true };
  }

  /** Encodes the Y.Doc delta needed by a joining client based on an optional `stateVector`. */
  encodeSyncUpdate(room: ActiveYjsRoom, stateVector?: Uint8Array): Uint8Array {
    if (stateVector && stateVector.byteLength > 0) {
      try {
        return Y.encodeStateAsUpdate(room.doc, stateVector);
      } catch {
        // Invalid client state vector falls back to full state snapshot
      }
    }
    return Y.encodeStateAsUpdate(room.doc);
  }

  /** Removes a socket from a room and flushes/evicts the room once empty. */
  async removeSocketFromRoom(
    roomKey: string,
    socketId: string
  ): Promise<RealtimePresenceUser[] | null> {
    const room = this.rooms.get(roomKey);
    if (!room) return null;

    const existed = room.members.delete(socketId);
    if (!existed) return null;

    const remainingPresence = this.getRoomPresence(roomKey);

    if (room.members.size === 0) {
      if (room.flushTimer) {
        clearTimeout(room.flushTimer);
        room.flushTimer = null;
      }
      await this.flushRoom(roomKey);

      // Re-check emptiness after async flush before destroying in-memory `Y.Doc`
      const stillActive = this.rooms.get(roomKey);
      if (stillActive && stillActive.members.size === 0) {
        stillActive.doc.destroy();
        this.rooms.delete(roomKey);
      }
    }

    return remainingPresence;
  }

  /** Removes a disconnecting socket from every room it had joined. */
  async removeSocketFromAllRooms(
    socketId: string
  ): Promise<Array<{ roomKey: string; branchId: string; fileId: string; users: RealtimePresenceUser[] }>> {
    const affected: Array<{
      roomKey: string;
      branchId: string;
      fileId: string;
      users: RealtimePresenceUser[];
    }> = [];

    for (const room of Array.from(this.rooms.values())) {
      if (!room.members.has(socketId)) continue;
      const users = await this.removeSocketFromRoom(room.roomKey, socketId);
      if (users !== null) {
        affected.push({
          roomKey: room.roomKey,
          branchId: room.branchId,
          fileId: room.fileId,
          users,
        });
      }
    }

    return affected;
  }

  /** Serializes and flushes pending CRDT + text state for a single room to PostgreSQL. */
  async flushRoom(roomKey: string): Promise<void> {
    const room = this.rooms.get(roomKey);
    if (!room) return;

    room.persistChain = room.persistChain.then(async () => {
      if (!room.dirty) return;

      const yjsState = Buffer.from(Y.encodeStateAsUpdate(room.doc));
      const content = room.doc.getText(YJS_TEXT_KEY).toString();
      if (content.length > COLLAB_LIMITS.MAX_FILE_CONTENT_CHARS) {
        return;
      }

      // Clear dirty before await so concurrent edits made mid-save trigger one more flush
      room.dirty = false;

      const res = await prisma.projectFile.updateMany({
        where: { id: room.fileId },
        data: {
          yjsState,
          content,
          version: { increment: 1 },
        },
      });

      if (res.count > 0) {
        room.version += 1;
      }
    });

    await room.persistChain;
  }

  /** Synchronizes an active in-memory room when content is updated directly via REST API. */
  syncFileContentFromRest(
    branchId: string,
    fileId: string,
    nextContent: string,
    nextVersion: number
  ): Uint8Array | null {
    const roomKey = buildFileRoomKey(branchId, fileId);
    const room = this.rooms.get(roomKey);
    if (!room) return null;

    let emittedDelta: Uint8Array | null = null;
    const captureHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === 'rest-sync') {
        emittedDelta = update;
      }
    };

    room.doc.on('update', captureHandler);
    try {
      room.doc.transact(() => {
        const yText = room.doc.getText(YJS_TEXT_KEY);
        if (yText.length > 0) {
          yText.delete(0, yText.length);
        }
        if (nextContent.length > 0) {
          yText.insert(0, nextContent);
        }
      }, 'rest-sync');
    } finally {
      room.doc.off('update', captureHandler);
    }

    room.dirty = false;
    room.version = nextVersion;
    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }

    return emittedDelta;
  }

  /** Drops an in-memory room when the underlying file or folder is deleted via REST. */
  destroyRoomIfLoaded(branchId: string, fileId: string): void {
    const roomKey = buildFileRoomKey(branchId, fileId);
    const room = this.rooms.get(roomKey);
    if (!room) return;

    if (room.flushTimer) {
      clearTimeout(room.flushTimer);
      room.flushTimer = null;
    }
    room.doc.destroy();
    this.rooms.delete(roomKey);
  }

  /** Flushes all dirty rooms belonging to a specific branch before diff/merge inspection. */
  async flushBranchRooms(branchId: string): Promise<void> {
    const branchKeys: string[] = [];
    for (const [key, room] of this.rooms.entries()) {
      if (room.branchId === branchId) {
        if (room.flushTimer) {
          clearTimeout(room.flushTimer);
          room.flushTimer = null;
        }
        branchKeys.push(key);
      }
    }
    await Promise.all(branchKeys.map((key) => this.flushRoom(key)));
  }

  /** Drops all in-memory rooms belonging to a deleted branch. */
  destroyBranchRooms(branchId: string): void {
    for (const [key, room] of Array.from(this.rooms.entries())) {
      if (room.branchId !== branchId) continue;
      if (room.flushTimer) {
        clearTimeout(room.flushTimer);
        room.flushTimer = null;
      }
      room.doc.destroy();
      this.rooms.delete(key);
    }
  }

  /** Flushes all dirty rooms cleanly (called during server shutdown and test teardown). */
  async flushAllRooms(): Promise<void> {
    const keys = Array.from(this.rooms.keys());
    for (const key of keys) {
      const room = this.rooms.get(key);
      if (room?.flushTimer) {
        clearTimeout(room.flushTimer);
        room.flushTimer = null;
      }
    }
    await Promise.all(keys.map((key) => this.flushRoom(key)));
  }

  /** Destroys all in-memory rooms cleanly after flushing (used on server shutdown). */
  async closeAll(): Promise<void> {
    await this.flushAllRooms();
    for (const room of this.rooms.values()) {
      if (room.flushTimer) {
        clearTimeout(room.flushTimer);
        room.flushTimer = null;
      }
      room.doc.destroy();
    }
    this.rooms.clear();
  }

  /** Exposes room metrics primarily for integration testing and diagnostics. */
  getLoadedRoomCount(): number {
    return this.rooms.size;
  }
}

export const yjsRoomManager = new YjsRoomManager();
