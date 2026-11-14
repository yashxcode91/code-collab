import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@codecollab/database';
import { app } from '../src/app';
import {
  parsePreviewPath,
  PreviewGatewayService,
} from '../src/modules/sandbox/previewGateway.service';
import {
  DockerExecutor,
  SandboxManagerService,
} from '../src/modules/sandbox/sandboxManager.service';
import { handlePreviewWebSocketUpgrade } from '../src/modules/sandbox/previewWebSocket';
import { signPreviewToken } from '../src/utils/jwt';

const TRUSTED_ORIGIN = 'http://localhost:5173';
const TEST_EMAIL_DOMAIN = '@vitest-sandbox.codecollab.test';
const runId = String(Date.now()).slice(-5);

const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

describe('Day 9: Cloud Sandboxes & Preview Gateway (Steps 2 & 3)', () => {
  let userId: string;
  let projectId: string;
  let branchId: string;
  let mockServer: http.Server;
  let mockServerPort: number;

  beforeAll(async () => {
    // 1. Create test user
    const user = await prisma.user.create({
      data: {
        email: makeTestEmail('sandbox_dev'),
        username: `dev_${runId}`,
        passwordHash: 'dummy_hash',
      },
    });
    userId = user.id;

    // 2. Create test project and branch
    const project = await prisma.project.create({
      data: {
        name: `Sandbox Proj ${runId}`,
        ownerId: userId,
        isPublic: false,
      },
    });
    projectId = project.id;

    const branch = await prisma.projectBranch.create({
      data: {
        projectId,
        name: 'main',
        isDefault: true,
      },
    });
    branchId = branch.id;

    // 3. Create starter project files in branch
    await prisma.projectFile.createMany({
      data: [
        {
          branchId,
          name: 'index.html',
          nodeType: 'FILE',
          content: '<h1>Hello Preview</h1>',
        },
        {
          branchId,
          name: 'style.css',
          nodeType: 'FILE',
          content: 'body { background: purple; }',
        },
      ],
    });

    // 4. Spin up a local mock container HTTP server to test real reverse proxying
    mockServer = http.createServer((req, res) => {
      if (req.url?.includes('style.css')) {
        res.writeHead(200, {
          'Content-Type': 'text/css',
          'X-Frame-Options': 'DENY',
        });
        res.end('body { background: purple; }');
      } else {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'X-Frame-Options': 'DENY',
          'Content-Security-Policy': "frame-ancestors 'none'",
        });
        res.end('<!DOCTYPE html><html><body><h1>Mock Container App</h1></body></html>');
      }
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as any;
        mockServerPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }

    await prisma.previewSandbox.deleteMany({
      where: { projectId },
    });
    await prisma.projectFile.deleteMany({
      where: { branchId },
    });
    await prisma.projectBranch.deleteMany({
      where: { projectId },
    });
    await prisma.project.deleteMany({
      where: { id: projectId },
    });
    await prisma.user.deleteMany({
      where: { id: userId },
    });
  });

  describe('Step 2: SandboxManagerService Unit & Lifecycle Tests', () => {
    it('generates sanitized, collision-resistant container names', () => {
      const manager = new SandboxManagerService();
      const name = manager.getContainerName('proj-1234-abcd', 'branch-5678-efgh');
      expect(name).toBe('cc-sbx-proj1234-branch56');
    });

    it('synchronizes database branch files into host temporary workspace with fallback server', async () => {
      const manager = new SandboxManagerService();
      const hostDir = await manager.syncBranchFilesToWorkspace(projectId, branchId);

      expect(hostDir).toContain(projectId);
      expect(hostDir).toContain(branchId);
    });

    it('manages container boot lifecycle with DockerExecutor, resource limits, and PostgreSQL state', async () => {
      const mockExecCalls: string[][] = [];
      const mockDocker: DockerExecutor = {
        async exec(args: string[]) {
          mockExecCalls.push(args);
          if (args[0] === 'network' && args[1] === 'inspect') {
            return { stdout: 'network exists', stderr: '', exitCode: 0 };
          }
          if (args[0] === 'rm') {
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          if (args[0] === 'run') {
            return { stdout: 'container123456789abc', stderr: '', exitCode: 0 };
          }
          if (args[0] === 'inspect') {
            return {
              stdout: JSON.stringify({
                Networks: {
                  'codecollab-sandbox': { IPAddress: '172.28.0.5' },
                },
                Ports: {
                  '5173/tcp': [{ HostPort: '59123' }],
                },
              }),
              stderr: '',
              exitCode: 0,
            };
          }
          if (args[0] === 'logs') {
            return { stdout: 'Server running on 5173\nReady', stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };

      const manager = new SandboxManagerService(mockDocker);
      const result = await manager.startSandbox({
        projectId,
        branchId,
        userId,
        primaryPort: 5173,
        memoryLimitMb: 512,
        cpuLimit: 1.0,
      });

      expect(result.status).toBe('RUNNING');
      expect(result.primaryPort).toBe(5173);
      expect(result.internalIp).toBe('172.28.0.5');
      expect(result.previewUrl).toBe(`/preview/${projectId}/5173/`);

      // Verify Docker run command security arguments
      const runCall = mockExecCalls.find((c) => c[0] === 'run');
      expect(runCall).toBeDefined();
      expect(runCall).toContain('--network');
      expect(runCall).toContain('codecollab-sandbox');
      expect(runCall).toContain('--security-opt');
      expect(runCall).toContain('no-new-privileges:true');
      expect(runCall).toContain('--cap-drop=ALL');
      expect(runCall).toContain('-m');
      expect(runCall).toContain('512m');

      // Verify logs extraction
      const logs = await manager.getSandboxLogs(projectId, branchId);
      expect(logs).toContain('Server running on 5173');
      expect(logs).toContain('Ready');
    });

    it('gracefully stops and marks sandbox as STOPPED in PostgreSQL', async () => {
      const mockDocker: DockerExecutor = {
        async exec(args: string[]) {
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };

      const manager = new SandboxManagerService(mockDocker);
      const stopped = await manager.stopSandbox(projectId, branchId);

      expect(stopped.status).toBe('STOPPED');
      expect(stopped.internalIp).toBeNull();
      expect(stopped.stoppedAt).toBeDefined();
    });
  });

  describe('Step 3: Preview Gateway Data Plane & Reverse Proxy Tests', () => {
    it('correctly parses preview route paths and sub-resources', () => {
      const p1 = parsePreviewPath(`/preview/${projectId}/5173/index.html`);
      expect(p1?.projectId).toBe(projectId);
      expect(p1?.port).toBe(5173);
      expect(p1?.subPath).toBe('/index.html');

      const p2 = parsePreviewPath(`/preview/${projectId}/style.css`);
      expect(p2?.projectId).toBe(projectId);
      expect(p2?.port).toBeNull();
      expect(p2?.subPath).toBe('/style.css');

      const p3 = parsePreviewPath(`/preview/${projectId}`);
      expect(p3?.projectId).toBe(projectId);
      expect(p3?.port).toBeNull();
      expect(p3?.subPath).toBe('/');
    });

    it('redirects root preview routes without trailing slashes (302)', async () => {
      const res = await request(app).get(`/preview/${projectId}`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe(`/preview/${projectId}/`);
    });

    it('rejects unauthorized preview requests with 401 when missing tokens', async () => {
      const res = await request(app).get(`/preview/${projectId}/5173/`);
      expect(res.status).toBe(401);
      expect(res.text).toContain('Preview Authorization Required');
    });

    it('renders animated dark-mode booting screen when sandbox is in STARTING state', async () => {
      const token = signPreviewToken({ projectId, branchId, userId });

      // Put sandbox into STARTING state
      await prisma.previewSandbox.upsert({
        where: { projectId_branchId: { projectId, branchId } },
        create: {
          projectId,
          branchId,
          containerName: 'cc-test-box',
          status: 'STARTING',
          previewToken: token,
          primaryPort: 5173,
        },
        update: {
          status: 'STARTING',
          previewToken: token,
        },
      });

      const res = await request(app)
        .get(`/preview/${projectId}/5173/?token=${token}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Booting Cloud Sandbox');
      expect(res.text).toContain('http-equiv="refresh"');
    });

    it('renders informative status screen when sandbox is in STOPPED state', async () => {
      const token = signPreviewToken({ projectId, branchId, userId });

      await prisma.previewSandbox.update({
        where: { projectId_branchId: { projectId, branchId } },
        data: { status: 'STOPPED' },
      });

      const res = await request(app)
        .get(`/preview/${projectId}/5173/?token=${token}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Sandbox is Stopped');
    });

    it('transparently reverse-proxies HTTP requests to RUNNING container and relaxes framing headers', async () => {
      const token = signPreviewToken({ projectId, branchId, userId });

      // Point sandbox to our active mockServerPort
      await prisma.previewSandbox.update({
        where: { projectId_branchId: { projectId, branchId } },
        data: {
          status: 'RUNNING',
          primaryPort: mockServerPort,
          ports: [mockServerPort],
          internalIp: '127.0.0.1',
        },
      });

      const res = await request(app)
        .get(`/preview/${projectId}/${mockServerPort}/?token=${token}`);

      expect(res.status).toBe(200);
      expect(res.text).toContain('Mock Container App');

      // Verify framing headers were adjusted for iframe embedding
      expect(res.headers['x-frame-options']).toBeUndefined();
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    });

    it('passes through non-preview WebSocket upgrades and intercepts preview upgrades', () => {
      const nonPreviewReq: any = { url: '/socket.io/?EIO=4&transport=websocket' };
      const dummySocket: any = { write: () => {}, destroy: () => {} };
      const dummyHead = Buffer.from([]);

      const handledNonPreview = handlePreviewWebSocketUpgrade(
        nonPreviewReq,
        dummySocket,
        dummyHead
      );
      expect(handledNonPreview).toBe(false);

      const previewReq: any = {
        url: `/preview/${projectId}/5173/`,
        headers: { host: 'localhost:4000' },
      };
      const handledPreview = handlePreviewWebSocketUpgrade(
        previewReq,
        dummySocket,
        dummyHead
      );
      expect(handledPreview).toBe(true);
    });
  });

  describe('Step 4: Sandbox REST API Endpoints (/api/projects/:projectId/sandbox)', () => {
    let authCookie: string;
    let unauthorizedCookie: string;

    beforeAll(async () => {
      // Create session for project owner
      const res = await request(app)
        .post('/api/auth/register')
        .set('Origin', TRUSTED_ORIGIN)
        .send({
          email: makeTestEmail('owner_api'),
          username: `owner_${runId}`,
          password: 'Password123!',
        });

      authCookie = res.headers['set-cookie']?.[0]?.split(';')[0] || '';

      // Assign project to this registered user so assertProjectAccess succeeds
      await prisma.project.update({
        where: { id: projectId },
        data: { ownerId: res.body.data.user.id },
      });

      // Create an unauthorized outsider user
      const outsiderRes = await request(app)
        .post('/api/auth/register')
        .set('Origin', TRUSTED_ORIGIN)
        .send({
          email: makeTestEmail('outsider_api'),
          username: `outsider_${runId}`,
          password: 'Password123!',
        });

      unauthorizedCookie = outsiderRes.headers['set-cookie']?.[0]?.split(';')[0] || '';
    });

    it('rejects unauthenticated requests to sandbox endpoints with 401', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/sandbox/status`);
      expect(res.status).toBe(401);
    });

    it('rejects unauthorized non-member users with 403 (IDOR prevention)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sandbox/status`)
        .set('Cookie', unauthorizedCookie);

      expect(res.status).toBe(403);
    });

    it('queries sandbox status via GET /api/projects/:projectId/sandbox/status', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sandbox/status`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sandbox).toBeDefined();
    });

    it('stops sandbox via POST /api/projects/:projectId/sandbox/stop', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sandbox/stop`)
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', authCookie)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.sandbox.status).toBe('STOPPED');
    });

    it('handles log retrieval gracefully via GET /api/projects/:projectId/sandbox/logs', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sandbox/logs?tail=50`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.logs)).toBe(true);
    });
  });
});
