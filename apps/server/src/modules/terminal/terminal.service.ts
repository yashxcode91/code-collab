import http from 'node:http';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PassThrough, type Writable, type Readable, type Duplex } from 'node:stream';
import { prisma } from '@codecollab/database';
import { AppError } from '../../utils/AppError';
import { assertProjectAccess } from '../projects/project.auth';
import type {
  TerminalClientMessage,
  TerminalServerMessage,
} from '@codecollab/shared';
import type { WebSocket } from 'ws';

export interface TerminalProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export interface TerminalSpawner {
  spawn(containerName: string, cols: number, rows: number): TerminalProcess | Promise<TerminalProcess>;
  resize?(containerName: string, cols: number, rows: number): Promise<void>;
}

/**
 * Native Docker Engine API spawner utilizing /var/run/docker.sock.
 * Allocates a true Linux pseudo-terminal (PTY) inside the container with Tty: true.
 * This guarantees proper terminal echo, shell prompt (PS1), Enter key handling (CR/NL),
 * arrow keys, color support, tab completion, and window resizing.
 */
export class DockerSocketTerminalSpawner implements TerminalSpawner {
  private execIds = new Map<string, string>();

  async spawn(containerName: string, cols: number, rows: number): Promise<TerminalProcess> {
    const postData = JSON.stringify({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Cmd: ['/bin/sh'],
      Env: [
        'TERM=xterm-256color',
        `COLUMNS=${cols}`,
        `LINES=${rows}`,
        'HOME=/workspace',
        'USER=runner',
      ],
      WorkingDir: '/workspace',
      User: '10001',
    });

    const execId = await new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: '/var/run/docker.sock',
          path: `/containers/${encodeURIComponent(containerName)}/exec`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 300) {
              return reject(new Error(`Docker exec create failed (${res.statusCode}): ${body}`));
            }
            try {
              const parsed = JSON.parse(body);
              if (parsed.Id) {
                resolve(parsed.Id);
              } else {
                reject(new Error(`Docker exec create returned no Id: ${body}`));
              }
            } catch (err) {
              reject(err);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    this.execIds.set(containerName, execId);

    const startData = JSON.stringify({
      Detach: false,
      Tty: true,
    });

    return new Promise<TerminalProcess>((resolve, reject) => {
      const req = http.request({
        socketPath: '/var/run/docker.sock',
        path: `/exec/${execId}/start`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(startData),
          Connection: 'Upgrade',
          Upgrade: 'tcp',
        },
      });

      req.on('upgrade', (_res, socket: Duplex, head: Buffer) => {
        const emitter = new EventEmitter();
        const dummyStderr = new PassThrough();

        const proc: TerminalProcess = {
          stdin: socket,
          stdout: socket,
          stderr: dummyStderr,
          kill: () => {
            socket.destroy();
            return true;
          },
          on: (event: 'exit' | 'error', listener: any) => {
            emitter.on(event, listener);
            return proc;
          },
        };

        if (head && head.length > 0) {
          socket.unshift(head);
        }

        socket.on('close', () => {
          this.execIds.delete(containerName);
          emitter.emit('exit', 0, null);
        });

        socket.on('error', (err) => {
          this.execIds.delete(containerName);
          emitter.emit('error', err);
        });

        // Trigger initial resize once stream is attached
        void this.resize(containerName, cols, rows);

        resolve(proc);
      });

      req.on('response', (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          reject(new Error(`Docker exec start failed with HTTP ${res.statusCode}: ${body}`));
        });
      });

      req.on('error', reject);
      req.write(startData);
      req.end();
    });
  }

  async resize(containerName: string, cols: number, rows: number): Promise<void> {
    const execId = this.execIds.get(containerName);
    if (!execId) return;

    try {
      await new Promise<void>((resolve) => {
        const req = http.request(
          {
            socketPath: '/var/run/docker.sock',
            path: `/exec/${execId}/resize?h=${rows}&w=${cols}`,
            method: 'POST',
            headers: {
              'Content-Length': '0',
            },
          },
          () => resolve()
        );
        req.on('error', () => resolve());
        req.end();
      });
    } catch {
      // Ignore resize errors
    }
  }
}

