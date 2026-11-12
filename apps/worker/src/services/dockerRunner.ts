import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  EXECUTION_LIMITS,
  type ExecutionFailureKind,
  type ExecutionStatus,
  type SupportedLanguage,
} from '@codecollab/shared';
import {
  LANGUAGE_RUNTIMES,
  resolveSafeEntry,
  validateRunnerImage,
} from '../config/runtimes';

export interface RunExecutionParams {
  runId: string;
  language: SupportedLanguage;
  entryFileName?: string | null;
  sourceCode: string;
  initialStdin?: string | null;
  timeoutMs?: number;
  onStreamChunk?: (event: {
    stream: 'stdout' | 'stderr';
    seq: number;
    chunk: string;
    truncated: boolean;
    timestamp: number;
  }) => void;
  onSpawned?: (handle: ActiveExecutionHandle) => void;
}

export interface ActiveExecutionHandle {
  writeStdin: (data: string) => boolean;
  cancel: () => void;
  getAccumulatedOutput: () => {
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  };
}

export interface ExecutionRunResult {
  status: Exclude<ExecutionStatus, 'QUEUED' | 'RUNNING'>;
  exitCode: number | null;
  failureKind: ExecutionFailureKind | null;
  errorMessage: string | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
}

const MAX_BYTES = EXECUTION_LIMITS.MAX_OUTPUT_BYTES;
const CHUNK_BYTES = EXECUTION_LIMITS.MAX_STREAM_CHUNK_BYTES;
const COALESCE_MS = EXECUTION_LIMITS.STREAM_COALESCE_MS;

/**
 * Buffers child stdio up to `MAX_OUTPUT_BYTES` per stream, decodes UTF-8 safely across chunk
 * boundaries, and coalesces live chunks (`<= 4 KB` every `50ms`) so tight print loops cannot flood Redis.
 */
class BoundedOutputCollector {
  private readonly buffers: { stdout: Buffer[]; stderr: Buffer[] } = {
    stdout: [],
    stderr: [],
  };
  private readonly byteCounts = { stdout: 0, stderr: 0 };
  private readonly truncated = { stdout: false, stderr: false };
  private readonly pending: { stdout: Buffer[]; stderr: Buffer[] } = {
    stdout: [],
    stderr: [],
  };
  private readonly pendingBytes = { stdout: 0, stderr: 0 };
  private readonly decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8'),
  };
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;

  constructor(
    private readonly onFlush?: (event: {
      stream: 'stdout' | 'stderr';
      seq: number;
      chunk: string;
      truncated: boolean;
      timestamp: number;
    }) => void
  ) {}

  push(stream: 'stdout' | 'stderr', raw: Buffer): void {
    if (raw.byteLength === 0) return;

    const remaining = MAX_BYTES - this.byteCounts[stream];
    if (remaining <= 0) {
      if (!this.truncated[stream]) {
        this.truncated[stream] = true;
      }
      return;
    }

    let slice = raw;
    let justTruncated = false;
    if (raw.byteLength > remaining) {
      slice = raw.subarray(0, remaining);
      this.truncated[stream] = true;
      justTruncated = true;
    }

    this.buffers[stream].push(slice);
    this.byteCounts[stream] += slice.byteLength;

    if (this.onFlush) {
      this.pending[stream].push(slice);
      this.pendingBytes[stream] += slice.byteLength;

      if (this.pendingBytes[stream] >= CHUNK_BYTES || justTruncated) {
        this.flushStream(stream);
      } else if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flushAll();
        }, COALESCE_MS);
      }
    }
  }

  flushAll(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushStream('stdout');
    this.flushStream('stderr');
  }

  finalize(): {
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  } {
    this.flushAll();
    const stdoutTail = this.decoders.stdout.end();
    const stderrTail = this.decoders.stderr.end();
    if (stdoutTail && this.onFlush) {
      this.seq += 1;
      this.onFlush({
        stream: 'stdout',
        seq: this.seq,
        chunk: stdoutTail,
        truncated: this.truncated.stdout,
        timestamp: Date.now(),
      });
    }
    if (stderrTail && this.onFlush) {
      this.seq += 1;
      this.onFlush({
        stream: 'stderr',
        seq: this.seq,
        chunk: stderrTail,
        truncated: this.truncated.stderr,
        timestamp: Date.now(),
      });
    }

    return {
      stdout: Buffer.concat(this.buffers.stdout).toString('utf8'),
      stderr: Buffer.concat(this.buffers.stderr).toString('utf8'),
      stdoutTruncated: this.truncated.stdout,
      stderrTruncated: this.truncated.stderr,
    };
  }

  snapshot(): {
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  } {
    return {
      stdout: Buffer.concat(this.buffers.stdout).toString('utf8'),
      stderr: Buffer.concat(this.buffers.stderr).toString('utf8'),
      stdoutTruncated: this.truncated.stdout,
      stderrTruncated: this.truncated.stderr,
    };
  }

  private flushStream(stream: 'stdout' | 'stderr'): void {
    if (!this.onFlush || this.pendingBytes[stream] === 0) {
      return;
    }

    const combined = Buffer.concat(this.pending[stream]);
    this.pending[stream] = [];
    this.pendingBytes[stream] = 0;

    // Split along `CHUNK_BYTES` UTF-8 safe slices so every Pub/Sub frame stays <= 4 KB
    let offset = 0;
    while (offset < combined.byteLength) {
      const piece = combined.subarray(offset, offset + CHUNK_BYTES);
      offset += piece.byteLength;
      const text = this.decoders[stream].write(piece);
      if (text.length > 0) {
        this.seq += 1;
        this.onFlush({
          stream,
          seq: this.seq,
          chunk: text,
          truncated: this.truncated[stream],
          timestamp: Date.now(),
        });
      }
    }
  }
}

