import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prisma } from '@codecollab/database';
import {
  PreviewSandboxDTO,
  SandboxStatus,
  StartSandboxDTO,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { signPreviewToken } from '../../utils/jwt';

const execFileAsync = promisify(execFile);

export const DEFAULT_SANDBOX_IMAGE =
  process.env.SANDBOX_RUNNER_IMAGE || 'codecollab-runner-node:v1';
export const SANDBOX_NETWORK_NAME = 'codecollab-sandbox';
const DEFAULT_PRIMARY_PORT = 5173;
const DEFAULT_MEMORY_LIMIT_MB = 512;
const DEFAULT_CPU_LIMIT = 1.0;

export interface DockerExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerExecutor {
  exec(args: string[]): Promise<DockerExecutionResult>;
}

export class CliDockerExecutor implements DockerExecutor {
  async exec(args: string[]): Promise<DockerExecutionResult> {
    try {
      const { stdout, stderr } = await execFileAsync('docker', args, {
        timeout: 30000,
        maxBuffer: 5 * 1024 * 1024,
      });
      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
      };
    } catch (err: any) {
      return {
        stdout: (err.stdout || '').trim(),
        stderr: (err.stderr || err.message || '').trim(),
        exitCode: err.code ?? (typeof err.status === 'number' ? err.status : 1),
      };
    }
  }
}

export interface StartSandboxOptions extends Partial<StartSandboxDTO> {
  userId: string;
  projectId: string;
  branchId: string;
  memoryLimitMb?: number;
  cpuLimit?: number;
  primaryPort?: number;
  command?: string;
}

export class SandboxManagerService {
  constructor(
    private readonly docker: DockerExecutor = new CliDockerExecutor()
  ) {}

  /**
   * Generates a sanitized, collision-resistant Docker container name.
   */
  public getContainerName(projectId: string, branchId: string): string {
    const cleanProj = projectId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const cleanBranch = branchId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    return `cc-sbx-${cleanProj}-${cleanBranch}`;
  }

  /**
   * Ensures the private Docker bridge network (`codecollab-sandbox`) exists.
   */
  async ensureSandboxNetwork(): Promise<string> {
    const inspectResult = await this.docker.exec([
      'network',
      'inspect',
      SANDBOX_NETWORK_NAME,
    ]);

    if (inspectResult.exitCode === 0) {
      return SANDBOX_NETWORK_NAME;
    }

    const createResult = await this.docker.exec([
      'network',
      'create',
      '--driver',
      'bridge',
      SANDBOX_NETWORK_NAME,
    ]);

    if (createResult.exitCode !== 0 && !createResult.stderr.includes('already exists')) {
      throw new AppError(
        500,
        'SANDBOX_NETWORK_ERROR',
        `Failed to initialize sandbox network: ${createResult.stderr}`
      );
    }

    return SANDBOX_NETWORK_NAME;
  }

