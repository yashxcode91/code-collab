import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { prisma } from '@codecollab/database';
import {
  type BranchRestoredPayload,
  type BranchSnapshotDetailDto,
  type BranchSnapshotSummaryDto,
  type ClientToServerEvents,
  type FileJoinAck,
  type RestoreSnapshotResultDto,
  type ServerToClientEvents,
  type SnapshotCreatedPayload,
  type SnapshotDiffResponse,
  type YjsUpdateAck,
  type YjsUpdateServerPayload,
} from '@codecollab/shared';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import {
  createRealtimeServer,
  type TypedRealtimeIoServer,
} from '../src/realtime/socketServer';
import { yjsRoomManager } from '../src/realtime/yjsRoomManager';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day5.codecollab.test';
const uidSuffix = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${uidSuffix}${TEST_EMAIL_DOMAIN}`;

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
  cookie: string
): Promise<TestClientSocket> =>
  new Promise((resolve, reject) => {
    const socket: TestClientSocket = ioClient(baseUrl, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: false,
      extraHeaders: {
        Origin: TRUSTED_ORIGIN,
        Cookie: cookie,
      },
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (err) => reject(err));
  });

describe('Day 5 Branch Snapshots & Version History API + Yjs Resync', () => {
  let httpServer: http.Server;
  let io: TypedRealtimeIoServer;
  let baseUrl: string;

  let owner: TestUserSession;
  let editor: TestUserSession;
  let editor2: TestUserSession;
  let viewer: TestUserSession;
  let outsider: TestUserSession;

  let projectId: string;
  let mainBranchId: string;
  let featureBranchId: string;
  let mainFileId: string;
  let secretFolderId: string;
  let secretFileId: string;

  let otherProjectId: string;
  let otherBranchId: string;

  const createdSockets: TestClientSocket[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    httpServer = http.createServer(app);
    io = createRealtimeServer(httpServer, yjsRoomManager);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    owner = await registerSession('owner', `d5_own_${uidSuffix}`);
    editor = await registerSession('editor', `d5_ed1_${uidSuffix}`);
    editor2 = await registerSession('editor2', `d5_ed2_${uidSuffix}`);
    viewer = await registerSession('viewer', `d5_vw_${uidSuffix}`);
    outsider = await registerSession('outsider', `d5_out_${uidSuffix}`);

    // Primary private workspace
    const createProj = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Day5 Snapshots ${uidSuffix}`,
        language: 'python',
        isPublic: false,
      });
    expect(createProj.status).toBe(201);
    projectId = createProj.body.data.project.id;
    mainBranchId = createProj.body.data.branches[0].id;

    // Create unprotected feature branch for editor workflows
    const featRes = await owner.agent
      .post(`/api/projects/${projectId}/branches`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'feature/snapshots', sourceBranchId: mainBranchId });
    expect(featRes.status).toBe(201);
    featureBranchId = featRes.body.data.branch.id;

    const filesRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files`
    );
    expect(filesRes.status).toBe(200);
    const featFiles = filesRes.body.data.files as Array<{
      id: string;
      nodeType: string;
      name: string;
    }>;
    mainFileId = featFiles.find((f) => f.nodeType === 'file')!.id;

    // Create confidential folder + nested file and deny `editor2` via folder ACL inheritance
    const folderRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'private', nodeType: 'folder' });
    expect(folderRes.status).toBe(201);
    secretFolderId = folderRes.body.data.file.id;

    const secretFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'keys.py',
        nodeType: 'file',
        parentId: secretFolderId,
        content: 'API_KEY = "super-secret-value"',
      });
    expect(secretFileRes.status).toBe(201);
    secretFileId = secretFileRes.body.data.file.id;

    for (const [u, role] of [
      [editor, 'editor'],
      [editor2, 'editor'],
      [viewer, 'viewer'],
    ] as const) {
      const mRes = await owner.agent
        .post(`/api/projects/${projectId}/members`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ identifier: u.email, role });
      expect(mRes.status).toBe(201);
    }

    const aclDenyRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${secretFolderId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor2.id, permission: 'denied' });
    expect(aclDenyRes.status).toBe(200);

    // Secondary workspace for IDOR isolation tests
    const otherProj = await outsider.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Day5 Outsider ${uidSuffix}`,
        language: 'python',
        isPublic: false,
      });
    expect(otherProj.status).toBe(201);
    otherProjectId = otherProj.body.data.project.id;
    otherBranchId = otherProj.body.data.branches[0].id;
  });

  afterAll(async () => {
    for (const s of createdSockets) {
      if (s.connected) s.disconnect();
    }
    await yjsRoomManager.closeAll();
    if (io) {
      await io.close();
    }
    if (httpServer && httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });
    await prisma.$disconnect();
    if (redis.status === 'ready') {
      await redis.quit();
    }
  });

  it('flushes live Yjs edits before snapshot capture, broadcasts snapshot:created, and enforces roles', async () => {
    // Outsider & Viewer cannot create snapshots
    const outsiderRes = await outsider.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Unauthorized capture' });
    expect(outsiderRes.status).toBe(403);

    const viewerRes = await viewer.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Viewer capture' });
    expect(viewerRes.status).toBe(403);

    // Editor connects to live Yjs room and pushes un-flushed edits into RAM
    const edSocket = await connectSocket(baseUrl, editor.cookieHeader);
    createdSockets.push(edSocket);

    const joinAck = await new Promise<FileJoinAck>((resolve) => {
      edSocket.emit(
        'file:join',
        { projectId, branchId: featureBranchId, fileId: mainFileId },
        (ack) => resolve(ack)
      );
    });
    expect(joinAck.ok).toBe(true);

    const clientDoc = new Y.Doc();
    Y.applyUpdate(clientDoc, new Uint8Array(joinAck.data!.yjsSyncUpdate));

    const editUpdate = await new Promise<Uint8Array>((resolve) => {
      clientDoc.once('update', (update: Uint8Array) => resolve(update));
      clientDoc.transact(() => {
        const yText = clientDoc.getText('monaco');
        yText.delete(0, yText.length);
        yText.insert(0, 'print("live-yjs-v1")\n');
      });
    });

    const yjsAck = await new Promise<YjsUpdateAck>((resolve) => {
      edSocket.emit(
        'yjs:update',
        {
          projectId,
          branchId: featureBranchId,
          fileId: mainFileId,
          update: editUpdate,
        },
        (ack) => resolve(ack)
      );
    });
    expect(yjsAck.ok).toBe(true);

    const createdEventPromise = new Promise<SnapshotCreatedPayload>(
      (resolve) => {
        edSocket.once('snapshot:created', (payload) => resolve(payload));
      }
    );

    const createSnapRes = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        title: 'Baseline live capture',
        description: 'Captured right after live Yjs keystroke',
      });
    expect(createSnapRes.status).toBe(201);
    const createdSnap = createSnapRes.body.data
      .snapshot as BranchSnapshotSummaryDto;
    expect(createdSnap.title).toBe('Baseline live capture');
    expect(createdSnap.createdBy?.id).toBe(editor.id);

    const broadcastPayload = await createdEventPromise;
    expect(broadcastPayload.snapshot.id).toBe(createdSnap.id);

    // Verify captured snapshot contains the un-debounced Yjs edit
    const detailRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${createdSnap.id}`
    );
    expect(detailRes.status).toBe(200);
    const detail = detailRes.body.data as BranchSnapshotDetailDto;
    const capturedMain = detail.files.find(
      (f) => f.originalFileId === mainFileId
    );
    expect(capturedMain?.content).toBe('print("live-yjs-v1")\n');
    expect(detail.redactedCount).toBe(0);

    clientDoc.destroy();
    edSocket.disconnect();
  });

  it('redacts denied folder/file paths in snapshot detail & diff and isolates cross-project IDOR', async () => {
    const snapRes = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'ACL check snapshot' });
    expect(snapRes.status).toBe(201);
    const snapId = snapRes.body.data.snapshot.id as string;

    // Modify secret file on live branch so it would otherwise appear in diff
    const patchSecret = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${secretFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'API_KEY = "rotated-secret-value"', version: 1 });
    expect(patchSecret.status).toBe(200);

    // editor2 is denied on `private/` folder -> neither `private` nor `private/keys.py` may leak
    const ed2DetailRes = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${snapId}`
    );
    expect(ed2DetailRes.status).toBe(200);
    const ed2Detail = ed2DetailRes.body.data as BranchSnapshotDetailDto;
    expect(ed2Detail.redactedCount).toBe(2);
    expect(
      ed2Detail.files.some(
        (f) => f.path.includes('private') || f.content.includes('super-secret')
      )
    ).toBe(false);

    const ed2DiffRes = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${snapId}/diff`
    );
    expect(ed2DiffRes.status).toBe(200);
    const ed2Diff = ed2DiffRes.body.data.diff as SnapshotDiffResponse;
    expect(ed2Diff.summary.redactedCount).toBeGreaterThanOrEqual(1);
    expect(ed2Diff.changes.some((c) => c.path.includes('private'))).toBe(false);

    // Owner sees full diff
    const ownerDiffRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${snapId}/diff`
    );
    expect(ownerDiffRes.status).toBe(200);
    const ownerDiff = ownerDiffRes.body.data.diff as SnapshotDiffResponse;
    const secretDiff = ownerDiff.changes.find(
      (c) => c.path === 'private/keys.py'
    );
    expect(secretDiff?.status).toBe('modified');
    expect(secretDiff?.baseContent).toContain('super-secret-value');
    expect(secretDiff?.targetContent).toContain('rotated-secret-value');

    // Cross-branch / cross-project IDOR rejected cleanly with 404
    const wrongBranch = await owner.agent.get(
      `/api/projects/${projectId}/branches/${mainBranchId}/snapshots/${snapId}`
    );
    expect(wrongBranch.status).toBe(404);

    const wrongProject = await outsider.agent.get(
      `/api/projects/${otherProjectId}/branches/${otherBranchId}/snapshots/${snapId}`
    );
    expect(wrongProject.status).toBe(404);
  });

  it('blocks snapshot restore on protected branches, locked files, or read_only ACL overrides atomically', async () => {
    // 1. Protected branch blocks editor restore
    const protectMain = await owner.agent
      .patch(`/api/projects/${projectId}/branches/${mainBranchId}`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ isProtected: true });
    expect(protectMain.status).toBe(200);

    const mainSnapRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${mainBranchId}/snapshots`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Protected main baseline' });
    expect(mainSnapRes.status).toBe(201);
    const mainSnapId = mainSnapRes.body.data.snapshot.id as string;

    const edMainRestore = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${mainBranchId}/snapshots/${mainSnapId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: true });
    expect(edMainRestore.status).toBe(403);
    expect(edMainRestore.body.error.code).toBe('BRANCH_PROTECTED');

    // 2. File lock on unprotected feature branch blocks editor restore atomically (no dangling safety backup)
    const featSnapBefore = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Lock test baseline' });
    expect(featSnapBefore.status).toBe(201);
    const lockBaselineId = featSnapBefore.body.data.snapshot.id as string;

    // Modify mainFileId so restore needs to write to it
    await yjsRoomManager.flushBranchRooms(featureBranchId);
    const curMain = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
    );
    const curVer = curMain.body.data.file.version as number;
    const modMain = await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'print("modified-while-locked")\n', version: curVer });
    expect(modMain.status).toBe(200);

    // Owner locks mainFileId
    const lockRes = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(lockRes.status).toBe(200);

    const beforeList = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
    );
    const countBeforeFailedRestore = (
      beforeList.body.data.snapshots as BranchSnapshotSummaryDto[]
    ).length;

    const edLockRestore = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${lockBaselineId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: true });
    expect(edLockRestore.status).toBe(403);
    expect(edLockRestore.body.error.code).toBe('FILE_LOCKED');

    // Verify safety backup rolled back cleanly
    const afterList = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
    );
    expect(
      (afterList.body.data.snapshots as BranchSnapshotSummaryDto[]).length
    ).toBe(countBeforeFailedRestore);

    // Unlock and set READ_ONLY override for editor -> restore must return FILE_READ_ONLY
    await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}/lock`
      )
      .set('Origin', TRUSTED_ORIGIN);

    await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor.id, permission: 'read_only' });

    const edRoRestore = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${lockBaselineId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: false });
    expect(edRoRestore.status).toBe(403);
    expect(edRoRestore.body.error.code).toBe('FILE_READ_ONLY');

    // Clean up READ_ONLY override for subsequent restore tests
    await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}/access/${editor.id}`
      )
      .set('Origin', TRUSTED_ORIGIN);
  });

  it('atomically restores deleted/modified/added nodes, creates safety snapshot, resyncs live Yjs rooms, and deletes snapshots safely', async () => {
    // Capture clean V1 snapshot including a temporary file `keep_me.py`
    const keepFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'keep_me.py',
        nodeType: 'file',
        content: 'VALUE = 1\n',
      });
    expect(keepFileRes.status).toBe(201);
    const keepFileId = keepFileRes.body.data.file.id as string;

    await yjsRoomManager.flushBranchRooms(featureBranchId);
    const mainDetail = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
    );
    await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        content: 'print("restore-target-v1")\n',
        version: mainDetail.body.data.file.version,
      });

    const v1SnapRes = await editor.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Clean V1 State' });
    expect(v1SnapRes.status).toBe(201);
    const v1SnapId = v1SnapRes.body.data.snapshot.id as string;

    // Mutate branch after V1: modify mainFileId, delete keep_me.py, add transient.py
    const mainAfterV1 = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
    );
    await owner.agent
      .patch(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${mainFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        content: 'print("drifted-v2")\n',
        version: mainAfterV1.body.data.file.version,
      });

    await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${keepFileId}`
      )
      .set('Origin', TRUSTED_ORIGIN);

    const transientRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'transient.py',
        nodeType: 'file',
        content: 'TEMP = True\n',
      });
    expect(transientRes.status).toBe(201);
    const transientId = transientRes.body.data.file.id as string;

    // Connect socket to both surviving mainFileId and soon-to-be-deleted transientId
    const collabSocket = await connectSocket(baseUrl, editor.cookieHeader);
    createdSockets.push(collabSocket);

    const mainJoin = await new Promise<FileJoinAck>((resolve) => {
      collabSocket.emit(
        'file:join',
        { projectId, branchId: featureBranchId, fileId: mainFileId },
        (ack) => resolve(ack)
      );
    });
    expect(mainJoin.ok).toBe(true);

    const transientJoin = await new Promise<FileJoinAck>((resolve) => {
      collabSocket.emit(
        'file:join',
        { projectId, branchId: featureBranchId, fileId: transientId },
        (ack) => resolve(ack)
      );
    });
    expect(transientJoin.ok).toBe(true);

    const collabMainDoc = new Y.Doc();
    Y.applyUpdate(collabMainDoc, new Uint8Array(mainJoin.data!.yjsSyncUpdate));
    expect(collabMainDoc.getText('monaco').toString()).toBe(
      'print("drifted-v2")\n'
    );

    const yjsUpdatePromise = new Promise<YjsUpdateServerPayload>((resolve) => {
      const handler = (payload: YjsUpdateServerPayload) => {
        if (payload.fileId === mainFileId) {
          collabSocket.off('yjs:update', handler);
          resolve(payload);
        }
      };
      collabSocket.on('yjs:update', handler);
    });

    const restoredEventPromise = new Promise<BranchRestoredPayload>(
      (resolve) => {
        collabSocket.once('branch:restored', (payload) => resolve(payload));
      }
    );

    const restoreRes = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${v1SnapId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: true });

    expect(restoreRes.status).toBe(200);
    const restoreResult = restoreRes.body.data as RestoreSnapshotResultDto;
    expect(restoreResult.restoredSnapshot.id).toBe(v1SnapId);
    expect(restoreResult.safetySnapshot?.restoredFromSnapshotId).toBe(
      v1SnapId
    );
    expect(restoreResult.applied.updatedFiles).toBeGreaterThanOrEqual(1);
    expect(restoreResult.applied.createdNodes).toBeGreaterThanOrEqual(1);
    expect(restoreResult.applied.deletedNodes).toBeGreaterThanOrEqual(1);

    const [yjsSyncPayload, restoredEvent] = await Promise.all([
      yjsUpdatePromise,
      restoredEventPromise,
    ]);

    Y.applyUpdate(collabMainDoc, new Uint8Array(yjsSyncPayload.update));
    expect(collabMainDoc.getText('monaco').toString()).toBe(
      'print("restore-target-v1")\n'
    );
    expect(restoredEvent.restoredSnapshotId).toBe(v1SnapId);
    expect(restoredEvent.deletedFileIds).toContain(transientId);

    // Live tree matches V1: keep_me.py recreated, transient.py deleted
    const finalTreeRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files`
    );
    const finalFiles = finalTreeRes.body.data.files as Array<{
      id: string;
      name: string;
    }>;
    expect(finalFiles.some((f) => f.name === 'keep_me.py')).toBe(true);
    expect(finalFiles.some((f) => f.name === 'transient.py')).toBe(false);

    // Editor cannot send edits to deleted transientId room (evicted!)
    const staleEditAck = await new Promise<YjsUpdateAck>((resolve) => {
      collabSocket.emit(
        'yjs:update',
        {
          projectId,
          branchId: featureBranchId,
          fileId: transientId,
          update: Y.encodeStateAsUpdate(new Y.Doc()),
        },
        (ack) => resolve(ack)
      );
    });
    expect(staleEditAck.ok).toBe(false);

    // Snapshot deletion permissions: non-creator editor2 blocked; creator `editor` can delete
    const ed2DeleteRes = await editor2.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${v1SnapId}`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(ed2DeleteRes.status).toBe(403);

    const creatorDeleteRes = await editor.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${v1SnapId}`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(creatorDeleteRes.status).toBe(200);

    const deletedLookup = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${v1SnapId}`
    );
    expect(deletedLookup.status).toBe(404);

    collabMainDoc.destroy();
    collabSocket.disconnect();
  });

  it('prevents deleted DENIED secret leakage/restore (VULN-01), keeps GET /diff read-only (VULN-05), returns totalCount (VULN-06), and enforces rate limits (VULN-04)', async () => {
    // 1. Owner creates a root secret file, denies editor2, captures snapshot, then deletes it from live
    const topSecretRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'top_secret.env',
        nodeType: 'file',
        content: 'DB_PASSWORD="hunter2-audit-secret"\n',
      });
    expect(topSecretRes.status).toBe(201);
    const topSecretId = topSecretRes.body.data.file.id as string;

    const denySecretRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${topSecretId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor2.id, permission: 'denied' });
    expect(denySecretRes.status).toBe(200);

    const secretSnapRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/snapshots`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'With deleted secret guard' });
    expect(secretSnapRes.status).toBe(201);
    const secretSnapId = secretSnapRes.body.data.snapshot.id as string;

    const delSecretRes = await owner.agent
      .delete(
        `/api/projects/${projectId}/branches/${featureBranchId}/files/${topSecretId}`
      )
      .set('Origin', TRUSTED_ORIGIN);
    expect(delSecretRes.status).toBe(200);

    // Deleted file must remain hidden in snapshot detail & diff for editor2
    const ed2DetailAfterDel = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}`
    );
    expect(ed2DetailAfterDel.status).toBe(200);
    const ed2DetailBody = ed2DetailAfterDel.body.data as BranchSnapshotDetailDto;
    expect(ed2DetailBody.redactedCount).toBeGreaterThanOrEqual(1);
    expect(
      ed2DetailBody.files.some(
        (f) => f.path === 'top_secret.env' || f.content.includes('hunter2')
      )
    ).toBe(false);

    const ed2DiffAfterDel = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/diff`
    );
    expect(ed2DiffAfterDel.status).toBe(200);
    const ed2DiffBody = ed2DiffAfterDel.body.data.diff as SnapshotDiffResponse;
    expect(ed2DiffBody.summary.redactedCount).toBeGreaterThanOrEqual(1);
    expect(
      ed2DiffBody.changes.some((c) => c.path === 'top_secret.env')
    ).toBe(false);

    // editor2 cannot recreate the deleted secret by restoring secretSnapId
    const ed2RestoreBypass = await editor2.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: false });
    expect(ed2RestoreBypass.status).toBe(403);
    expect(ed2RestoreBypass.body.error?.code).toBe('FILE_ACCESS_DENIED');

    // Owner restoring secretSnapId recreates top_secret.env AND re-hydrates DENIED ACL for editor2
    const ownerRestoreSecret = await owner.agent
      .post(
        `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/restore`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ createSafetySnapshot: false });
    expect(ownerRestoreSecret.status).toBe(200);

    const treeAfterOwnerRestore = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files`
    );
    const recreatedSecretNode = (
      treeAfterOwnerRestore.body.data.files as Array<{ id: string; name: string }>
    ).find((f) => f.name === 'top_secret.env');
    expect(recreatedSecretNode).toBeTruthy();

    const ed2ReadRecreated = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/files/${recreatedSecretNode!.id}`
    );
    expect(ed2ReadRecreated.status).toBe(403);

    // 2. VULN-05: Viewer GET .../diff reflects unsaved live Yjs edits WITHOUT bumping DB version
    const preDbMain = await prisma.projectFile.findUnique({
      where: { id: mainFileId },
      select: { name: true, version: true },
    });
    const editorSocket = await connectSocket(baseUrl, editor.cookieHeader);
    createdSockets.push(editorSocket);

    const joinMainAck = await new Promise<FileJoinAck>((resolve) => {
      editorSocket.emit(
        'file:join',
        { projectId, branchId: featureBranchId, fileId: mainFileId },
        (ack) => resolve(ack)
      );
    });
    expect(joinMainAck.ok).toBe(true);

    const tempDoc = new Y.Doc();
    Y.applyUpdate(tempDoc, new Uint8Array(joinMainAck.data!.yjsSyncUpdate));
    const unsavedDelta = await new Promise<Uint8Array>((resolve) => {
      tempDoc.once('update', (upd: Uint8Array) => resolve(upd));
      tempDoc.transact(() => {
        const yText = tempDoc.getText('monaco');
        yText.insert(yText.length, '# unsaved-live-ram-edit\n');
      });
    });
    const yjsPushAck = await new Promise<YjsUpdateAck>((resolve) => {
      editorSocket.emit(
        'yjs:update',
        {
          projectId,
          branchId: featureBranchId,
          fileId: mainFileId,
          update: unsavedDelta,
        },
        (ack) => resolve(ack)
      );
    });
    expect(yjsPushAck.ok).toBe(true);

    const viewerDiffRes = await viewer.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/diff`
    );
    expect(viewerDiffRes.status).toBe(200);
    const viewerDiff = viewerDiffRes.body.data.diff as SnapshotDiffResponse;
    const liveChangedMain = viewerDiff.changes.find((c) =>
      c.path.endsWith(preDbMain!.name)
    );
    expect(liveChangedMain?.targetContent).toContain('# unsaved-live-ram-edit');

    const postDbMain = await prisma.projectFile.findUnique({
      where: { id: mainFileId },
      select: { version: true },
    });
    expect(postDbMain?.version).toBe(preDbMain?.version);

    tempDoc.destroy();
    editorSocket.disconnect();

    // 3. VULN-06: Paginated list includes exact server `totalCount`
    const pagedRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${featureBranchId}/snapshots?limit=1`
    );
    expect(pagedRes.status).toBe(200);
    expect(pagedRes.body.data.snapshots).toHaveLength(1);
    expect(pagedRes.body.data.nextCursor).toBeTruthy();
    expect(pagedRes.body.data.totalCount).toBeGreaterThanOrEqual(2);

    // 4. VULN-02 / VULN-03: Parallel restores serialize cleanly & Yjs restore barrier blocks concurrent cold-load
    const [r1, r2] = await Promise.all([
      owner.agent
        .post(
          `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/restore`
        )
        .set('Origin', TRUSTED_ORIGIN)
        .send({ createSafetySnapshot: false }),
      owner.agent
        .post(
          `/api/projects/${projectId}/branches/${featureBranchId}/snapshots/${secretSnapId}/restore`
        )
        .set('Origin', TRUSTED_ORIGIN)
        .send({ createSafetySnapshot: false }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // 5. VULN-04: Snapshot mutation sliding-window rate limiter blocks burst calls with 429
    await redis.del(`codecollab:ratelimit:snapshot:write:${viewer.id}`);
    for (let i = 0; i < 15; i += 1) {
      const attempt = await viewer.agent
        .post(`/api/projects/${projectId}/branches/${featureBranchId}/snapshots`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ title: `Burst ${i}` });
      expect(attempt.status).toBe(403);
    }
    const throttledSnap = await viewer.agent
      .post(`/api/projects/${projectId}/branches/${featureBranchId}/snapshots`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ title: 'Burst throttled' });
    expect(throttledSnap.status).toBe(429);
    expect(throttledSnap.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
    await redis.del(`codecollab:ratelimit:snapshot:write:${viewer.id}`);
  });
});