const SECURITY_OPT_VALUE_RE = /^[A-Za-z0-9_./:-]+$/;

const validateSecurityOptValue = (name: string, value: string): string => {
  if (!SECURITY_OPT_VALUE_RE.test(value)) {
    throw new Error(`Invalid Docker security option "${name}": disallowed characters`);
  }
  return value;
};

const measureDirectoryUsage = async (
  dirPath: string,
  maxBytes: number,
  maxFiles: number
): Promise<{ bytes: number; files: number; exceeded: boolean }> => {
  let bytes = 0;
  let files = 0;

  const walk = async (currentDir: string, depth: number): Promise<boolean> => {
    if (depth > 32) return true;
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      files += 1;
      if (files > maxFiles) {
        return true;
      }

      const fullPath = path.join(currentDir, entry.name);
      try {
        const stat = await fs.lstat(fullPath);
        bytes += stat.size;
        if (bytes > maxBytes) {
          return true;
        }
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          const childExceeded = await walk(fullPath, depth + 1);
          if (childExceeded) return true;
        }
      } catch {
        // File vanished mid-compile
      }
    }
    return false;
  };

  const exceeded = await walk(dirPath, 0);
  return { bytes, files, exceeded };
};

const buildHardenedDockerArgs = (params: {
  containerName: string;
  image: string;
  srcDir: string;
  buildDir?: string;
  buildMountMode?: 'rw' | 'ro';
  cpus?: string;
  interactive: boolean;
  commandArgv: string[];
}): string[] => {
  const safeImage = validateRunnerImage(params.image);
  const args: string[] = [
    'run',
    '--rm',
    '--pull=never',
    '--name',
    params.containerName,
    ...(params.interactive ? ['-i'] : []),
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges:true',
    '--user=10001:10001',
    '--pids-limit=64',
    '--memory=256m',
    '--memory-swap=256m',
    `--cpus=${params.cpus ?? '0.5'}`,
    '--ulimit',
    'nofile=64:64',
    '--ulimit',
    'fsize=10485760:10485760',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=64m',
    '-v',
    `${params.srcDir}:/workspace:ro`,
  ];

  if (params.buildDir) {
    args.push('-v', `${params.buildDir}:/build:${params.buildMountMode ?? 'ro'}`);
  }

  const optionalAppArmor = process.env.DOCKER_APPARMOR_PROFILE?.trim();
  if (optionalAppArmor) {
    args.push(
      '--security-opt',
      `apparmor=${validateSecurityOptValue('DOCKER_APPARMOR_PROFILE', optionalAppArmor)}`
    );
  }

  const optionalSeccomp = process.env.DOCKER_SECCOMP_PROFILE?.trim();
  if (optionalSeccomp) {
    args.push(
      '--security-opt',
      `seccomp=${validateSecurityOptValue('DOCKER_SECCOMP_PROFILE', optionalSeccomp)}`
    );
  }

  args.push(safeImage, ...params.commandArgv);
  return args;
};

