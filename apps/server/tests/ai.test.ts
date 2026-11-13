import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import {
  AI_LIMITS,
  AiActionKind,
  AiConversationDetailDto,
  AiConversationSummaryDto,
  AiMessageDto,
  AiStreamChunkDto,
} from '@codecollab/shared';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day6-ai.codecollab.test';
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

/**
 * Parses Server-Sent Events (SSE) text into an array of typed data objects.
 */
const parseSseEvents = (sseText: string): AiStreamChunkDto[] => {
  const chunks: AiStreamChunkDto[] = [];
  const lines = sseText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      const jsonStr = trimmed.slice(6).trim();
      if (jsonStr) {
        chunks.push(JSON.parse(jsonStr) as AiStreamChunkDto);
      }
    }
  }

  return chunks;
};

describe('Day 6 CodeCollab AI Assistant (SSE & Provider Harness)', () => {
  let httpServer: http.Server;
  let baseUrl: string;

  let owner: TestUserSession;
  let member: TestUserSession;
  let outsider: TestUserSession;

  let projectId: string;
  let branchId: string;
  let mainFileId: string;
  let secretFileId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    });

    httpServer = http.createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Register 3 users: Owner, Member, Outsider
    owner = await registerSession('owner', `ai_owner_${uidSuffix}`);
    member = await registerSession('member', `ai_member_${uidSuffix}`);
    outsider = await registerSession('outsider', `ai_outsider_${uidSuffix}`);

    // Create a TypeScript project
    const projRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'AI Test Workspace',
        description: 'Testing AI streaming and assistant capabilities',
        language: 'typescript',
        isPublic: false,
      });

    expect(projRes.status).toBe(201);
    projectId = projRes.body.data.project.id;
    branchId = projRes.body.data.branches[0].id;

    const filesRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(filesRes.status).toBe(200);
    const filesList = filesRes.body.data.files as Array<{ id: string; nodeType: string }>;
    mainFileId = filesList.find((f) => f.nodeType === 'file')!.id;

    // Add member to workspace with editor role
    const addMemberRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        identifier: member.email,
        role: 'editor',
      });
    expect(addMemberRes.status).toBe(201);

    // Create a secret file and explicitly set DENIED ACL for member
    const secretFileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'secret-keys.env',
        nodeType: 'file',
        content: 'DATABASE_SECRET=super_secret_production_password\nAPI_KEY=sk_live_99999',
      });
    expect(secretFileRes.status).toBe(201);
    secretFileId = secretFileRes.body.data.file.id;

    const setAclRes = await owner.agent
      .put(`/api/projects/${projectId}/branches/${branchId}/files/${secretFileId}/access`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        userId: member.id,
        permission: 'denied',
      });
    expect(setAclRes.status).toBe(200);
  });

  afterAll(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    try {
      const keys = await redis.keys('*vitest-day6-ai*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {
      // Redis cleanup best-effort
    }
  });

  it('1. GET /ai/conversations returns empty array initially', async () => {
    const res = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/ai/conversations`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body.conversations).toEqual([]);
  });

  it('2. POST /ai/stream streams general CHAT response with tokens and done frame', async () => {
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'chat',
        prompt: 'How should I structure an async pipeline in this workspace?',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const chunks = parseSseEvents(res.text);
    expect(chunks.length).toBeGreaterThan(3);

    // Verify Start Chunk
    const start = chunks[0];
    expect(start.type).toBe('start');
    if (start.type === 'start') {
      expect(start.conversationId).toBeDefined();
      expect(start.model).toBe('codecollab-offline-v1');
      expect(start.actionKind).toBe('chat');
    }

    // Verify Token Chunks
    const tokens = chunks.filter((c) => c.type === 'token');
    expect(tokens.length).toBeGreaterThan(0);

    // Verify Done Chunk
    const done = chunks[chunks.length - 1];
    expect(done.type).toBe('done');
    if (done.type === 'done') {
      expect(done.message.role).toBe('assistant');
      expect(done.message.content).toContain('User Query:');
      expect(done.message.promptTokens).toBeGreaterThan(0);
      expect(done.message.completionTokens).toBeGreaterThan(0);
    }
  });

  it('3. POST /ai/stream with EXPLAIN action generates complexity & architecture breakdown', async () => {
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'explain',
        prompt: 'Explain this module',
        context: {
          fileId: mainFileId,
          selection: {
            startLine: 1,
            endLine: 5,
          },
        },
      });

    expect(res.status).toBe(200);
    const chunks = parseSseEvents(res.text);

    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.message.content).toContain('Code Explanation');
      expect(done.message.content).toContain('Algorithmic Complexity');
      expect(done.message.codeContext?.fileName).toBeDefined();
    }
  });

  it('4. POST /ai/stream with DEBUG action and terminal error generates code patch & emits action frame', async () => {
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'debug',
        prompt: 'Fix the runtime exception',
        context: {
          fileId: mainFileId,
          terminalError: 'TypeError: Cannot read properties of undefined (reading "execute")',
        },
      });

    expect(res.status).toBe(200);
    const chunks = parseSseEvents(res.text);

    // Should emit an action frame with suggestedCode
    const actionChunk = chunks.find((c) => c.type === 'action');
    expect(actionChunk).toBeDefined();
    if (actionChunk && actionChunk.type === 'action') {
      expect(actionChunk.actionKind).toBe('debug');
      expect(actionChunk.suggestedCode).toBeDefined();
      expect(actionChunk.suggestedCode!.length).toBeGreaterThan(0);
    }

    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.message.suggestedCode).toBeDefined();
      expect(done.message.content).toContain('Diagnostic & Bug Fix');
      expect(done.message.content).toContain('TypeError');
    }
  });

  it('5. POST /ai/stream with GENERATE_TESTS generates unit test suite and suggestedCode', async () => {
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'generate_tests',
        prompt: 'Generate unit tests for this file',
        context: {
          fileId: mainFileId,
        },
      });

    expect(res.status).toBe(200);
    const chunks = parseSseEvents(res.text);

    const actionChunk = chunks.find((c) => c.type === 'action');
    expect(actionChunk).toBeDefined();
    if (actionChunk && actionChunk.type === 'action') {
      expect(actionChunk.suggestedCode).toContain('describe');
      expect(actionChunk.suggestedCode).toContain('expect');
    }
  });

  it('6. POST /ai/stream with REVIEW generates code quality and security review', async () => {
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'review',
        prompt: 'Review the architecture and performance',
        context: {
          fileId: mainFileId,
        },
      });

    expect(res.status).toBe(200);
    const chunks = parseSseEvents(res.text);

    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done && done.type === 'done') {
      expect(done.message.content).toContain('Senior Engineer Code Review');
      expect(done.message.content).toContain('Architectural Suggestions');
    }
  });

  it('7. ACL Protection: Member cannot access DENIED file via AI prompt (throws 403 FILE_ACCESS_DENIED)', async () => {
    const res = await member.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'explain',
        prompt: 'Explain this secret file',
        context: {
          fileId: secretFileId,
        },
      });

    // Assembled context throws AppError(403) before SSE headers are flushed
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FILE_ACCESS_DENIED');
  });

  it('8. IDOR & Isolation: Outsider cannot access project AI stream or conversations', async () => {
    const streamRes = await outsider.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'chat',
        prompt: 'Attempting cross-tenant access',
      });

    expect(streamRes.status).toBe(403);

    const convsRes = await outsider.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/ai/conversations`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(convsRes.status).toBe(403);
  });

  it('9. Conversation Multi-turn persistence & Conversation Detail retrieval', async () => {
    // 1. List conversations for owner
    const convsRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/ai/conversations`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(convsRes.status).toBe(200);
    expect(convsRes.body.conversations.length).toBeGreaterThan(0);

    const targetConv = convsRes.body.conversations[0] as AiConversationSummaryDto;
    expect(targetConv.messageCount).toBeGreaterThan(0);

    // 2. Fetch conversation detail
    const detailRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/ai/conversations/${targetConv.id}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(detailRes.status).toBe(200);
    const detail = detailRes.body as AiConversationDetailDto;
    expect(detail.conversation.id).toBe(targetConv.id);
    expect(detail.messages.length).toBeGreaterThanOrEqual(2);

    // 3. Post a multi-turn reply to the same conversation
    const replyRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        conversationId: targetConv.id,
        actionKind: 'chat',
        prompt: 'Follow up: what about test coverage?',
      });

    expect(replyRes.status).toBe(200);
    const replyChunks = parseSseEvents(replyRes.text);
    const replyStart = replyChunks.find((c) => c.type === 'start');
    if (replyStart && replyStart.type === 'start') {
      expect(replyStart.conversationId).toBe(targetConv.id);
    }
  });

  it('10. DELETE /ai/conversations/:conversationId removes conversation and messages', async () => {
    // Create an ephemeral conversation
    const streamRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/ai/stream`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        actionKind: 'chat',
        prompt: 'Temporary conversation to delete',
      });

    const chunks = parseSseEvents(streamRes.text);
    const start = chunks.find((c) => c.type === 'start') as { type: 'start'; conversationId: string };
    const tempConvId = start.conversationId;

    // Delete conversation
    const delRes = await owner.agent
      .delete(`/api/projects/${projectId}/branches/${branchId}/ai/conversations/${tempConvId}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(delRes.status).toBe(204);

    // Verify subsequent GET returns 404
    const getRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/ai/conversations/${tempConvId}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(getRes.status).toBe(404);
  });
});
