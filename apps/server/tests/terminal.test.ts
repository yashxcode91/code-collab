import http from 'node:http';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { prisma } from '@codecollab/database';
import { signAccessToken, signPreviewToken } from '../src/utils/jwt';
import {
  terminalService,
  type TerminalProcess,
  type TerminalSpawner,
} from '../src/modules/terminal/terminal.service';
import { handleTerminalWebSocketUpgrade } from '../src/modules/terminal/terminalWebSocket';

const TEST_EMAIL_DOMAIN = '@vitest-term.codecollab.test';
const runId = String(Date.now()).slice(-5);
const makeTestEmail = (label: string): string =>
  `${label}_${runId}${TEST_EMAIL_DOMAIN}`;

class MockTerminalProcess implements TerminalProcess {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  private exitListeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
  private errorListeners: ((err: Error) => void)[] = [];

  constructor() {
    this.stdin.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.trim() === 'exit') {
        this.exit(0);
      } else {
        this.stdout.write(`mock_out:${text}`);
      }
    });
  }

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exit(0);
    return true;
  }

  exit(code: number) {
    for (const l of this.exitListeners) l(code, null);
  }

  on(event: 'exit' | 'error', listener: any): this {
    if (event === 'exit') this.exitListeners.push(listener);
    if (event === 'error') this.errorListeners.push(listener);
    return this;
  }
}

class MockTerminalSpawner implements TerminalSpawner {
  activeProcess: MockTerminalProcess | null = null;
  lastResize: { containerName: string; cols: number; rows: number } | null = null;

  spawn(_containerName: string, _cols: number, _rows: number): TerminalProcess {
    this.activeProcess = new MockTerminalProcess();
    return this.activeProcess;
  }

  async resize(containerName: string, cols: number, rows: number): Promise<void> {
    this.lastResize = { containerName, cols, rows };
  }
}