const forceKillContainer = async (containerName: string): Promise<void> => {
  await new Promise<void>((resolve) => {
    const killer = spawn('docker', ['rm', '-f', containerName], {
      stdio: 'ignore',
    });
    const timer = setTimeout(() => {
      killer.kill('SIGKILL');
      resolve();
    }, 3000);
    killer.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    killer.once('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
};

const spawnContainerPhase = (params: {
  containerName: string;
  dockerArgs: string[];
  timeoutMs: number;
  collector: BoundedOutputCollector;
  initialStdin?: string | null;
  interactive: boolean;
}): {
  promise: Promise<{
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    infraError: string | null;
  }>;
  cancel: () => void;
  writeStdin: (data: string) => boolean;
} => {
  let child: ChildProcessWithoutNullStreams | null = null;
  let timedOut = false;
  let cancelled = false;
  let settled = false;
  let timeoutTimer: NodeJS.Timeout | null = null;
  let stdinClosed = !params.interactive;
  let stdinWritablePaused = false;
  let stdinBytesWritten = 0;

  const triggerKill = () => {
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
    void forceKillContainer(params.containerName);
  };

  const writeStdin = (data: string): boolean => {
    if (
      !params.interactive ||
      stdinClosed ||
      stdinWritablePaused ||
      !child ||
      !child.stdin.writable
    ) {
      return false;
    }
    const byteLen = Buffer.byteLength(data, 'utf8');
    if (stdinBytesWritten + byteLen > EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES) {
      return false;
    }
    stdinBytesWritten += byteLen;
    try {
      const acceptedImmediately = child.stdin.write(data, 'utf8');
      if (!acceptedImmediately) {
        stdinWritablePaused = true;
        child.stdin.once('drain', () => {
          stdinWritablePaused = false;
        });
      }
      return true;
    } catch {
      stdinClosed = true;
      return false;
    }
  };

  const promise = new Promise<{
    exitCode: number | null;
    timedOut: boolean;
    cancelled: boolean;
    infraError: string | null;
  }>((resolve) => {
    try {
      child = spawn('docker', params.dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({
        exitCode: null,
        timedOut: false,
        cancelled: false,
        infraError:
          err instanceof Error ? err.message : 'Failed to launch docker process',
      });
      return;
    }

    child.stdin.on('error', () => {
      // Container exited before consuming stdin (EPIPE / ERR_STREAM_DESTROYED)
      stdinClosed = true;
    });

    if (!params.interactive) {
      child.stdin.end();
    } else if (params.initialStdin && params.initialStdin.length > 0) {
      writeStdin(params.initialStdin);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      params.collector.push('stdout', chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      params.collector.push('stderr', chunk);
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      triggerKill();
    }, params.timeoutMs);

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      stdinClosed = true;
      resolve({
        exitCode: null,
        timedOut,
        cancelled,
        infraError: err.message,
      });
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      stdinClosed = true;

      // Docker daemon uses exit code 125 for runtime failures, or exits non-zero before container
      // startup if the daemon socket is unreachable / image is missing.
      const stderrSnapshot = params.collector.snapshot().stderr;
      const isDaemonFailure =
        code === 125 ||
        ((code === 1 || code === 126 || code === 127) &&
          (stderrSnapshot.includes('failed to connect to the docker API at ') ||
            stderrSnapshot.includes('Cannot connect to the Docker daemon at ') ||
            stderrSnapshot.includes('docker: Error response from daemon:')));

      if (!timedOut && !cancelled && isDaemonFailure) {
        resolve({
          exitCode: code,
          timedOut: false,
          cancelled: false,
          infraError: 'Container runtime failed to start execution environment',
        });
        return;
      }

      resolve({
        exitCode: code,
        timedOut,
        cancelled,
        infraError: null,
      });
    });
  });

  const cancel = () => {
    if (settled || timedOut || cancelled) return;
    cancelled = true;
    stdinClosed = true;
    triggerKill();
  };

  return { promise, cancel, writeStdin };
};

/**
 * Executes a single isolated run inside hardened, disposable Docker containers.
 * Compiled languages split compilation (rw `/build`) from runtime (strict `:ro` everywhere).
 */
export const executeInDockerSandbox = async (
  params: RunExecutionParams
): Promise<ExecutionRunResult> => {
  const runtime = LANGUAGE_RUNTIMES[params.language];
  const entry = resolveSafeEntry(
    params.language,
    params.entryFileName,
    params.sourceCode
  );

  const startedAtMs = Date.now();
  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), `codecollab-run-${params.runId.slice(0, 8)}-`)
  );
  await fs.chmod(tempRoot, 0o700);
  const srcDir = path.join(tempRoot, 'src');
  const buildDir = path.join(tempRoot, 'build');
  const collector = new BoundedOutputCollector(params.onStreamChunk);

  let activeContainerName: string | null = null;
  let cancelledExternally = false;
  let activeCancelFn: (() => void) | null = null;
  let activeWriteStdinFn: ((data: string) => boolean) | null = null;

  params.onSpawned?.({
    writeStdin: (data: string) => activeWriteStdinFn?.(data) ?? false,
    cancel: () => {
      cancelledExternally = true;
      activeCancelFn?.();
    },
    getAccumulatedOutput: () => collector.snapshot(),
  });

  try {
    await fs.mkdir(srcDir, { mode: 0o755 });
    const entryPath = path.join(srcDir, entry.entryFileName);
    await fs.writeFile(entryPath, params.sourceCode, {
      encoding: 'utf8',
      mode: 0o644,
    });
    await fs.chmod(srcDir, 0o755);
    await fs.chmod(entryPath, 0o644);

    if (runtime.compileArgv) {
      await fs.mkdir(buildDir, { mode: 0o777 });
      await fs.chmod(buildDir, 0o777);

      const compileContainerName = `codecollab-compile-${params.runId}`;
      activeContainerName = compileContainerName;

      const compilePhase = spawnContainerPhase({
        containerName: compileContainerName,
        dockerArgs: buildHardenedDockerArgs({
          containerName: compileContainerName,
          image: runtime.image,
          srcDir,
          buildDir,
          buildMountMode: 'rw',
          cpus: '1.0',
          interactive: false,
          commandArgv: runtime.compileArgv(entry),
        }),
        timeoutMs: EXECUTION_LIMITS.COMPILE_TIMEOUT_MS,
        collector,
        interactive: false,
      });

      activeCancelFn = compilePhase.cancel;
      if (cancelledExternally) {
        compilePhase.cancel();
      }

      let buildQuotaExceeded = false;
      let compileDone = false;
      let monitorTimer: NodeJS.Timeout | null = null;

      const scheduleBuildMonitor = () => {
        if (compileDone) return;
        monitorTimer = setTimeout(async () => {
          if (compileDone) return;
          const usage = await measureDirectoryUsage(
            buildDir,
            EXECUTION_LIMITS.MAX_BUILD_DIR_BYTES,
            EXECUTION_LIMITS.MAX_BUILD_DIR_FILES
          );
          if (usage.exceeded) {
            buildQuotaExceeded = true;
            compilePhase.cancel();
            return;
          }
          scheduleBuildMonitor();
        }, 80);
      };
      scheduleBuildMonitor();

      const compileRes = await compilePhase.promise;
      compileDone = true;
      if (monitorTimer) {
        clearTimeout(monitorTimer);
        monitorTimer = null;
      }
      activeCancelFn = null;
      await forceKillContainer(compileContainerName);
      activeContainerName = null;

      if (!buildQuotaExceeded) {
        const finalUsage = await measureDirectoryUsage(
          buildDir,
          EXECUTION_LIMITS.MAX_BUILD_DIR_BYTES,
          EXECUTION_LIMITS.MAX_BUILD_DIR_FILES
        );
        if (finalUsage.exceeded) {
          buildQuotaExceeded = true;
        }
      }

      if (buildQuotaExceeded) {
        const finalOut = collector.finalize();
        return {
          status: 'FAILED',
          exitCode: compileRes.exitCode,
          failureKind: 'COMPILE_ERROR',
          errorMessage: 'Compilation output exceeded sandbox disk/file quota',
          ...finalOut,
          durationMs: Date.now() - startedAtMs,
        };
      }

      if (compileRes.cancelled || cancelledExternally) {
        const finalOut = collector.finalize();
        return {
          status: 'CANCELLED',
          exitCode: compileRes.exitCode,
          failureKind: 'CANCELLED',
          errorMessage: 'Execution cancelled during compilation',
          ...finalOut,
          durationMs: Date.now() - startedAtMs,
        };
      }

      if (compileRes.timedOut) {
        const finalOut = collector.finalize();
        return {
          status: 'TIMEOUT',
          exitCode: compileRes.exitCode,
          failureKind: 'TIMEOUT',
          errorMessage: `Compilation exceeded ${EXECUTION_LIMITS.COMPILE_TIMEOUT_MS}ms time limit`,
          ...finalOut,
          durationMs: Date.now() - startedAtMs,
        };
      }

      if (compileRes.infraError) {
        const finalOut = collector.finalize();
        return {
          status: 'FAILED',
          exitCode: compileRes.exitCode,
          failureKind: 'INFRASTRUCTURE',
          errorMessage: compileRes.infraError,
          ...finalOut,
          durationMs: Date.now() - startedAtMs,
        };
      }

      if (compileRes.exitCode !== 0) {
        const finalOut = collector.finalize();
        return {
          status: 'FAILED',
          exitCode: compileRes.exitCode,
          failureKind: 'COMPILE_ERROR',
          errorMessage: 'Compilation failed',
          ...finalOut,
          durationMs: Date.now() - startedAtMs,
        };
      }

      // Lock compiled artifacts read-only before launching user program runtime
      await fs.chmod(buildDir, 0o555);
    }

    const runContainerName = `codecollab-run-${params.runId}`;
    activeContainerName = runContainerName;
    const effectiveTimeoutMs = Math.min(
      Math.max(500, params.timeoutMs ?? EXECUTION_LIMITS.TIMEOUT_MS),
      EXECUTION_LIMITS.TIMEOUT_MS
    );

    const runPhase = spawnContainerPhase({
      containerName: runContainerName,
      dockerArgs: buildHardenedDockerArgs({
        containerName: runContainerName,
        image: runtime.image,
        srcDir,
        ...(runtime.compileArgv ? { buildDir, buildMountMode: 'ro' as const } : {}),
        interactive: true,
        commandArgv: runtime.runArgv(entry),
      }),
      timeoutMs: effectiveTimeoutMs,
      collector,
      initialStdin: params.initialStdin,
      interactive: true,
    });

    activeCancelFn = runPhase.cancel;
    activeWriteStdinFn = runPhase.writeStdin;
    if (cancelledExternally) {
      runPhase.cancel();
    }

    const runRes = await runPhase.promise;
    activeCancelFn = null;
    activeWriteStdinFn = null;
    await forceKillContainer(runContainerName);
    activeContainerName = null;

    const finalOut = collector.finalize();
    const durationMs = Date.now() - startedAtMs;

    if (runRes.cancelled || cancelledExternally) {
      return {
        status: 'CANCELLED',
        exitCode: runRes.exitCode,
        failureKind: 'CANCELLED',
        errorMessage: 'Execution cancelled by collaborator',
        ...finalOut,
        durationMs,
      };
    }

    if (runRes.timedOut) {
      return {
        status: 'TIMEOUT',
        exitCode: runRes.exitCode,
        failureKind: 'TIMEOUT',
        errorMessage: `Execution exceeded ${effectiveTimeoutMs}ms time limit`,
        ...finalOut,
        durationMs,
      };
    }

    if (runRes.infraError) {
      return {
        status: 'FAILED',
        exitCode: runRes.exitCode,
        failureKind: 'INFRASTRUCTURE',
        errorMessage: runRes.infraError,
        ...finalOut,
        durationMs,
      };
    }

    if (runRes.exitCode !== 0) {
      const oomHint =
        runRes.exitCode === 137
          ? 'Process terminated (signal SIGKILL / possible memory limit exceeded)'
          : `Process exited with non-zero code ${runRes.exitCode ?? 'unknown'}`;
      return {
        status: 'FAILED',
        exitCode: runRes.exitCode,
        failureKind: 'RUNTIME_ERROR',
        errorMessage: oomHint,
        ...finalOut,
        durationMs,
      };
    }

    return {
      status: 'COMPLETED',
      exitCode: 0,
      failureKind: null,
      errorMessage: null,
      ...finalOut,
      durationMs,
    };
  } finally {
    if (activeContainerName) {
      await forceKillContainer(activeContainerName);
    }
    // Restore owner write permission on `buildDir` (locked `0o555` before Phase 2) so `fs.rm` succeeds on Linux
    await fs.chmod(buildDir, 0o755).catch(() => undefined);
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }
};

