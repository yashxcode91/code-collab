import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { prisma } from '@codecollab/database';
import {
  buildExecutionStdinChannel,
  type ChatMessageDto,
  type ClientToServerEvents,
  EXECUTION_EVENTS_CHANNEL,
  EXECUTION_LIMITS,
  type ExecutionJoinAck,
  type ExecutionLifecyclePayload,
  type ExecutionStreamChunkPayload,
  type FileJoinAck,
  type RealtimeAck,
  type RealtimeErrorPayload,
  type ServerToClientEvents,
} from '@codecollab/shared';
import { app } from '../src/app';
import {
  canonicalJsonStringify,
  createRedisSubscriber,
  redis,
  signPubSubString,
} from '../src/lib/redis';
import {
  buildExecutionCancelFlagKey,
  closeExecutionQueue,
  removeExecutionJob,
} from '../src/modules/execution/execution.queue';
import {
  createRealtimeServer,
  type TypedRealtimeIoServer,
} from '../src/realtime/socketServer';
import { yjsRoomManager } from '../src/realtime/yjsRoomManager';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day4.codecollab.test';
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

describe('Day 4 Execution & Workspace Chat API + Socket.IO Gateway', () => {
  let httpServer: http.Server;
  let io: TypedRealtimeIoServer;
  let baseUrl: string;

  let owner: TestUserSession;
  let editor: TestUserSession;
  let editor2: TestUserSession;
  let viewer: TestUserSession;
  let outsider: TestUserSession;

  let projectId: string;
  let branchId: string;
  let publicFileId: string;
  let secretFileId: string;

  const createdSockets: TestClientSocket[] = [];
  const createdRunIds: string[] = [];

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

    owner = await registerSession('owner', `d4_own_${uidSuffix}`);
    editor = await registerSession('editor', `d4_ed1_${uidSuffix}`);
    editor2 = await registerSession('editor2', `d4_ed2_${uidSuffix}`);
    viewer = await registerSession('viewer', `d4_vw_${uidSuffix}`);
    outsider = await registerSession('outsider', `d4_out_${uidSuffix}`);

    // Clear test rate limits
    for (const u of [owner, editor, editor2, viewer, outsider]) {
      await redis.del(`codecollab:ratelimit:exec:${u.id}`);
      await redis.del(`codecollab:ratelimit:stdin:${u.id}`);
    }

    const createProj = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: `Day4 Suite ${uidSuffix}`, language: 'python', isPublic: true });
    expect(createProj.status).toBe(201);
    projectId = createProj.body.data.project.id;
    branchId = createProj.body.data.branches[0].id;

    const treeRes = await owner.agent.get(
      `/api/projects/${projectId}/branches/${branchId}/files`
    );
    expect(treeRes.status).toBe(200);
    const files = treeRes.body.data.files as Array<{
      id: string;
      nodeType: string;
      name: string;
    }>;
    publicFileId = files.find((f) => f.nodeType === 'file')!.id;

    const secretFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'secret.py', nodeType: 'file', content: 'print("TOP_SECRET")' });
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

    // Deny editor2 access to secretFileId
    const aclRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${branchId}/files/${secretFileId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor2.id, permission: 'denied' });
    expect(aclRes.status).toBe(200);
  });

  afterAll(async () => {
    for (const s of createdSockets) {
      if (s.connected) s.disconnect();
    }
    await yjsRoomManager.closeAll();
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    for (const rid of createdRunIds) {
      await removeExecutionJob(rid);
      await redis.del(`codecollab:ratelimit:stdin-bytes:${rid}`);
    }
    await closeExecutionQueue();
    for (const u of [owner, editor, editor2, viewer, outsider]) {
      await redis.del(`codecollab:ratelimit:exec:${u.id}`);
      await redis.del(`codecollab:ratelimit:stdin:${u.id}`);
      await redis.del(`codecollab:ratelimit:chat:${projectId}:${u.id}`);
    }

    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });
    await prisma.$disconnect();
    if (redis.status === 'ready') {
      await redis.quit();
    }
  });

  it('enforces owner/editor-only code execution and blocks viewers/outsiders/denied files', async () => {
    // Viewer blocked
    const viewerRun = await viewer.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ language: 'python', sourceCode: 'print(1)' });
    expect(viewerRun.status).toBe(403);

    // Outsider blocked even on public project
    const outsiderRun = await outsider.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ language: 'python', sourceCode: 'print(1)' });
    expect(outsiderRun.status).toBe(403);

    // Editor2 denied secret.py cannot run it
    const deniedFileRun = await editor2.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ language: 'python', fileId: secretFileId });
    expect(deniedFileRun.status).toBe(403);

    // Owner triggers run on secretFileId
    const ownerRun = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ language: 'python', fileId: secretFileId, sourceCode: 'print("ok")' });
    expect(ownerRun.status).toBe(201);
    const secretRunId = ownerRun.body.data.run.id as string;
    createdRunIds.push(secretRunId);

    // Editor2 cannot see secretFileId's run in branch history or detail
    const ed2List = await editor2.agent.get(
      `/api/projects/${projectId}/branches/${branchId}/runs`
    );
    expect(ed2List.status).toBe(200);
    expect(
      (ed2List.body.data.runs as Array<{ id: string }>).some(
        (r) => r.id === secretRunId
      )
    ).toBe(false);

    const ed2Detail = await editor2.agent.get(
      `/api/projects/${projectId}/runs/${secretRunId}`
    );
    expect(ed2Detail.status).toBe(403);

    // Outsider cannot read execution history on public project
    const outList = await outsider.agent.get(
      `/api/projects/${projectId}/branches/${branchId}/runs`
    );
    expect(outList.status).toBe(403);

    // Cleanly cancel queued run
    const cancelRes = await owner.agent
      .post(`/api/projects/${projectId}/runs/${secretRunId}/cancel`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.run.status).toBe('CANCELLED');
  });

  it('validates Socket.IO execution:join, execution:stdin ownership/status/bytes, and Pub/Sub streaming', async () => {
    const runRes = await editor.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        language: 'python',
        fileId: publicFileId,
        sourceCode: 'print(input())',
      });
    expect(runRes.status).toBe(201);
    const runId = runRes.body.data.run.id as string;
    createdRunIds.push(runId);

    const editorSocket = await connectSocket(baseUrl, editor.cookieHeader);
    const editor2Socket = await connectSocket(baseUrl, editor2.cookieHeader);
    const viewerSocket = await connectSocket(baseUrl, viewer.cookieHeader);
    const outsiderSocket = await connectSocket(baseUrl, outsider.cookieHeader);
    createdSockets.push(
      editorSocket,
      editor2Socket,
      viewerSocket,
      outsiderSocket
    );

    // Runtime Zod rejects malformed join
    const badJoinAck = await new Promise<ExecutionJoinAck>((resolve) => {
      editorSocket.emit(
        'execution:join',
        { projectId: 'not-a-uuid', runId } as unknown as {
          projectId: string;
          runId: string;
        },
        (ack) => resolve(ack)
      );
    });
    expect(badJoinAck.ok).toBe(false);
    expect(badJoinAck.error?.code).toBe('INVALID_PAYLOAD');

    // Outsider denied joining execution room
    const outsiderJoinAck = await new Promise<ExecutionJoinAck>((resolve) => {
      outsiderSocket.emit('execution:join', { projectId, runId }, (ack) =>
        resolve(ack)
      );
    });
    expect(outsiderJoinAck.ok).toBe(false);
    expect(outsiderJoinAck.error?.code).toBe('EXECUTION_FORBIDDEN');

    // Editor & Viewer join authorized execution room
    const edJoinAck = await new Promise<ExecutionJoinAck>((resolve) => {
      editorSocket.emit('execution:join', { projectId, runId }, (ack) =>
        resolve(ack)
      );
    });
    expect(edJoinAck.ok).toBe(true);
    expect(edJoinAck.data?.run.id).toBe(runId);
    expect((edJoinAck.data?.run as Record<string, unknown> | undefined)?.sourceCode).toBeUndefined();

    const vwJoinAck = await new Promise<ExecutionJoinAck>((resolve) => {
      viewerSocket.emit('execution:join', { projectId, runId }, (ack) =>
        resolve(ack)
      );
    });
    expect(vwJoinAck.ok).toBe(true);

    // execution:stdin rejects QUEUED state
    const queuedStdinAck = await new Promise<RealtimeAck>((resolve) => {
      editorSocket.emit('execution:stdin', { runId, data: 'hello\n' }, (ack) =>
        resolve(ack)
      );
    });
    expect(queuedStdinAck.ok).toBe(false);
    expect(queuedStdinAck.error?.code).toBe('EXECUTION_NOT_RUNNING');

    // Transition run to RUNNING directly to test live stdin & Worker Pub/Sub bridge
    await prisma.executionRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    // Viewer & another editor (editor2) cannot hijack creator's stdin
    const vwStdinAck = await new Promise<RealtimeAck>((resolve) => {
      viewerSocket.emit('execution:stdin', { runId, data: 'hack\n' }, (ack) =>
        resolve(ack)
      );
    });
    expect(vwStdinAck.ok).toBe(false);
    expect(vwStdinAck.error?.code).toBe('EXECUTION_FORBIDDEN');

    const ed2StdinAck = await new Promise<RealtimeAck>((resolve) => {
      editor2Socket.emit('execution:stdin', { runId, data: 'hijack\n' }, (ack) =>
        resolve(ack)
      );
    });
    expect(ed2StdinAck.ok).toBe(false);
    expect(ed2StdinAck.error?.code).toBe('EXECUTION_FORBIDDEN');

    // UTF-8 byte cap blocks >4KB multi-byte emoji string
    const multiByteBomb = '😀'.repeat(1500); // 1500 chars, 6000 UTF-8 bytes > 4096
    const bombAck = await new Promise<RealtimeAck>((resolve) => {
      editorSocket.emit('execution:stdin', { runId, data: multiByteBomb }, (ack) =>
        resolve(ack)
      );
    });
    expect(bombAck.ok).toBe(false);
    expect(bombAck.error?.code).toBe('PAYLOAD_TOO_LARGE');

    // Creator sends valid stdin -> reaches Redis stdin channel
    const stdinSub = createRedisSubscriber();
    await stdinSub.subscribe(buildExecutionStdinChannel(runId));
    const stdinReceived = new Promise<string>((resolve) => {
      stdinSub.once('message', (_ch, msg) => resolve(msg));
    });

    const okStdinAck = await new Promise<RealtimeAck>((resolve) => {
      editorSocket.emit('execution:stdin', { runId, data: 'hello\n' }, (ack) =>
        resolve(ack)
      );
    });
    expect(okStdinAck.ok).toBe(true);
    expect(JSON.parse(await stdinReceived)).toEqual({ data: 'hello\n' });
    await stdinSub.quit();

    // Malformed Redis Pub/Sub frame is ignored safely; valid chunk broadcasts ONLY to room members
    let outsiderSawStdout = false;
    outsiderSocket.on('execution:stdout', () => {
      outsiderSawStdout = true;
    });

    const chunkPromise = new Promise<ExecutionStreamChunkPayload>((resolve) => {
      editorSocket.once('execution:stdout', (p) => resolve(p));
    });
    const completedPromise = new Promise<ExecutionLifecyclePayload>((resolve) => {
      editorSocket.once('execution:completed', (p) => resolve(p));
    });

    await redis.publish(EXECUTION_EVENTS_CHANNEL, '{"bad":"frame"}');
    await redis.publish(
      EXECUTION_EVENTS_CHANNEL,
      JSON.stringify({
        type: 'stdout',
        runId,
        projectId,
        branchId,
        fileId: publicFileId,
        seq: 1,
        chunk: 'hello\n',
        truncated: false,
        timestamp: Date.now(),
      })
    );
    await redis.publish(
      EXECUTION_EVENTS_CHANNEL,
      JSON.stringify({
        type: 'completed',
        runId,
        projectId,
        branchId,
        fileId: publicFileId,
        status: 'COMPLETED',
        exitCode: 0,
        failureKind: null,
        errorMessage: null,
        durationMs: 42,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        stdoutTruncated: false,
        stderrTruncated: false,
        timestamp: Date.now(),
      })
    );

    const chunk = await chunkPromise;
    expect(chunk.seq).toBe(1);
    expect(chunk.chunk).toBe('hello\n');
    const done = await completedPromise;
    expect(done.status).toBe('COMPLETED');
    expect(outsiderSawStdout).toBe(false);

    expect(EXECUTION_LIMITS.MAX_OUTPUT_BYTES).toBe(65_536);
  });

  it('enforces chat RBAC, control-char rejection, fileRef redaction, and live member eviction', async () => {
    const ownerSock = await connectSocket(baseUrl, owner.cookieHeader);
    const ed2Sock = await connectSocket(baseUrl, editor2.cookieHeader);
    const viewerSock = await connectSocket(baseUrl, viewer.cookieHeader);
    const outSock = await connectSocket(baseUrl, outsider.cookieHeader);
    createdSockets.push(ownerSock, ed2Sock, viewerSock, outSock);

    // Outsider cannot join workspace chat
    const outJoin = await new Promise<RealtimeAck>((resolve) => {
      outSock.emit('chat:join', { projectId }, (ack) => resolve(ack));
    });
    expect(outJoin.ok).toBe(false);
    expect(outJoin.error?.code).toBe('CHAT_FORBIDDEN');

    // Authorized members join
    for (const s of [ownerSock, ed2Sock, viewerSock]) {
      const ack = await new Promise<RealtimeAck>((resolve) => {
        s.emit('chat:join', { projectId }, (res) => resolve(res));
      });
      expect(ack.ok).toBe(true);
    }

    // Viewer cannot send messages
    const vwSend = await new Promise<RealtimeAck<ChatMessageDto>>((resolve) => {
      viewerSock.emit('chat:send', { projectId, content: 'hi' }, (ack) =>
        resolve(ack)
      );
    });
    expect(vwSend.ok).toBe(false);
    expect(vwSend.error?.code).toBe('CHAT_FORBIDDEN');

    // Control characters / ANSI escape codes rejected by Zod
    const badAnsi = await new Promise<RealtimeAck<ChatMessageDto>>((resolve) => {
      ownerSock.emit(
        'chat:send',
        { projectId, content: 'bad \x1b[31mred' },
        (ack) => resolve(ack)
      );
    });
    expect(badAnsi.ok).toBe(false);
    expect(badAnsi.error?.code).toBe('INVALID_PAYLOAD');

    // Owner links secretFileId in chat: viewer gets fileRef, editor2 (DENIED) sees redacted fileRef: null!
    const ed2MsgPromise = new Promise<ChatMessageDto>((resolve) => {
      ed2Sock.once('chat:message', (m) => resolve(m));
    });
    const vwMsgPromise = new Promise<ChatMessageDto>((resolve) => {
      viewerSock.once('chat:message', (m) => resolve(m));
    });

    const sendAck = await new Promise<RealtimeAck<ChatMessageDto>>((resolve) => {
      ownerSock.emit(
        'chat:send',
        {
          projectId,
          branchId,
          fileId: secretFileId,
          lineNumber: 1,
          content: 'Check this secret file',
        },
        (ack) => resolve(ack)
      );
    });
    expect(sendAck.ok).toBe(true);
    expect(sendAck.data?.fileRef?.fileName).toBe('secret.py');

    const ed2Msg = await ed2MsgPromise;
    const vwMsg = await vwMsgPromise;
    expect(ed2Msg.content).toBe('Check this secret file');
    expect(ed2Msg.fileRef).toBeNull();
    expect(vwMsg.fileRef?.fileName).toBe('secret.py');

    // Send a second message so chronological oldest -> newest pagination ordering is asserted
    const secondSendAck = await new Promise<RealtimeAck<ChatMessageDto>>((resolve) => {
      ownerSock.emit(
        'chat:send',
        { projectId, content: 'Follow-up chronological message' },
        (ack) => resolve(ack)
      );
    });
    expect(secondSendAck.ok).toBe(true);

    // REST cursor pagination returns oldest -> newest and redacts secret fileRef for editor2
    const histRes = await editor2.agent.get(`/api/projects/${projectId}/chat`);
    expect(histRes.status).toBe(200);
    expect(histRes.body.data.messages).toHaveLength(2);
    expect(histRes.body.data.messages[0].content).toBe('Check this secret file');
    expect(histRes.body.data.messages[0].fileRef).toBeNull();
    expect(histRes.body.data.messages[1].content).toBe('Follow-up chronological message');

    // Removing editor2 triggers live eviction error on their active socket
    const evictedPromise = new Promise<RealtimeErrorPayload>((resolve) => {
      ed2Sock.once('realtime:error', (err) => resolve(err));
    });
    const rmRes = await owner.agent
      .delete(`/api/projects/${projectId}/members/${editor2.id}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(rmRes.status).toBe(200);

    const evErr = await evictedPromise;
    expect(evErr.code).toBe('PROJECT_FORBIDDEN');
  });

  it('enforces per-user execution sliding-window rate limit (10 runs / 60s)', async () => {
    await redis.del(`codecollab:ratelimit:exec:${editor2.id}`);
    // Re-add editor2 to run rate limit check cleanly
    await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ identifier: editor2.email, role: 'editor' });

    for (let i = 0; i < EXECUTION_LIMITS.RATE_LIMIT_MAX_RUNS; i += 1) {
      const ok = await editor2.agent
        .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
        .set('Origin', TRUSTED_ORIGIN)
        .send({ language: 'javascript', sourceCode: `console.log(${i})` });
      expect(ok.status).toBe(201);
      createdRunIds.push(ok.body.data.run.id);
    }

    const limited = await editor2.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ language: 'javascript', sourceCode: 'console.log("overflow")' });
    expect(limited.status).toBe(429);
    expect(limited.body.error?.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('live-evicts revoked collaborators from Yjs rooms and stops future CRDT updates (VULN-01)', async () => {
    const ownerSock = await connectSocket(baseUrl, owner.cookieHeader);
    const revokeeSock = await connectSocket(baseUrl, editor2.cookieHeader);
    createdSockets.push(ownerSock, revokeeSock);

    const ownerJoin = await new Promise<FileJoinAck>((resolve) => {
      ownerSock.emit(
        'file:join',
        { projectId, branchId, fileId: publicFileId },
        (ack) => resolve(ack)
      );
    });
    expect(ownerJoin.ok).toBe(true);

    const revokeeJoin = await new Promise<FileJoinAck>((resolve) => {
      revokeeSock.emit(
        'file:join',
        { projectId, branchId, fileId: publicFileId },
        (ack) => resolve(ack)
      );
    });
    expect(revokeeJoin.ok).toBe(true);

    const evictedErr = new Promise<RealtimeErrorPayload>((resolve) => {
      revokeeSock.once('realtime:error', (err) => resolve(err));
    });

    const rmRes = await owner.agent
      .delete(`/api/projects/${projectId}/members/${editor2.id}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(rmRes.status).toBe(200);

    const errPayload = await evictedErr;
    expect(errPayload.code).toBe('PROJECT_FORBIDDEN');

    let leakedUpdate = false;
    revokeeSock.on('yjs:update', () => {
      leakedUpdate = true;
    });

    const ownerDoc = new Y.Doc();
    if (ownerJoin.data?.yjsSyncUpdate) {
      Y.applyUpdate(ownerDoc, new Uint8Array(ownerJoin.data.yjsSyncUpdate));
    }
    let deltaToSend: Uint8Array | null = null;
    ownerDoc.on('update', (u: Uint8Array) => {
      deltaToSend = u;
    });
    ownerDoc.getText('monaco').insert(0, '# secret edit after revocation\n');

    const ownerEditAck = await new Promise<RealtimeAck>((resolve) => {
      ownerSock.emit(
        'yjs:update',
        {
          projectId,
          branchId,
          fileId: publicFileId,
          update: deltaToSend!,
        },
        (ack) => resolve(ack)
      );
    });
    expect(ownerEditAck.ok).toBe(true);

    // Wait briefly to confirm evicted collaborator never receives the owner's Yjs delta
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(leakedUpdate).toBe(false);

    // Evicted collaborator also cannot push updates into the room
    const revokeeEditAck = await new Promise<RealtimeAck>((resolve) => {
      revokeeSock.emit(
        'yjs:update',
        {
          projectId,
          branchId,
          fileId: publicFileId,
          update: deltaToSend!,
        },
        (ack) => resolve(ack)
      );
    });
    expect(revokeeEditAck.ok).toBe(false);
    expect(revokeeEditAck.error?.code).toBe('NOT_IN_ROOM');
    ownerDoc.destroy();
  });

  it('blocks spoofed sourceCode execution on read-only files & protected branches while permitting unmodified runs (VULN-05)', async () => {
    await redis.del(`codecollab:ratelimit:exec:${editor.id}`);

    const readOnlyFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'readonly.py',
        nodeType: 'file',
        content: 'print("TRUSTED_SOURCE")',
      });
    expect(readOnlyFileRes.status).toBe(201);
    const readOnlyFileId = readOnlyFileRes.body.data.file.id as string;

    const aclRes = await owner.agent
      .put(`/api/projects/${projectId}/branches/${branchId}/files/${readOnlyFileId}/access`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: editor.id, permission: 'read_only' });
    expect(aclRes.status).toBe(200);

    const spoofRes = await editor.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        language: 'python',
        fileId: readOnlyFileId,
        sourceCode: 'print("TAMPERED_PAYLOAD")',
      });
    expect(spoofRes.status).toBe(403);
    expect(spoofRes.body.error?.code).toBe('FILE_READ_ONLY');

    const unmodifiedRes = await editor.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/runs`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        language: 'python',
        fileId: readOnlyFileId,
        sourceCode: 'print("TRUSTED_SOURCE")',
      });
    expect(unmodifiedRes.status).toBe(201);
    createdRunIds.push(unmodifiedRes.body.data.run.id);
  });

  it('sets Redis cancel flag on QUEUED cancellation and blocks folder fileRef + BiDi controls in chat (VULN-04, VULN-10, WEAK-02)', async () => {
    const queuedRun = await prisma.executionRun.create({
      data: {
        projectId,
        branchId,
        fileId: publicFileId,
        userId: owner.id,
        language: 'PYTHON',
        status: 'QUEUED',
        entryFileName: 'main.py',
        sourceCode: 'print(1)',
      },
    });
    const runId = queuedRun.id;
    createdRunIds.push(runId);

    const cancelRes = await owner.agent
      .post(`/api/projects/${projectId}/runs/${runId}/cancel`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.run.status).toBe('CANCELLED');
    const flagVal = await redis.get(buildExecutionCancelFlagKey(runId));
    expect(flagVal).toBe('1');
    await redis.del(buildExecutionCancelFlagKey(runId));

    // Reject folder fileId in workspace chat
    const folderRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ name: 'src_folder', nodeType: 'folder' });
    expect(folderRes.status).toBe(201);
    const folderId = folderRes.body.data.file.id as string;

    const folderChatRes = await owner.agent
      .post(`/api/projects/${projectId}/chat`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'See folder', branchId, fileId: folderId });
    expect(folderChatRes.status).toBe(400);
    expect(folderChatRes.body.error?.code).toBe('INVALID_NODE_TYPE');

    // Reject Unicode BiDi override characters in chat
    const bidiRes = await owner.agent
      .post(`/api/projects/${projectId}/chat`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ content: 'harmless \u202Etxt.exe' });
    expect(bidiRes.status).toBe(400);
    expect(bidiRes.body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('drops forged worker Pub/Sub events with mismatched scope or invalid HMAC signatures (VULN-08)', async () => {
    const isolatedRun = await prisma.executionRun.create({
      data: {
        projectId,
        branchId,
        fileId: publicFileId,
        userId: owner.id,
        language: 'PYTHON',
        status: 'RUNNING',
        entryFileName: 'main.py',
        sourceCode: 'print("ok")',
        startedAt: new Date(),
      },
    });
    const runId = isolatedRun.id;
    createdRunIds.push(runId);

    const ownerSock = await connectSocket(baseUrl, owner.cookieHeader);
    createdSockets.push(ownerSock);
    const joinAck = await new Promise<ExecutionJoinAck>((resolve) => {
      ownerSock.emit('execution:join', { projectId, runId }, (ack) => resolve(ack));
    });
    expect(joinAck.ok).toBe(true);

    const receivedChunks: string[] = [];
    ownerSock.on('execution:stdout', (p) => receivedChunks.push(p.chunk));

    // 1. Forged projectId mismatch -> dropped by DB run correlation
    await redis.publish(
      EXECUTION_EVENTS_CHANNEL,
      JSON.stringify({
        type: 'stdout',
        runId,
        projectId: '00000000-0000-4000-8000-000000000999',
        branchId,
        fileId: publicFileId,
        seq: 1,
        chunk: 'FORGED_SCOPE',
        truncated: false,
        timestamp: Date.now(),
      })
    );

    // 2. Test HMAC enforcement when EXECUTION_PUBSUB_SECRET is enabled
    const prevSecret = process.env.EXECUTION_PUBSUB_SECRET;
    process.env.EXECUTION_PUBSUB_SECRET =
      'super-strong-test-hmac-secret-at-least-32-chars';
    try {
      const validEvent = {
        type: 'stdout' as const,
        runId,
        projectId,
        branchId,
        fileId: publicFileId,
        seq: 2,
        chunk: 'SIGNED_OK',
        truncated: false,
        timestamp: Date.now(),
      };

      // Unsigned event rejected when secret configured
      await redis.publish(EXECUTION_EVENTS_CHANNEL, JSON.stringify(validEvent));

      // Tampered signature rejected
      await redis.publish(
        EXECUTION_EVENTS_CHANNEL,
        JSON.stringify({
          event: { ...validEvent, chunk: 'TAMPERED_SIG' },
          sig: 'a'.repeat(64),
        })
      );

      // Valid HMAC signature accepted
      const validSig = signPubSubString(
        canonicalJsonStringify(validEvent),
        process.env.EXECUTION_PUBSUB_SECRET
      );
      await redis.publish(
        EXECUTION_EVENTS_CHANNEL,
        JSON.stringify({ event: validEvent, sig: validSig })
      );

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(receivedChunks).toEqual(['SIGNED_OK']);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.EXECUTION_PUBSUB_SECRET;
      } else {
        process.env.EXECUTION_PUBSUB_SECRET = prevSecret;
      }
    }
  });
});
