import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
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
  spawn(containerName: string, cols: number, rows: number): TerminalProcess;
  resize?(containerName: string, cols: number, rows: number): Promise<void>;
}

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
    ];

    const child = spawn('docker', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams;

    return child;
  }

  async resize(_containerName: string, _cols: number, _rows: number): Promise<void> {
    // Note: Docker CLI stdin stream can be resized via window change or env
  }
}

export interface TerminalSession {
  sessionId: string;
  projectId: string;
  containerName: string;
  process: TerminalProcess;
  ws: WebSocket;
  createdAt: Date;
}

export class TerminalService {
  private sessions = new Map<string, TerminalSession>();
  private spawner: TerminalSpawner;

  constructor(spawner?: TerminalSpawner) {
    this.spawner = spawner || new DockerTerminalSpawner();
  }

  setSpawner(spawner: TerminalSpawner): void {
    this.spawner = spawner;
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
    // 1. Verify user has write/edit permissions to the project
    await assertProjectAccess(projectId, userId, 'editor');

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

    // 3. Spawn interactive shell inside container
    const proc = this.spawner.spawn(sandbox.containerName, cols, rows);
    const sessionId = `term_${projectId}_${Date.now()}`;

    const session: TerminalSession = {
      sessionId,
      projectId,
      containerName: sandbox.containerName,
      process: proc,
      ws,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    // 4. Pipe process stdout & stderr to WebSocket
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

    switch (msg.type) {
      case 'input':
        if (session.process.stdin.writable) {
          session.process.stdin.write(msg.data);
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