  /**
   * Queries branch files from PostgreSQL and syncs them to a host workspace directory.
   */
  async syncBranchFilesToWorkspace(
    projectId: string,
    branchId: string
  ): Promise<string> {
    const files = await prisma.projectFile.findMany({
      where: { branchId },
      select: {
        id: true,
        parentId: true,
        name: true,
        nodeType: true,
        content: true,
      },
    });

    const baseSandboxDir =
      process.env.SANDBOX_WORKSPACE_DIR ||
      path.join(os.tmpdir(), 'codecollab-sandboxes');
    const hostWorkspaceDir = path.join(
      baseSandboxDir,
      projectId,
      branchId
    );

    await fs.mkdir(baseSandboxDir, { recursive: true, mode: 0o777 }).catch(() => undefined);
    await fs.mkdir(hostWorkspaceDir, { recursive: true, mode: 0o777 });
    await fs.chmod(hostWorkspaceDir, 0o777).catch(() => undefined);

    // Build map of ID -> file row for path reconstruction
    const byId = new Map<string, typeof files[number]>();
    for (const f of files) {
      byId.set(f.id, f);
    }

    let hasIndexHtml = false;

    for (const file of files) {
      if (file.nodeType !== 'FILE') continue;

      // Reconstruct relative file path
      const segments: string[] = [];
      let cursor: string | null = file.id;
      let depth = 0;
      while (cursor && depth < 50) {
        depth += 1;
        const node = byId.get(cursor);
        if (!node) break;
        segments.unshift(node.name);
        cursor = node.parentId;
      }

      const relativePath = segments.join('/');
      if (relativePath === 'index.html') hasIndexHtml = true;

      // Security check: reject paths traversing out of the workspace
      const targetFilePath = path.normalize(path.join(hostWorkspaceDir, relativePath));
      if (!targetFilePath.startsWith(hostWorkspaceDir)) {
        continue;
      }

      await fs.mkdir(path.dirname(targetFilePath), { recursive: true, mode: 0o777 });
      await fs.chmod(path.dirname(targetFilePath), 0o777).catch(() => undefined);
      await fs.writeFile(targetFilePath, file.content, 'utf8');
      await fs.chmod(targetFilePath, 0o666).catch(() => undefined);
    }

    // If no index.html exists, create a default landing page
    if (!hasIndexHtml) {
      const defaultIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CodeCollab Live Preview</title>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0b0f19;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
      box-sizing: border-box;
      text-align: center;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 9999px;
      background: rgba(251, 146, 60, 0.15);
      border: 1px solid rgba(251, 146, 60, 0.3);
      color: #fb923c;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .badge::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 10px #22c55e;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      margin: 0 0 12px;
      letter-spacing: -0.02em;
    }
    p {
      color: #94a3b8;
      font-size: 15px;
      max-width: 480px;
      line-height: 1.6;
      margin: 0 0 28px;
    }
    .code-box {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 8px;
      padding: 14px 20px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      color: #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="badge">Sandbox Container Active</div>
  <h1>Your CodeCollab Project is Live!</h1>
  <p>Create an <code>index.html</code> or <code>package.json</code> in the Studio File Tree to preview your web application in real time.</p>
  <div class="code-box">Isolated Bridge: codecollab-sandbox &bull; Port: 5173</div>
</body>
</html>`;
      await fs.writeFile(
        path.join(hostWorkspaceDir, 'index.html'),
        defaultIndexHtml,
        'utf8'
      );
      await fs.chmod(path.join(hostWorkspaceDir, 'index.html'), 0o666).catch(() => undefined);
    }

    // Write the built-in fast static HTTP server helper
    const serverScript = `// CodeCollab Built-in Preview Static Server
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = parseInt(process.env.PORT || '5173', 10);
const ROOT = process.cwd();

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url, 'http://localhost');
    let targetPath = decodeURIComponent(parsedUrl.pathname);
    if (targetPath.endsWith('/')) {
      targetPath += 'index.html';
    }

    const safePath = path.normalize(path.join(ROOT, targetPath));
    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Access Denied');
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        // SPA Fallback: serve index.html if present
        const indexPath = path.join(ROOT, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'X-CodeCollab-Fallback': 'spa-index',
          });
          return fs.createReadStream(indexPath).pipe(res);
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('File Not Found');
      }

      const ext = path.extname(safePath).toLowerCase();
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(safePath).pipe(res);
    });
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[CodeCollab Sandbox] Preview server listening on 0.0.0.0:' + PORT);
});
`;

    await fs.writeFile(
      path.join(hostWorkspaceDir, '_codecollab_serve.js'),
      serverScript,
      'utf8'
    );
    await fs.chmod(path.join(hostWorkspaceDir, '_codecollab_serve.js'), 0o666).catch(() => undefined);

    return hostWorkspaceDir;
  }

  /**
   * Starts a Docker sandbox container for the given project & branch.
   */
  async startSandbox(options: StartSandboxOptions): Promise<PreviewSandboxDTO> {
    const {
      projectId,
      branchId,
      userId,
      memoryLimitMb = DEFAULT_MEMORY_LIMIT_MB,
      cpuLimit = DEFAULT_CPU_LIMIT,
      primaryPort = DEFAULT_PRIMARY_PORT,
      command,
    } = options;

    const containerName = this.getContainerName(projectId, branchId);

    // Check if an existing sandbox is already running
    const existing = await prisma.previewSandbox.findFirst({
      where: { projectId, branchId },
    });

    if (existing && existing.status === 'RUNNING') {
      const inspectCheck = await this.docker.exec([
        'inspect',
        '-f',
        '{{.State.Running}}',
        containerName,
      ]);

      if (inspectCheck.exitCode === 0 && inspectCheck.stdout === 'true') {
        // Already running and alive!
        await prisma.previewSandbox.update({
          where: { id: existing.id },
          data: { lastPingAt: new Date() },
        });

        return this.mapToDto(existing);
      }
    }

    // 1. Ensure private Docker bridge network exists
    await this.ensureSandboxNetwork();

    // 2. Sync branch files to host workspace
    const hostWorkspaceDir = await this.syncBranchFilesToWorkspace(
      projectId,
      branchId
    );

    // 3. Remove any previous container with this name
    await this.docker.exec(['rm', '-f', containerName]);

    // 4. Generate signed preview token
    const previewToken = signPreviewToken({ projectId, branchId, userId });

    // 5. Upsert DB record in STARTING state
    const sandboxRecord = await prisma.previewSandbox.upsert({
      where: {
        projectId_branchId: { projectId, branchId },
      },
      create: {
        projectId,
        branchId,
        containerName,
        status: 'STARTING',
        primaryPort,
        memoryLimitMb,
        cpuLimit,
        previewToken,
        ports: [primaryPort],
      },
      update: {
        status: 'STARTING',
        containerName,
        primaryPort,
        memoryLimitMb,
        cpuLimit,
        previewToken,
        lastPingAt: new Date(),
      },
    });

    // 6. Assemble secure Docker run arguments
    const runArgs = [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      SANDBOX_NETWORK_NAME,
      '-p',
      `127.0.0.1::${primaryPort}`,
      '-m',
      `${memoryLimitMb}m`,
      '--cpus',
      `${cpuLimit}`,
      '--security-opt',
      'no-new-privileges:true',
      '--cap-drop=ALL',
      '-v',
      `${hostWorkspaceDir}:/workspace:rw`,
      '-w',
      '/workspace',
      '--restart',
      'no',
      DEFAULT_SANDBOX_IMAGE,
    ];

    if (command && command.trim().length > 0) {
      runArgs.push('sh', '-c', command.trim());
    } else {
      runArgs.push('node', '_codecollab_serve.js');
    }

    const runResult = await this.docker.exec(runArgs);

    if (runResult.exitCode !== 0) {
      await prisma.previewSandbox.update({
        where: { id: sandboxRecord.id },
        data: { status: 'FAILED', errorMessage: runResult.stderr },
      });
      throw new AppError(
        500,
        'SANDBOX_SPAWN_FAILED',
        `Failed to launch sandbox container: ${runResult.stderr}`
      );
    }

    const containerId = runResult.stdout.slice(0, 12);

    // 7. Inspect container to resolve internal network IP
    const inspectNet = await this.docker.exec([
      'inspect',
      containerName,
      '--format',
      `{{json .NetworkSettings}}`,
    ]);

    let internalIp: string | null = null;

    if (inspectNet.exitCode === 0) {
      try {
        const netSettings = JSON.parse(inspectNet.stdout);
        internalIp =
          netSettings.Networks?.[SANDBOX_NETWORK_NAME]?.IPAddress || null;
      } catch (parseErr) {
        console.warn(
          `[SandboxManager] Could not parse container network inspect output:`,
          parseErr
        );
      }
    }

    // 8. Update DB record to RUNNING
    const updated = await prisma.previewSandbox.update({
      where: { id: sandboxRecord.id },
      data: {
        status: 'RUNNING',
        containerId,
        internalIp,
        ports: [primaryPort],
        startedAt: new Date(),
        lastPingAt: new Date(),
      },
    });

    return this.mapToDto(updated);
  }

  /**
   * Stops and removes the Docker sandbox container.
   */
  async stopSandbox(
    projectId: string,
    branchId: string
  ): Promise<PreviewSandboxDTO> {
    const sandbox = await prisma.previewSandbox.findFirst({
      where: { projectId, branchId },
    });

    if (!sandbox) {
      throw new AppError(404, 'SANDBOX_NOT_FOUND', 'Preview sandbox not found');
    }

    const containerName = sandbox.containerName;

    // Gracefully stop with 2s timeout then remove
    await this.docker.exec(['stop', '-t', '2', containerName]);
    await this.docker.exec(['rm', '-f', containerName]);

    const updated = await prisma.previewSandbox.update({
      where: { id: sandbox.id },
      data: {
        status: 'STOPPED',
        internalIp: null,
        stoppedAt: new Date(),
      },
    });

    return this.mapToDto(updated);
  }

  /**
   * Queries the current status of the sandbox and reconciles with container state.
   */
  async getSandboxStatus(
    projectId: string,
    branchId: string
  ): Promise<PreviewSandboxDTO | null> {
    const sandbox = await prisma.previewSandbox.findFirst({
      where: { projectId, branchId },
    });

    if (!sandbox) return null;

    if (sandbox.status === 'RUNNING') {
      const inspectCheck = await this.docker.exec([
        'inspect',
        '-f',
        '{{.State.Running}}',
        sandbox.containerName,
      ]);

      if (inspectCheck.exitCode !== 0 || inspectCheck.stdout !== 'true') {
        const updated = await prisma.previewSandbox.update({
          where: { id: sandbox.id },
          data: { status: 'STOPPED', internalIp: null, stoppedAt: new Date() },
        });
        return this.mapToDto(updated);
      }
    }

    return this.mapToDto(sandbox);
  }

  /**
   * Retrieves recent container stdout/stderr logs.
   */
  async getSandboxLogs(
    projectId: string,
    branchId: string,
    tail = 100
  ): Promise<string[]> {
    const sandbox = await prisma.previewSandbox.findFirst({
      where: { projectId, branchId },
    });

    if (!sandbox) {
      throw new AppError(404, 'SANDBOX_NOT_FOUND', 'Preview sandbox not found');
    }

    const logResult = await this.docker.exec([
      'logs',
      '--tail',
      `${tail}`,
      sandbox.containerName,
    ]);

    const combined = `${logResult.stdout}\n${logResult.stderr}`.trim();
    if (!combined) return [];

    return combined.split('\n');
  }

  /**
   * Maps a Prisma PreviewSandbox database row into a clean PreviewSandboxDTO.
   */
  public mapToDto(row: any): PreviewSandboxDTO {
    return {
      id: row.id,
      projectId: row.projectId,
      branchId: row.branchId,
      containerId: row.containerId,
      containerName: row.containerName,
      internalIp: row.internalIp,
      status: row.status as SandboxStatus,
      ports: Array.isArray(row.ports) ? row.ports : [row.primaryPort ?? 5173],
      primaryPort: row.primaryPort ?? 5173,
      memoryLimitMb: row.memoryLimitMb ?? DEFAULT_MEMORY_LIMIT_MB,
      cpuLimit: row.cpuLimit ?? DEFAULT_CPU_LIMIT,
      previewToken: row.previewToken,
      previewUrl: `/preview/${row.projectId}/${row.primaryPort ?? 5173}/`,
      errorMessage: row.errorMessage ?? null,
      lastPingAt: row.lastPingAt ? row.lastPingAt.toISOString() : null,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      stoppedAt: row.stoppedAt ? row.stoppedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const sandboxManager = new SandboxManagerService();