const CODECOLLAB_CONTAINER_RE =
  /^codecollab-(?:compile|run)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const listDockerContainersByPrefix = async (): Promise<string[]> =>
  new Promise((resolve) => {
    const proc = spawn(
      'docker',
      ['ps', '-a', '--filter', 'name=codecollab-', '--format', '{{.Names}}'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve([]);
    }, 4000);
    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve([]);
        return;
      }
      resolve(
        out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
    proc.once('error', () => {
      clearTimeout(timer);
      resolve([]);
    });
  });

const getContainerCreatedMs = async (name: string): Promise<number | null> =>
  new Promise((resolve) => {
    const proc = spawn(
      'docker',
      ['inspect', '--format', '{{.Created}}', name],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve(null);
    }, 3000);
    proc.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    proc.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve(null);
        return;
      }
      const parsed = Date.parse(out.trim());
      resolve(Number.isFinite(parsed) ? parsed : null);
    });
    proc.once('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

/**
 * Removes orphaned runner containers and stale temporary sandbox directories left behind
 * by an unexpected worker crash or ungraceful restart.
 */
export const reconcileOrphanedDockerResources = async (
  staleRunIds: string[] = []
): Promise<{ removedContainers: number; removedTempDirs: number }> => {
  const staleIdSet = new Set(staleRunIds);
  const stalePrefixes = new Set(staleRunIds.map((id) => id.slice(0, 8)));
  const now = Date.now();
  let removedContainers = 0;
  let removedTempDirs = 0;

  const containerNames = await listDockerContainersByPrefix();
  for (const name of containerNames) {
    const match = CODECOLLAB_CONTAINER_RE.exec(name);
    if (!match) continue;
    const runId = match[1];
    const createdMs = await getContainerCreatedMs(name);
    const isStaleByAge = createdMs === null || now - createdMs > 45_000;
    if (staleIdSet.has(runId) || isStaleByAge) {
      await forceKillContainer(name);
      removedContainers += 1;
    }
  }

  try {
    const tmpRoot = os.tmpdir();
    const entries = await fs.readdir(tmpRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirMatch = /^codecollab-run-([0-9a-f]{8})-/i.exec(entry.name);
      if (!dirMatch) continue;
      const prefix = dirMatch[1];
      const fullPath = path.join(tmpRoot, entry.name);
      const stat = await fs.lstat(fullPath).catch(() => null);
      const isStaleByAge = !stat || now - stat.mtimeMs > 60_000;
      if (stalePrefixes.has(prefix) || isStaleByAge) {
        await fs.chmod(path.join(fullPath, 'build'), 0o755).catch(() => undefined);
        await fs.rm(fullPath, { recursive: true, force: true }).catch(() => undefined);
        removedTempDirs += 1;
      }
    }
  } catch {
    // Best-effort tmp cleanup
  }

  return { removedContainers, removedTempDirs };
};