/**
 * Docker CLI fallback spawner for environments without direct socket access.
 */
export class DockerTerminalSpawner implements TerminalSpawner {
  spawn(containerName: string, cols: number, rows: number): TerminalProcess {
    const args = [
      'exec',
      '-i',
      '-u',
      '10001',
      '-e',
      'TERM=xterm-256color',
      '-e',
      `COLUMNS=${cols}`,
      '-e',
      `LINES=${rows}`,
      containerName,
      '/bin/sh',
      '-i',
    ];

    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    return child;
  }

  async resize(_containerName: string, _cols: number, _rows: number): Promise<void> {
    // Docker CLI stdin stream can be resized via window change or env
  }
}

/**
 * Automatically chooses DockerSocketTerminalSpawner when /var/run/docker.sock is available,
 * otherwise falling back cleanly to DockerTerminalSpawner.
 */
export class AutoDetectTerminalSpawner implements TerminalSpawner {
  private socketSpawner = new DockerSocketTerminalSpawner();
  private cliSpawner = new DockerTerminalSpawner();

  private canUseSocket(): boolean {
    try {
      return fs.existsSync('/var/run/docker.sock');
    } catch {
      return false;
    }
  }

  async spawn(containerName: string, cols: number, rows: number): Promise<TerminalProcess> {
    if (this.canUseSocket()) {
      try {
        return await this.socketSpawner.spawn(containerName, cols, rows);
      } catch (err) {
        console.warn('[TerminalService] Docker socket exec failed, falling back to CLI:', err);
        return this.cliSpawner.spawn(containerName, cols, rows);
      }
    }
    return this.cliSpawner.spawn(containerName, cols, rows);
  }

  async resize(containerName: string, cols: number, rows: number): Promise<void> {
    if (this.canUseSocket()) {
      await this.socketSpawner.resize(containerName, cols, rows);
    }
  }
}

export interface TerminalSession {
  sessionId: string;
  projectId: string;
  containerName: string;
  process: TerminalProcess;
  ws: WebSocket;
  createdAt: Date;
  lastActivityAt: Date;
}

