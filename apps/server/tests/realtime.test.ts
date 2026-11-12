import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { prisma } from '@codecollab/database';
import {
  ClientToServerEvents,
  COLLAB_LIMITS,
  FileJoinAck,
  PresenceStatePayload,
  RealtimeErrorPayload,
  ServerToClientEvents,
  YjsUpdateAck,
} from '@codecollab/shared';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import {
  createRealtimeServer,
  TypedRealtimeIoServer,
} from '../src/realtime/socketServer';
import { yjsRoomManager } from '../src/realtime/yjsRoomManager';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-realtime.codecollab.test';
const runId = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

interface TestUserSession {
  agent: ReturnType<typeof request.agent>;
  cookieHeader: string;
  id: string;
  username: string;
  email: string;
}

type TestClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const extractAuthCookie = (setCookie: string[] | string | undefined): string => {
  const list = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  for (const entry of list) {
    const firstPair = entry.split(';')[0]?.trim();
    if (firstPair && firstPair.startsWith('codecollab_token=')) {
      return firstPair;
    }
  }
  throw new Error('Expected Set-Cookie auth header on registration');
};

const registerSession = async (
  label: string,
  username: string
): Promise<TestUserSession> => {
  const email = makeTestEmail(label);
  const agent = request.agent(app);

  const res = await agent
    .post('/api/auth/register')
    .set('Origin', TRUSTED_ORIGIN)
    .send({
      email,
      username,
      password: 'Password123!',
    });

  expect(res.status).toBe(201);
  return {
    agent,
    cookieHeader: extractAuthCookie(res.headers['set-cookie']),
    id: res.body.data.user.id,
    username: res.body.data.user.username,
    email,
  };
};

const connectSocket = (
  baseUrl: string,
  options?: { cookie?: string; origin?: string }
): Promise<TestClientSocket> =>
  new Promise((resolve, reject) => {
    const extraHeaders: Record<string, string> = {};
    if (options?.origin !== undefined) {
      extraHeaders.Origin = options.origin;
    }
    if (options?.cookie !== undefined) {
      extraHeaders.Cookie = options.cookie;
    }

    const client: TestClientSocket = ioClient(baseUrl, {
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders,
    });

    const onConnect = () => {
      client.off('connect_error', onError);
      resolve(client);
    };
    const onError = (err: Error) => {
      client.off('connect', onConnect);
      client.close();
      reject(err);
    };

    client.once('connect', onConnect);
    client.once('connect_error', onError);
  });

const joinRoom = (
  socket: TestClientSocket,
  payload: {
    projectId: string;
    branchId: string;
    fileId: string;
    stateVector?: Uint8Array;
  }
): Promise<FileJoinAck> =>
  new Promise((resolve) => {
    socket.emit('file:join', payload, (ack) => resolve(ack));
  });

const leaveRoom = (
  socket: TestClientSocket,
  payload: { projectId: string; branchId: string; fileId: string }
): Promise<{ ok: boolean }> =>
  new Promise((resolve) => {
    socket.emit('file:leave', payload, (ack) => resolve(ack));
  });

const sendYjsUpdate = (
  socket: TestClientSocket,
  payload: {
    projectId: string;
    branchId: string;
    fileId: string;
    update: Uint8Array;
  }
): Promise<YjsUpdateAck> =>
  new Promise((resolve) => {
    socket.emit('yjs:update', payload, (ack) => resolve(ack));
  });

const disconnectSocket = (socket: TestClientSocket): Promise<void> =>
  new Promise((resolve) => {
    if (!socket.connected) {
      socket.close();
      resolve();
      return;
    }
    socket.once('disconnect', () => resolve());
    socket.disconnect();
  });

/**
 * Integration test suite for Day 3 Step 7 (Real-time Socket.IO + Yjs Gateway):
 * Tests handshake JWT/Origin security, per-file/folder ACL enforcement, read-only rejection,
 * CRDT multi-editor convergence, PostgreSQL dual persistence (`yjsState` + `content`),
 * REST content cache invalidation, live file locks, malformed/oversized frames,
 * workspace concurrent-editor limits, and ephemeral cursor awareness.
 */