describe('Day 10: Interactive Container Terminal (xterm.js + PTY Gateway)', () => {
  let server: http.Server;
  let serverPort: number;
  let ownerId: string;
  let nonMemberId: string;
  let projectId: string;
  let branchId: string;
  let validToken: string;
  let previewToken: string;
  let mockSpawner: MockTerminalSpawner;
  const openSockets: WebSocket[] = [];

  const trackSocket = (ws: WebSocket): WebSocket => {
    openSockets.push(ws);
    return ws;
  };

  /** Helper waiting for initial container greeting frame */
  const waitForGreeting = (ws: WebSocket): Promise<string> =>
    new Promise((resolve, reject) => {
      const handler = (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'output' && msg.data.includes('Connected to CodeCollab')) {
            ws.off('message', handler);
            resolve(msg.data);
          }
        } catch {
          // ignore
        }
      };
      ws.on('message', handler);
      ws.on('error', reject);
    });

  beforeAll(async () => {
    // 1. Create users
    const owner = await prisma.user.create({
      data: {
        email: makeTestEmail('owner'),
        username: `owner_${runId}`,
        passwordHash: 'dummy',
      },
    });
    ownerId = owner.id;

    const nonMember = await prisma.user.create({
      data: {
        email: makeTestEmail('nonmember'),
        username: `non_${runId}`,
        passwordHash: 'dummy',
      },
    });
    nonMemberId = nonMember.id;

    // 2. Create project & branch
    const project = await prisma.project.create({
      data: {
        name: `Term Project ${runId}`,
        ownerId,
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

    // 3. Mark sandbox as RUNNING in database
    await prisma.previewSandbox.create({
      data: {
        projectId,
        branchId,
        status: 'RUNNING',
        primaryPort: 5173,
        ports: [5173],
        containerName: `test-sbx-${runId}`,
      },
    });

    // 4. Generate JWT tokens
    validToken = signAccessToken({ sub: ownerId, role: 'USER' });
    previewToken = signPreviewToken({ projectId, branchId, userId: ownerId });

    // 5. Configure mock spawner
    mockSpawner = new MockTerminalSpawner();
    terminalService.setSpawner(mockSpawner);

    // 6. Start test HTTP server with upgrade handler
    server = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });

    server.on('upgrade', (req, socket, head) => {
      if (!handleTerminalWebSocketUpgrade(req, socket, head)) {
        socket.destroy();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch {}
    }

    if (server) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 500);
        server.close(() => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    if (projectId) {
      await prisma.previewSandbox.deleteMany({ where: { projectId } });
      await prisma.projectBranch.deleteMany({ where: { projectId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
    }
    if (ownerId && nonMemberId) {
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, nonMemberId] } } });
    }
  });

  it('rejects connection without token with 401 Unauthorized', async () => {
    const ws = trackSocket(new WebSocket(`ws://127.0.0.1:${serverPort}/terminal/${projectId}`));

    const errorEvent = await new Promise<any>((resolve) => {
      ws.on('error', (err) => resolve(err));
      ws.on('unexpected-response', (_req, res) => resolve(res));
    });

    expect(errorEvent.statusCode).toBe(401);
  });

  it('rejects non-member user attempting to access private project terminal', async () => {
    const nonMemberToken = signAccessToken({ sub: nonMemberId, role: 'USER' });
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${nonMemberToken}`
      )
    );

    const received: any[] = [];
    await new Promise<void>((resolve) => {
      ws.on('message', (data) => received.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
    });

    expect(received.some((m) => m.type === 'error')).toBe(true);
  });

  it('connects successfully with valid access token and receives greeting', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${validToken}&cols=100&rows=30`
      )
    );

    const greeting = await waitForGreeting(ws);
    expect(greeting).toContain('Connected to CodeCollab Container Terminal');
  });

  it('connects successfully with signed preview token', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${previewToken}`
      )
    );

    const greeting = await waitForGreeting(ws);
    expect(greeting).toContain('Connected to CodeCollab Container Terminal');
  });

  it('forwards keystrokes (input) and receives process stdout output', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${validToken}`
      )
    );

    await waitForGreeting(ws);

    const responsePromise = new Promise<string>((resolve) => {
      const handler = (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'output' && msg.data.includes('mock_out:ls -la')) {
            ws.off('message', handler);
            resolve(msg.data);
          }
        } catch {}
      };
      ws.on('message', handler);
    });

    ws.send(JSON.stringify({ type: 'input', data: 'ls -la\n' }));
    const output = await responsePromise;
    expect(output).toContain('mock_out:ls -la');
  });

  it('handles window resize events cleanly', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${validToken}`
      )
    );

    await waitForGreeting(ws);

    ws.send(JSON.stringify({ type: 'resize', cols: 140, rows: 45 }));

    // Wait short tick for event loop
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawner.lastResize).toEqual({
      containerName: `test-sbx-${runId}`,
      cols: 140,
      rows: 45,
    });
  });

  it('replies with pong when ping heartbeat is sent', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${validToken}`
      )
    );

    await waitForGreeting(ws);

    const pongPromise = new Promise<any>((resolve) => {
      const handler = (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'pong') {
            ws.off('message', handler);
            resolve(msg);
          }
        } catch {}
      };
      ws.on('message', handler);
    });

    ws.send(JSON.stringify({ type: 'ping' }));
    const pong = await pongPromise;
    expect(pong.type).toBe('pong');
  });

  it('handles exit command and notifies client with exit code', async () => {
    const ws = trackSocket(
      new WebSocket(
        `ws://127.0.0.1:${serverPort}/terminal/${projectId}?token=${validToken}`
      )
    );

    await waitForGreeting(ws);

    const exitPromise = new Promise<any>((resolve) => {
      const handler = (raw: any) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'exit') {
            ws.off('message', handler);
            resolve(msg);
          }
        } catch {}
      };
      ws.on('message', handler);
    });

    ws.send(JSON.stringify({ type: 'input', data: 'exit\n' }));
    const exitMsg = await exitPromise;
    expect(exitMsg.exitCode).toBe(0);
  });
});