const MAX_TERMINAL_SESSIONS_PER_PROJECT = 3;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private spawner: TerminalSpawner;
  private idleCheckInterval: NodeJS.Timeout | null = null;

  constructor(spawner?: TerminalSpawner) {
    this.spawner = spawner || new AutoDetectTerminalSpawner();
    this.idleCheckInterval = setInterval(() => this.reapIdleSessions(), 60_000);
    if (this.idleCheckInterval.unref) {
      this.idleCheckInterval.unref();
    }
  }

  setSpawner(spawner: TerminalSpawner): void {
    this.spawner = spawner;
  }

  /**
   * Checks whether an active, open interactive terminal session exists for a given project.
   */
  hasActiveSession(projectId: string): boolean {
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId) {
        return true;
      }
    }
    return false;
  }

  private reapIdleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt.getTime() > SESSION_IDLE_TIMEOUT_MS) {
        this.sendToWs(session.ws, {
          type: 'error',
          message: 'Terminal session closed due to 30 minutes of inactivity.',
        });
        this.closeSession(sessionId);
        if (session.ws.readyState === session.ws.OPEN) {
          session.ws.close();
        }
      }
    }
  }

  /**
   * Authorizes and initiates an interactive terminal session inside a project's sandbox.
   */
  async createSession(
    userId: string,
    projectId: string,
    ws: WebSocket,
    options: { cols?: number; rows?: number } = {}
  ): Promise<TerminalSession> {
    // 1. Verify user is the workspace owner (terminal execution is strictly owner-only)
    try {
      await assertProjectAccess(projectId, userId, 'owner');
    } catch (err: any) {
      if (err instanceof AppError && err.code === 'INSUFFICIENT_ROLE') {
        throw new AppError(
          403,
          'INSUFFICIENT_ROLE',
          'Terminal privileges are reserved for the workspace owner. Collaborators, please enjoy the code without the power to execute it.'
        );
      }
      throw err;
    }

    // 2. Query sandbox status
    const sandbox = await prisma.previewSandbox.findFirst({
      where: { projectId },
    });

    if (!sandbox || sandbox.status !== 'RUNNING' || !sandbox.containerName) {
      throw new AppError(
        400,
        'SANDBOX_NOT_RUNNING',
        'Cannot open terminal: Sandbox container is not running. Start the sandbox first.'
      );
    }

    const cols = Math.max(10, Math.min(options.cols || 80, 500));
    const rows = Math.max(5, Math.min(options.rows || 24, 200));

    // 3. Enforce maximum concurrent terminal sessions per project (prevent resource exhaustion)
    const existingSessions = Array.from(this.sessions.values()).filter(
      (s) => s.projectId === projectId
    );
    if (existingSessions.length >= MAX_TERMINAL_SESSIONS_PER_PROJECT) {
      existingSessions.sort(
        (a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime()
      );
      const oldest = existingSessions[0];
      this.sendToWs(oldest.ws, {
        type: 'error',
        message: 'Session replaced by a newer terminal connection.',
      });
      this.closeSession(oldest.sessionId);
      if (oldest.ws.readyState === oldest.ws.OPEN) {
        oldest.ws.close();
      }
    }

    // 4. Spawn interactive shell inside container
    const proc = await this.spawner.spawn(sandbox.containerName, cols, rows);
    const sessionId = `term_${projectId}_${Date.now()}`;
    const now = new Date();

    const session: TerminalSession = {
      sessionId,
      projectId,
      containerName: sandbox.containerName,
      process: proc,
      ws,
      createdAt: now,
      lastActivityAt: now,
    };

    this.sessions.set(sessionId, session);

    // 5. Pipe process stdout & stderr to WebSocket
    proc.stdout.on('data', (chunk: Buffer) => {
      this.sendToWs(ws, {
        type: 'output',
        data: chunk.toString('utf-8'),
      });
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      this.sendToWs(ws, {
        type: 'output',
        data: chunk.toString('utf-8'),
      });
    });

    // 5. Handle process exit
    proc.on('exit', (code) => {
      this.sendToWs(ws, {
        type: 'exit',
        exitCode: code ?? 0,
      });
      this.closeSession(sessionId);
      if (ws.readyState === ws.OPEN) {
        ws.close();
      }
    });

    proc.on('error', (err) => {
      this.sendToWs(ws, {
        type: 'error',
        message: `Terminal process error: ${err.message}`,
      });
      this.closeSession(sessionId);
    });

    // Initial greeting
    this.sendToWs(ws, {
      type: 'output',
      data: `\x1b[1;36mConnected to CodeCollab Container Terminal (${sandbox.containerName})\x1b[0m\r\n`,
    });

    return session;
  }

  /**
   * Dispatches incoming client messages (keystrokes, window resize, ping) to the process.
   */
  handleMessage(sessionId: string, msg: TerminalClientMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const now = new Date();
    session.lastActivityAt = now;

    // Refresh sandbox heartbeat so active terminal users are never auto-reaped
    prisma.previewSandbox
      .updateMany({
        where: { projectId: session.projectId, status: 'RUNNING' },
        data: { lastPingAt: now },
      })
      .catch(() => undefined);

    switch (msg.type) {
      case 'input':
        // Guard against massive buffer flooding (max 32KB per input frame)
        if (typeof msg.data === 'string' && msg.data.length > 32 * 1024) {
          return;
        }

        if (session.process.stdin.writable) {
          // If fallback child_process pipe without PTY, map CR to LF so sh executes
          const payload = (session.process as any).pid
            ? msg.data.replace(/\r/g, '\n')
            : msg.data;
          session.process.stdin.write(payload);
        }
        break;

      case 'resize':
        if (this.spawner.resize) {
          void this.spawner.resize(session.containerName, msg.cols, msg.rows);
        }
        break;

      case 'ping':
        this.sendToWs(session.ws, { type: 'pong' });
        break;
    }
  }

  /**
   * Cleanly terminates and destroys a terminal session.
   */
  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.process.kill('SIGTERM');
    } catch {
      // Ignore if process already exited
    }

    this.sessions.delete(sessionId);
  }

  private sendToWs(ws: WebSocket, payload: TerminalServerMessage): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}

export const terminalService = new TerminalService();
