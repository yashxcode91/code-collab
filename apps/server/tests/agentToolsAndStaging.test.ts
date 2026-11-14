import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import { redis } from '../src/lib/redis';
import { AgentStagingService } from '../src/modules/agent/agentStaging.service';
import { AgentVerificationService } from '../src/modules/agent/agentVerification.service';
import { defaultToolRegistry } from '../src/modules/agent/tools/toolRegistry';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-day8-agent.codecollab.test';
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

describe('Day 8 Step 1 & 2: Agent Tool Engine, Staging Buffer & In-Memory Verification', () => {
  let owner: TestUserSession;
  let collaborator: TestUserSession;
  let projectId: string;
  let branchId: string;
  let rootFileId: string;
  let deniedFileId: string;
  let sessionId: string;

  beforeAll(async () => {
    owner = await registerSession('agent_owner', 'agent_own');
    collaborator = await registerSession('agent_collab', 'agent_col');

    // Create Project
    const projRes = await owner.agent
      .post('/api/projects')
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: `Agent Test Project ${uidSuffix}`,
        description: 'Testing autonomous agent tool registry and multi-file staging',
      });
    expect(projRes.status).toBe(201);
    projectId = projRes.body.data.project.id;
    branchId = projRes.body.data.branches[0].id;

    // Add collaborator as editor
    const memberRes = await owner.agent
      .post(`/api/projects/${projectId}/members`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        identifier: collaborator.email,
        role: 'editor',
      });
    expect(memberRes.status).toBe(201);

    // Create a base file
    const fileRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'main.ts',
        nodeType: 'file',
        content: `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
      });
    expect(fileRes.status).toBe(201);
    rootFileId = fileRes.body.data.file.id;

    // Create a sensitive file and deny collaborator access
    const secretRes = await owner.agent
      .post(`/api/projects/${projectId}/branches/${branchId}/files`)
      .set('Origin', TRUSTED_ORIGIN)
      .send({
        name: 'secret-keys.ts',
        nodeType: 'file',
        content: `export const API_SECRET = 'SUPER_SECRET_KEY';\n`,
      });
    expect(secretRes.status).toBe(201);
    deniedFileId = secretRes.body.data.file.id;

    const aclRes = await owner.agent
      .put(
        `/api/projects/${projectId}/branches/${branchId}/files/${deniedFileId}/access`
      )
      .set('Origin', TRUSTED_ORIGIN)
      .send({ userId: collaborator.id, permission: 'denied' });
    expect(aclRes.status).toBe(200);

    // Create an AgentSession in DB for testing
    const session = await prisma.agentSession.create({
      data: {
        projectId,
        branchId,
        userId: owner.id,
        title: 'Multi-File Refactor Test',
        prompt: 'Refactor math functions and verify compilation',
        status: 'PLANNING',
      },
    });
    sessionId = session.id;
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

  it('1. Database Model Integrity: creates agent session, plan steps, and tool calls', async () => {
    const step = await prisma.agentPlanStep.create({
      data: {
        sessionId,
        stepNumber: 1,
        title: 'Inspect math module',
        description: 'Read main.ts to discover existing signatures',
        status: 'PENDING',
      },
    });
    expect(step.id).toBeDefined();
    expect(step.stepNumber).toBe(1);

    const toolCall = await prisma.agentToolCall.create({
      data: {
        sessionId,
        stepId: step.id,
        toolName: 'read_file',
        inputPayload: { path: 'main.ts' },
        status: 'RUNNING',
      },
    });
    expect(toolCall.id).toBeDefined();
    expect(toolCall.status).toBe('RUNNING');
  });

  it('2. ReadFileTool: reads file content and enforces line range constraints', async () => {
    const tool = defaultToolRegistry.getTool('read_file');
    expect(tool).toBeDefined();

    const result = await tool!.execute(
      { sessionId, projectId, branchId, userId: owner.id },
      { path: 'main.ts', lineStart: 1, lineEnd: 2 }
    );

    expect(result.path).toBe('main.ts');
    expect(result.content).toContain('export function add');
    expect(result.totalLines).toBe(4);
    expect(result.isStaged).toBe(false);
  });

  it('3. Pre-Prompt ACL Enforcement: blocks collaborator from reading or modifying denied file', async () => {
    const readTool = defaultToolRegistry.getTool('read_file');
    const writeTool = defaultToolRegistry.getTool('write_file');

    await expect(
      readTool!.execute(
        { sessionId, projectId, branchId, userId: collaborator.id },
        { path: 'secret-keys.ts' }
      )
    ).rejects.toThrow(/denied by project ACL policy/i);

    await expect(
      writeTool!.execute(
        { sessionId, projectId, branchId, userId: collaborator.id },
        { path: 'secret-keys.ts', content: 'new hacked content' }
      )
    ).rejects.toThrow(/permission is denied/i);
  });

  it('4. WriteFileTool & AgentStagingService: stages changes without mutating original branch file', async () => {
    const writeTool = defaultToolRegistry.getTool('write_file');

    const stagedCode = `export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n`;

    const res = await writeTool!.execute(
      { sessionId, projectId, branchId, userId: owner.id },
      { path: 'main.ts', content: stagedCode }
    );

    expect(res.path).toBe('main.ts');
    expect(res.isStaged).toBe(true);
    expect(res.changeType).toBe('MODIFY');

    // Verify live DB ProjectFile is UNTOUCHED
    const dbFile = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(dbFile?.content).not.toContain('multiply');

    // Verify AgentStagedFile contains proposed modification
    const stagedFile = await AgentStagingService.getStagedFile(sessionId, 'main.ts');
    expect(stagedFile).toBeDefined();
    expect(stagedFile?.stagedContent).toContain('multiply');
    expect(stagedFile?.isApplied).toBe(false);
  });

  it('5. EditFileTool: performs surgical search-and-replace on staged file', async () => {
    const editTool = defaultToolRegistry.getTool('edit_file');

    const res = await editTool!.execute(
      { sessionId, projectId, branchId, userId: owner.id },
      {
        path: 'main.ts',
        target: 'return a * b;',
        replacement: 'return Math.imul(a, b);',
      }
    );

    expect(res.replacementsCount).toBe(1);

    const staged = await AgentStagingService.getStagedFile(sessionId, 'main.ts');
    expect(staged?.stagedContent).toContain('Math.imul(a, b);');
  });

  it('6. ListDirectoryTool: overlays uncommitted staged files with branch files', async () => {
    // Stage a brand new file
    await AgentStagingService.stageFile({
      sessionId,
      branchId,
      filePath: 'src/utils/math.ts',
      content: 'export const PI = 3.14159;\n',
    });

    const listTool = defaultToolRegistry.getTool('list_directory');
    const res = await listTool!.execute(
      { sessionId, projectId, branchId, userId: owner.id },
      { recursive: true }
    );

    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('main.ts');
    expect(paths).toContain('src/utils/math.ts');
    expect(paths).toContain('secret-keys.ts');

    // For collaborator, denied file is pruned from listing
    const collabRes = await listTool!.execute(
      { sessionId, projectId, branchId, userId: collaborator.id },
      { recursive: true }
    );
    const collabPaths = collabRes.files.map((f) => f.path);
    expect(collabPaths).not.toContain('secret-keys.ts');
  });

  it('7. AgentVerificationService: succeeds on clean TypeScript code', async () => {
    const result = await AgentVerificationService.verifyWorkspace({
      sessionId,
      branchId,
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics.length).toBe(0);
  });

  it('8. AgentVerificationService: catches syntax and compiler errors in staged code for self-healing', async () => {
    // Stage broken code with a deliberate syntax error
    await AgentStagingService.stageFile({
      sessionId,
      branchId,
      filePath: 'src/utils/broken.ts',
      content: `export function brokenFunc( { \n  return 42;\n`, // missing parameter name and closing paren
    });

    const result = await AgentVerificationService.verifyWorkspace({
      sessionId,
      branchId,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].filePath).toContain('broken.ts');
    expect(result.stderr).toContain('error TS');

    // Clean up broken staged file
    await AgentStagingService.discardStagedFiles({
      sessionId,
      filePaths: ['src/utils/broken.ts'],
    });
  });

  it('9. ToolRegistry: executes tools through dispatcher with audit logging', async () => {
    const dispatchResult = await defaultToolRegistry.executeTool({
      toolName: 'read_file',
      context: { sessionId, projectId, branchId, userId: owner.id },
      inputPayload: { path: 'main.ts' },
    });

    expect(dispatchResult.toolCallId).toBeDefined();
    expect(dispatchResult.durationMs).toBeGreaterThanOrEqual(0);
    expect(dispatchResult.output.content).toContain('export function add');

    // Verify DB audit record in agent_tool_calls
    const auditRecord = await prisma.agentToolCall.findUnique({
      where: { id: dispatchResult.toolCallId },
    });
    expect(auditRecord).toBeDefined();
    expect(auditRecord?.status).toBe('SUCCESS');
    expect(auditRecord?.toolName).toBe('read_file');
  });

  it('10. Atomic Multi-File Transaction Apply: commits staged changes and completes session', async () => {
    const applyRes = await AgentStagingService.applyStagedFiles({
      sessionId,
      userId: owner.id,
    });

    expect(applyRes.appliedCount).toBeGreaterThanOrEqual(2); // main.ts and src/utils/math.ts

    // Verify live DB file main.ts now reflects the staged content
    const updatedMain = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(updatedMain?.content).toContain('Math.imul(a, b);');

    // Verify new file src/utils/math.ts now exists in the database
    const createdFile = await AgentStagingService.findFileByPath(
      branchId,
      'src/utils/math.ts'
    );
    expect(createdFile).toBeDefined();
    expect(createdFile?.content).toContain('export const PI = 3.14159;');

    // Verify AgentSession is now marked COMPLETED
    const sessionRecord = await prisma.agentSession.findUnique({
      where: { id: sessionId },
    });
    expect(sessionRecord?.status).toBe('COMPLETED');
  });

  it('11. Optimistic Concurrency Control (OCC): rejects batch apply if a file was modified concurrently', async () => {
    // 1. Create a fresh session
    const conflictSession = await prisma.agentSession.create({
      data: {
        projectId,
        branchId,
        userId: owner.id,
        title: 'OCC Conflict Test Session',
        prompt: 'Testing OCC collision detection',
        status: 'AWAITING_REVIEW',
      },
    });

    // 2. Look up current main.ts version
    const currentMain = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(currentMain).toBeDefined();
    const versionBefore = currentMain!.version;

    // 3. Stage a change targeting the current version
    await AgentStagingService.stageFile({
      sessionId: conflictSession.id,
      branchId,
      filePath: 'main.ts',
      content: '// Agent modification that will conflict\n',
    });

    // 4. Simulate a concurrent developer edit directly on main.ts, incrementing version
    await prisma.projectFile.update({
      where: { id: rootFileId },
      data: {
        content: '// Developer manual edit\n',
        version: { increment: 1 },
      },
    });

    // 5. Attempt to apply staged changes -> MUST throw 409 CONFLICT and roll back
    await expect(
      AgentStagingService.applyStagedFiles({
        sessionId: conflictSession.id,
        userId: owner.id,
      })
    ).rejects.toThrow(/Concurrent modification detected/i);

    // 6. Verify the developer's content was NOT overwritten
    const preservedMain = await prisma.projectFile.findUnique({
      where: { id: rootFileId },
    });
    expect(preservedMain?.content).toBe('// Developer manual edit\n');
    expect(preservedMain?.version).toBe(versionBefore + 1);

    // 7. Verify staged record hasConflict flag was flipped to true
    const staged = await AgentStagingService.getStagedFile(
      conflictSession.id,
      'main.ts'
    );
    expect(staged?.hasConflict).toBe(true);

    // Clean up
    await prisma.agentSession.delete({
      where: { id: conflictSession.id },
    });
  });
});
