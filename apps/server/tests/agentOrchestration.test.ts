import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import {
  agentOrchestratorService,
  transitionAgentState,
} from '../src/modules/agent/agentOrchestrator.service';
import { AgentStagingService } from '../src/modules/agent/agentStaging.service';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day8-orch.codecollab.test';
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

describe('Day 8 Step 3: Agent Orchestrator, ReAct Loop & Self-Healing Verification', () => {
  let owner: TestUserSession;
  let projectId: string;
  let branchId: string;
  let rootFileId: string;

  beforeAll(async () => {
    owner = await registerSession('orch_owner', 'orch_own');

    // Create Project
    const projRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Orchestrator Test Project ${uidSuffix}`,
        description: 'Testing autonomous agent planning, execution and self-healing',
      });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.data.project.id;
    branchId = projRes.body.data.branches[0].id;

    // Create a base file
    const fileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'main.ts',
        nodeType: 'file',
        content: `export function calculate(x: number): number {\n  return x * 2;\n}\n`,
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

  it('1. State Machine: enforces valid transitions and blocks illegal state jumps', () => {
    // Valid transitions
    expect(transitionAgentState('PLANNING', 'EXECUTING')).toBe('EXECUTING');
    expect(transitionAgentState('EXECUTING', 'VERIFYING')).toBe('VERIFYING');
    expect(transitionAgentState('VERIFYING', 'AWAITING_REVIEW')).toBe('AWAITING_REVIEW');
    expect(transitionAgentState('AWAITING_REVIEW', 'COMPLETED')).toBe('COMPLETED');
    expect(transitionAgentState('VERIFYING', 'SELF_HEALING')).toBe('SELF_HEALING');
    expect(transitionAgentState('SELF_HEALING', 'VERIFYING')).toBe('VERIFYING');

    // Illegal jumps must throw 400 AppError
    expect(() => transitionAgentState('PLANNING', 'COMPLETED')).toThrow(
      /Cannot transition agent session/i
    );
    expect(() => transitionAgentState('COMPLETED', 'EXECUTING')).toThrow(
      /Cannot transition agent session/i
    );
    expect(() => transitionAgentState('CANCELLED', 'VERIFYING')).toThrow(
      /Cannot transition agent session/i
    );
  });

  it('2. Session Planning: decomposes prompt into ordered plan steps', async () => {
    const sessionDetail = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Refactor math functions in main.ts and verify types',
      title: 'Refactor Math Functions',
    });

    expect(sessionDetail.id).toBeDefined();
    expect(sessionDetail.status).toBe('PLANNING');
    expect(sessionDetail.steps.length).toBe(3);
    expect(sessionDetail.steps[0].stepNumber).toBe(1);
    expect(sessionDetail.steps[0].status).toBe('PENDING');
    expect(sessionDetail.steps[1].stepNumber).toBe(2);
    expect(sessionDetail.steps[2].stepNumber).toBe(3);
  });

  it('3. ReAct Execution: executes plan steps, stages files, and reaches AWAITING_REVIEW', async () => {
    const sessionDetail = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Edit main.ts to add export function add(a: number, b: number)',
    });

    const statusUpdates: string[] = [];
    const stepCompleted: number[] = [];

    const executed = await agentOrchestratorService.executeSession(
      sessionDetail.id,
      {
        onStatusChange: (status) => {
          statusUpdates.push(status);
        },
        onStepCompleted: (stepNum) => {
          stepCompleted.push(stepNum);
        },
      }
    );

    // Verify state progression
    expect(statusUpdates).toContain('EXECUTING');
    expect(statusUpdates).toContain('VERIFYING');
    expect(statusUpdates).toContain('AWAITING_REVIEW');
    expect(executed.status).toBe('AWAITING_REVIEW');
    expect(stepCompleted).toContain(1);
    expect(stepCompleted).toContain(2);

    // Verify files were staged in quarantine
    expect(executed.stagedFiles.length).toBeGreaterThan(0);
    const stagedMain = executed.stagedFiles.find((f) => f.filePath === 'main.ts');
    expect(stagedMain).toBeDefined();
    expect(stagedMain?.isApplied).toBe(false);

    // Verify live DB file is untouched until approval
    const liveFile = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(liveFile?.content).not.toContain('AGENT_MODIFIED');
  });

  it('4. Closed-Loop Self-Healing: repairs broken code and successfully recovers to AWAITING_REVIEW', async () => {
    // 1. Create a session
    const sessionDetail = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Create src/utils/calculator.ts with broken syntax',
    });

    // 2. Intentionally stage broken syntax in the session
    await AgentStagingService.stageFile({
      sessionId: sessionDetail.id,
      branchId,
      filePath: 'src/utils/calculator.ts',
      content: `export function brokenFunc( { \n  return 42;\n`, // Syntax error: incomplete parameter block
    });

    const healingAttempts: number[] = [];

    // 3. Execute session with self-healing listener
    const executed = await agentOrchestratorService.executeSession(
      sessionDetail.id,
      {
        onSelfHealingAttempt: (attempt) => {
          healingAttempts.push(attempt);
        },
      }
    );

    // 4. Verify self-healing triggered and recovered
    expect(healingAttempts.length).toBeGreaterThanOrEqual(1);
    expect(executed.status).toBe('AWAITING_REVIEW');
    expect(executed.selfHealingAttempts).toBeGreaterThanOrEqual(1);

    // 5. Verify the staged file was repaired into valid TypeScript
    const stagedCalc = await AgentStagingService.getStagedFile(
      sessionDetail.id,
      'src/utils/calculator.ts'
    );
    expect(stagedCalc).toBeDefined();
    expect(stagedCalc?.stagedContent).toContain('export function brokenFunc(): number');
  });

  it('5. Cancellation Handling: aborts session and prevents further executions', async () => {
    const sessionDetail = await agentOrchestratorService.createSession({
      projectId,
      branchId,
      userId: owner.id,
      prompt: 'Long running refactoring task',
    });

    // Cancel session
    const cancelled = await agentOrchestratorService.cancelSession(
      sessionDetail.id,
      owner.id
    );

    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.cancelledAt).toBeDefined();

    // Re-running execution on a CANCELLED session returns immediately without re-executing
    const reRan = await agentOrchestratorService.executeSession(sessionDetail.id);
    expect(reRan.status).toBe('CANCELLED');
  });
});