describe('Real-Time Collaboration Gateway (Socket.IO + Yjs)', () => {
  let httpServer: http.Server;
  let ioServer: TypedRealtimeIoServer;
  let baseUrl: string;

  let owner: TestUserSession;
  let editor: TestUserSession;
  let viewer: TestUserSession;
  let outsider: TestUserSession;

  let projectId: string;
  let mainBranchId: string;
  let srcFolderId: string;
  let readmeFileId: string;
  let srcIndexFileId: string;
  let deniedFileId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    [owner, editor, viewer, outsider] = await Promise.all([
      registerSession('owner', `rt_${runId}_owner`),
      registerSession('editor', `rt_${runId}_editor`),
      registerSession('viewer', `rt_${runId}_viewer`),
      registerSession('outsider', `rt_${runId}_out`),
    ]);

    const createProj = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'Realtime Lab',
        language: 'typescript',
        isPublic: false,
        maxConcurrentEditors: 5,
      });
    expect(createProj.status).toBe(201);
    projectId = createProj.body.data.project.id;

    const detailRes = await owner.agent.get(`/api/projects/${projectId}`);
    mainBranchId = detailRes.body.data.branches[0].id;

    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: editor.username, role: 'editor' });

    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: viewer.username, role: 'viewer' });

    const treeRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/files`
    );
    const nodes = treeRes.body.data.files as Array<{
      id: string;
      name: string;
      nodeType: string;
      parentId: string | null;
    }>;

    srcFolderId = nodes.find((n) => n.name === 'src' && n.nodeType === 'folder')!.id;
    readmeFileId = nodes.find((n) => n.name === 'README.md')!.id;
    srcIndexFileId = nodes.find((n) => n.name === 'index.ts')!.id;

    // Create a secret file and restrict it to `denied` for `editor`
    const secretRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'secrets.ts',
        nodeType: 'file',
        content: 'export const API_KEY = "top-secret";',
      });
    expect(secretRes.status).toBe(201);
    deniedFileId = secretRes.body.data.file.id;

    const aclRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${deniedFileId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor.id, permission: 'denied' });
    expect(aclRes.status).toBe(200);

    // Boot real HTTP + Socket.IO server on an ephemeral localhost port
    httpServer = http.createServer(app);
    ioServer = createRealtimeServer(httpServer, yjsRoomManager);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await yjsRoomManager.closeAll();
    if (ioServer) {
      await ioServer.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });
    await prisma.$disconnect();
    if (redis.status === 'ready') {
      await redis.quit();
    } else {
      redis.disconnect();
    }
  });

  it('rejects WebSocket handshakes with missing cookie, forged token, or untrusted Origin', async () => {
    await expect(
      connectSocket(baseUrl, { origin: TRUSTED_ORIGIN })
    ).rejects.toThrow(/UNAUTHORIZED/);

    await expect(
      connectSocket(baseUrl, {
        origin: TRUSTED_ORIGIN,
        cookie: 'codecollab_token=tampered.jwt.token',
      })
    ).rejects.toThrow(/INVALID_TOKEN/);

    await expect(
      connectSocket(baseUrl, {
        origin: 'http://evil-site.test',
        cookie: owner.cookieHeader,
      })
    ).rejects.toThrow(/CORS_ORIGIN_FORBIDDEN/);

    await expect(
      connectSocket(baseUrl, {
        cookie: owner.cookieHeader,
      })
    ).rejects.toThrow(/CORS_ORIGIN_FORBIDDEN/);
  });

  it('enforces room-join ACLs: rejects outsiders, folders, and denied per-file rules', async () => {
    const outsiderSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: outsider.cookieHeader,
    });
    const editorSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: editor.cookieHeader,
    });

    try {
      const outsiderJoin = await joinRoom(outsiderSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(outsiderJoin.ok).toBe(false);
      expect(outsiderJoin.error?.code).toBe('PROJECT_FORBIDDEN');

      const folderJoin = await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcFolderId,
      });
      expect(folderJoin.ok).toBe(false);
      expect(folderJoin.error?.code).toBe('INVALID_NODE_TYPE');

      const deniedJoin = await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: deniedFileId,
      });
      expect(deniedJoin.ok).toBe(false);
      expect(deniedJoin.error?.code).toBe('FILE_ACCESS_DENIED');
    } finally {
      await Promise.all([
        disconnectSocket(outsiderSocket),
        disconnectSocket(editorSocket),
      ]);
    }
  });

  it('blocks read-only viewers from mutating Y.Doc or broadcasting yjs:update', async () => {
    const ownerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const viewerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: viewer.cookieHeader,
    });

    try {
      const ownerJoin = await joinRoom(ownerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(ownerJoin.ok).toBe(true);
      expect(ownerJoin.data?.permission).toBe('edit');

      const viewerJoin = await joinRoom(viewerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(viewerJoin.ok).toBe(true);
      expect(viewerJoin.data?.permission).toBe('read_only');

      const viewerDoc = new Y.Doc();
      Y.applyUpdate(viewerDoc, new Uint8Array(viewerJoin.data!.yjsSyncUpdate));
      const beforeText = viewerDoc.getText('monaco').toString();
      expect(beforeText).toContain('Realtime Lab');

      let ownerReceivedUpdate = false;
      ownerSocket.once('yjs:update', () => {
        ownerReceivedUpdate = true;
      });

      const errorPromise = new Promise<RealtimeErrorPayload>((resolve) => {
        viewerSocket.once('realtime:error', resolve);
      });

      // Viewer tries to forge a binary delta locally and push it
      let forgedDelta!: Uint8Array;
      viewerDoc.on('update', (u: Uint8Array) => {
        forgedDelta = u;
      });
      viewerDoc.getText('monaco').insert(0, 'HACKED BY VIEWER\n');

      const ack = await sendYjsUpdate(viewerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
        update: forgedDelta,
      });
      const errEvent = await errorPromise;

      expect(ack.ok).toBe(false);
      expect(ack.error?.code).toBe('FILE_READ_ONLY');
      expect(errEvent.code).toBe('FILE_READ_ONLY');
      expect(ownerReceivedUpdate).toBe(false);

      viewerDoc.destroy();
    } finally {
      await Promise.all([
        disconnectSocket(ownerSocket),
        disconnectSocket(viewerSocket),
      ]);
    }
  });

  it('converges concurrent multi-editor CRDT edits and persists both yjsState and content to PostgreSQL', async () => {
    const ownerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const editorSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: editor.cookieHeader,
    });

    const ownerDoc = new Y.Doc();
    const editorDoc = new Y.Doc();

    try {
      const [ownerJoin, editorJoin] = await Promise.all([
        joinRoom(ownerSocket, {
          projectId,
          branchId: mainBranchId,
          fileId: srcIndexFileId,
        }),
        joinRoom(editorSocket, {
          projectId,
          branchId: mainBranchId,
          fileId: srcIndexFileId,
        }),
      ]);

      expect(ownerJoin.ok).toBe(true);
      expect(editorJoin.ok).toBe(true);

      Y.applyUpdate(
        ownerDoc,
        new Uint8Array(ownerJoin.data!.yjsSyncUpdate),
        'server-sync'
      );
      Y.applyUpdate(
        editorDoc,
        new Uint8Array(editorJoin.data!.yjsSyncUpdate),
        'server-sync'
      );

      // Wire peer updates into local Y.Docs cleanly
      const ownerSynced = new Promise<void>((resolve) => {
        ownerSocket.on('yjs:update', (msg) => {
          Y.applyUpdate(ownerDoc, new Uint8Array(msg.update), 'remote');
          resolve();
        });
      });
      const editorSynced = new Promise<void>((resolve) => {
        editorSocket.on('yjs:update', (msg) => {
          Y.applyUpdate(editorDoc, new Uint8Array(msg.update), 'remote');
          resolve();
        });
      });

      const captureUpdate = (doc: Y.Doc, editFn: () => void): Uint8Array => {
        let captured!: Uint8Array;
        const handler = (u: Uint8Array) => {
          captured = u;
        };
        doc.on('update', handler);
        editFn();
        doc.off('update', handler);
        return captured;
      };

      const ownerDelta = captureUpdate(ownerDoc, () => {
        ownerDoc.getText('monaco').insert(0, '// Header from Owner\n');
      });
      const editorDelta = captureUpdate(editorDoc, () => {
        const yText = editorDoc.getText('monaco');
        yText.insert(yText.length, '\n// Footer from Editor');
      });

      const [ack1, ack2] = await Promise.all([
        sendYjsUpdate(ownerSocket, {
          projectId,
          branchId: mainBranchId,
          fileId: srcIndexFileId,
          update: ownerDelta,
        }),
        sendYjsUpdate(editorSocket, {
          projectId,
          branchId: mainBranchId,
          fileId: srcIndexFileId,
          update: editorDelta,
        }),
        ownerSynced,
        editorSynced,
      ]);

      expect(ack1.ok).toBe(true);
      expect(ack2.ok).toBe(true);

      // CRDT guarantees both docs converge to the exact same text regardless of order
      const finalOwnerText = ownerDoc.getText('monaco').toString();
      const finalEditorText = editorDoc.getText('monaco').toString();
      expect(finalOwnerText).toBe(finalEditorText);
      expect(finalOwnerText.startsWith('// Header from Owner\n')).toBe(true);
      expect(finalOwnerText.endsWith('\n// Footer from Editor')).toBe(true);

      // Disconnecting the last member triggers async DB flush & room eviction cleanly
      await disconnectSocket(ownerSocket);
      await disconnectSocket(editorSocket);
      await expect
        .poll(() => yjsRoomManager.getLoadedRoomCount(), { timeout: 2000 })
        .toBe(0);

      const persisted = await prisma.projectFile.findUnique({
        where: { id: srcIndexFileId },
        select: { content: true, yjsState: true },
      });
      expect(persisted?.content).toBe(finalOwnerText);
      expect(persisted?.yjsState).not.toBeNull();
      expect(persisted!.yjsState!.length).toBeGreaterThan(0);

      // Cold-load again as editor to confirm Yjs snapshot rehydrates intact
      const rejoinSocket = await connectSocket(baseUrl, {
        origin: TRUSTED_ORIGIN,
        cookie: editor.cookieHeader,
      });
      try {
        const rejoin = await joinRoom(rejoinSocket, {
          projectId,
          branchId: mainBranchId,
          fileId: srcIndexFileId,
        });
        expect(rejoin.ok).toBe(true);
        const coldDoc = new Y.Doc();
        Y.applyUpdate(coldDoc, new Uint8Array(rejoin.data!.yjsSyncUpdate));
        expect(coldDoc.getText('monaco').toString()).toBe(finalOwnerText);
        coldDoc.destroy();
      } finally {
        await disconnectSocket(rejoinSocket);
      }
    } finally {
      ownerDoc.destroy();
      editorDoc.destroy();
      await Promise.all([
        disconnectSocket(ownerSocket),
        disconnectSocket(editorSocket),
      ]);
    }
  });

  it('invalidates stale yjsState when content is updated via REST and re-seeds cleanly', async () => {
    const restText = '// Replaced via REST API\nconsole.log("fresh");\n';
    const patchRes = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcIndexFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: restText });
    expect(patchRes.status).toBe(200);

    const dbAfterRest = await prisma.projectFile.findUnique({
      where: { id: srcIndexFileId },
      select: { content: true, yjsState: true },
    });
    expect(dbAfterRest?.content).toBe(restText);
    expect(dbAfterRest?.yjsState).toBeNull();

    const socket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    try {
      const join = await joinRoom(socket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
      });
      expect(join.ok).toBe(true);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(join.data!.yjsSyncUpdate));
      expect(doc.getText('monaco').toString()).toBe(restText);
      doc.destroy();
    } finally {
      await disconnectSocket(socket);
    }
  });

  it('blocks live Yjs writes when a file is locked mid-session and rejects corrupt/oversized frames', async () => {
    const ownerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const editorSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: editor.cookieHeader,
    });

    try {
      await joinRoom(ownerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
      });
      const editorJoin = await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
      });
      expect(editorJoin.ok).toBe(true);

      // Owner acquires exclusive checkout lock mid-session via REST
      const lockRes = await owner.agent
        .post(
          `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcIndexFileId}/lock`
        )
        .set('Origin', TRUSTED_ORIGIN);
      expect(lockRes.status).toBe(200);

      const editorDoc = new Y.Doc();
      Y.applyUpdate(editorDoc, new Uint8Array(editorJoin.data!.yjsSyncUpdate));
      let delta!: Uint8Array;
      editorDoc.on('update', (u: Uint8Array) => {
        delta = u;
      });
      editorDoc.getText('monaco').insert(0, '// Blocked while locked\n');

      const lockedAck = await sendYjsUpdate(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
        update: delta,
      });
      expect(lockedAck.ok).toBe(false);
      expect(lockedAck.error?.code).toBe('FILE_LOCKED');

      // Unlock file via REST so further tests have clean state
      const unlockRes = await owner.agent
        .delete(
          `/api/projects/${projectId}/branches/${mainBranchId}/files/${srcIndexFileId}/lock`
        )
        .set('Origin', TRUSTED_ORIGIN);
      expect(unlockRes.status).toBe(200);

      // Malformed non-Yjs bytes rejected without crashing room
      const malformedAck = await sendYjsUpdate(ownerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
        update: new Uint8Array([255, 255, 255, 255]),
      });
      expect(malformedAck.ok).toBe(false);
      expect(malformedAck.error?.code).toBe('INVALID_YJS_PAYLOAD');

      // Oversized payload (> 256 KB) rejected cleanly
      const oversizedAck = await sendYjsUpdate(ownerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
        update: new Uint8Array(COLLAB_LIMITS.MAX_YJS_UPDATE_BYTES + 100),
      });
      expect(oversizedAck.ok).toBe(false);
      expect(oversizedAck.error?.code).toBe('PAYLOAD_TOO_LARGE');

      editorDoc.destroy();
    } finally {
      await Promise.all([
        disconnectSocket(ownerSocket),
        disconnectSocket(editorSocket),
      ]);
    }
  });

  it('enforces maxConcurrentEditors per workspace across unique editors while allowing multi-tab & viewers', async () => {
    const capRes = await owner.agent
      .patch(`/api/projects/${projectId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ maxConcurrentEditors: 1 });
    expect(capRes.status).toBe(200);

    const ownerTab1 = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const ownerTab2 = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const viewerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: viewer.cookieHeader,
    });
    const editorSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: editor.cookieHeader,
    });

    try {
      const tab1Join = await joinRoom(ownerTab1, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(tab1Join.ok).toBe(true);

      // Same user in second tab shares their 1 seat
      const tab2Join = await joinRoom(ownerTab2, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
      });
      expect(tab2Join.ok).toBe(true);

      // Read-only viewer does not consume an editor seat
      const viewerJoin = await joinRoom(viewerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(viewerJoin.ok).toBe(true);
      expect(viewerJoin.data?.permission).toBe('read_only');

      // Second unique editor hits cap=1
      const blockedEditor = await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(blockedEditor.ok).toBe(false);
      expect(blockedEditor.error?.code).toBe('CONCURRENT_EDITOR_LIMIT');

      // Freeing both owner tabs releases the seat so editor can now join
      await leaveRoom(ownerTab1, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      await leaveRoom(ownerTab2, {
        projectId,
        branchId: mainBranchId,
        fileId: srcIndexFileId,
      });

      const admittedEditor = await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      expect(admittedEditor.ok).toBe(true);
    } finally {
      await owner.agent
        .patch(`/api/projects/${projectId}`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ maxConcurrentEditors: 5 });

      await Promise.all([
        disconnectSocket(ownerTab1),
        disconnectSocket(ownerTab2),
        disconnectSocket(viewerSocket),
        disconnectSocket(editorSocket),
      ]);
    }
  });

  it('relays ephemeral awareness updates and clears presence on disconnect', async () => {
    const ownerSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: owner.cookieHeader,
    });
    const editorSocket = await connectSocket(baseUrl, {
      origin: TRUSTED_ORIGIN,
      cookie: editor.cookieHeader,
    });

    try {
      await joinRoom(ownerSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });
      await joinRoom(editorSocket, {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
      });

      const awarenessPromise = new Promise<{
        fileId: string;
        user: { userId: string; focusLine: number | null; isTyping: boolean };
      }>((resolve) => {
        ownerSocket.once('awareness:update', resolve);
      });

      editorSocket.emit('awareness:update', {
        projectId,
        branchId: mainBranchId,
        fileId: readmeFileId,
        focusLine: 12,
        isTyping: true,
        cursor: {
          anchorLine: 12,
          anchorColumn: 4,
          headLine: 12,
          headColumn: 8,
        },
      });

      const relayed = await awarenessPromise;
      expect(relayed.fileId).toBe(readmeFileId);
      expect(relayed.user.userId).toBe(editor.id);
      expect(relayed.user.focusLine).toBe(12);
      expect(relayed.user.isTyping).toBe(true);

      const leavePresencePromise = new Promise<PresenceStatePayload>((resolve) => {
        ownerSocket.once('presence:state', resolve);
      });

      await disconnectSocket(editorSocket);
      const afterLeave = await leavePresencePromise;
      expect(afterLeave.users.map((u) => u.userId)).toEqual([owner.id]);
    } finally {
      await Promise.all([
        disconnectSocket(ownerSocket),
        disconnectSocket(editorSocket),
      ]);
    }
  });
});
