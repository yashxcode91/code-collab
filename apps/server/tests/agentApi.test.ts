import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { agentOrchestratorService } from '../src/modules/agent/agentOrchestrator.service';
import { AgentStagingService } from '../src/modules/agent/agentStaging.service';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day8-api.codecollab.test';
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
  usernamePrefix: string
): Promise<TestUserSession> => {
  const email = makeTestEmail(label);
  const uniqueUsername = `${usernamePrefix}_${Math.random().toString(36).slice(2, 8)}`;
  const agent = request.agent(app);

  const res = await agent
    .post('/api/auth/register')
    .set('Origin', TRUSTED_ORIGIN)
    .send({
      email,
      username: uniqueUsername,
      password: 'Password123!',
    });

  expect(res.status).toBe(201);
  const cookieHeader = extractAuthCookie(res.headers['set-cookie']);

  return {
    agent,
    cookieHeader,
    id: res.body.data.user.id,
    username: uniqueUsername,
    email,
  };
};

describe('Day 8 Step 4: Agent REST Routes, Controllers & Real-Time SSE Stream', () => {
  let owner: TestUserSession;
  let unauthorizedUser: TestUserSession;
  let projectId: string;
  let branchId: string;
  let rootFileId: string;
  let createdSessionId: string;

  beforeAll(async () => {
    owner = await registerSession('api_owner', 'api_own');
    unauthorizedUser = await registerSession('api_stranger', 'api_str');

    // Create Project
    const projRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Agent API Test Project ${uidSuffix}`,
        description: 'Testing agent REST routes and SSE streaming controllers',
      });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.data.project.id;
    branchId = projRes.body.data.branches[0].id;

    // Create a base file
    const fileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'service.ts',
        nodeType: 'file',
        content: `export const BASE_VALUE = 100;\n`,
      });
    expect(fileRes.status).toBe(201);
    rootFileId = fileRes.body.data.file.id;
  });

  afterAll(async () => {
    try {
      await prisma.agentSession.deleteMany({
        where: { projectId },
      });
      await prisma.project.deleteMany({
        where: { id: projectId },
      });
      await prisma.user.deleteMany({
        where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
      });
      redis.disconnect();
    } catch {
      // Ignore cleanup error
    }
  });

  it('1. POST /agent/sessions: validates input and creates a session in PLANNING state', async () => {
    // Rejects invalid payload (too short prompt)
    const badRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/agent/sessions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({ prompt: 'hi' });
    expect(badRes.status).toBe(400);

    // Creates valid session
    const res = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/agent/sessions`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        prompt: 'Edit service.ts to add export function getValue(): number',
        title: 'Add Get Value Helper',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('PLANNING');
    expect(res.body.data.steps.length).toBe(3);
    createdSessionId = res.body.data.id;
  });

  it('2. GET /agent/sessions/:sessionId: returns full session details and enforces RBAC', async () => {
    // Owner can fetch session
    const res = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(createdSessionId);
    expect(res.body.data.steps.length).toBe(3);

    // Unauthorized user receives 403 Forbidden
    const unauthRes = await unauthorizedUser.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(unauthRes.status).toBe(403);
  });

  it('3. POST /agent/sessions/:sessionId/stream: streams execution progress and frames over SSE', async () => {
    const sseRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}/stream`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(sseRes.status).toBe(200);
    expect(sseRes.headers['content-type']).toContain('text/event-stream');

    const sseBody = sseRes.text;
    expect(sseBody).toContain('session_status');
    expect(sseBody).toContain('step_started');
    expect(sseBody).toContain('tool_call_started');
    expect(sseBody).toContain('done');

    // Verify session reached AWAITING_REVIEW
    const checkRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(checkRes.body.data.status).toBe('AWAITING_REVIEW');
    expect(checkRes.body.data.stagedFiles.length).toBeGreaterThan(0);
  });

  it('4. POST /agent/sessions/:sessionId/apply: atomically commits staged files with OCC', async () => {
    const applyRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}/apply`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({});

    expect(applyRes.status).toBe(200);
    expect(applyRes.body.success).toBe(true);
    expect(applyRes.body.data.appliedCount).toBeGreaterThan(0);

    // Verify live DB file is updated
    const liveFile = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(liveFile?.content).toContain('AGENT_MODIFIED');

    // Verify session status is COMPLETED
    const checkRes = await owner.agent
      .get(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${createdSessionId}`)
      .set('Origin', TRUSTED_ORIGIN);
    expect(checkRes.body.data.status).toBe('COMPLETED');
  });

  it('5. DELETE /agent/sessions/:sessionId/staged: discards staged files cleanly', async () => {
    // Create new session and stage a file
    const newSession = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Temporary scratchpad session',
    });

    await AgentStagingService.stageFile({
      sessionId: newSession.id,
      branchId,
      filePath: 'temp.ts',
      content: '// Temporary content\n',
    });

    const delRes = await owner.agent
      .delete(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${newSession.id}/staged`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({});

    expect(delRes.status).toBe(200);
    expect(delRes.body.data.discardedCount).toBe(1);

    const staged = await AgentStagingService.getStagedFiles(newSession.id);
    expect(staged.length).toBe(0);
  });

  it('6. POST /agent/sessions/:sessionId/cancel: cancels session and records timestamp', async () => {
    const newSession = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Session to be cancelled',
    });

    const cancelRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/agent/sessions/${newSession.id}/cancel`)
      .set('Origin', TRUSTED_ORIGIN);

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe('CANCELLED');
    expect(cancelRes.body.data.cancelledAt).toBeDefined();
  });
});
