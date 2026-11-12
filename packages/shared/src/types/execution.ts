import type { SupportedLanguage } from './project';

/**
 * Authoritative code execution states matching Prisma `ExecutionStatus`.
 */
export type ExecutionStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMEOUT'
  | 'CANCELLED';

/**
 * Distinguishes user compilation/runtime failures from worker infrastructure errors.
 */
export type ExecutionFailureKind =
  | 'COMPILE_ERROR'
  | 'RUNTIME_ERROR'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'INFRASTRUCTURE';

/**
 * Shared guardrails enforcing memory, timeout, output, stdin, and rate limits
 * across Express API, BullMQ worker, Socket.IO gateway, and Studio UI.
 */
export const EXECUTION_LIMITS = {
  TIMEOUT_MS: 10_000,
  COMPILE_TIMEOUT_MS: 8_000,
  MAX_CONCURRENT_PER_WORKER: 3,
  RATE_LIMIT_MAX_RUNS: 10,
  RATE_LIMIT_WINDOW_SEC: 60,
  MAX_SOURCE_CHARS: 200_000,
  MAX_SOURCE_BYTES: 524_288, // 512 KB UTF-8 byte ceiling
  MAX_BUILD_DIR_BYTES: 33_554_432, // 32 MB aggregate compiler output ceiling
  MAX_BUILD_DIR_FILES: 512, // Max files/inodes written inside /build
  MAX_OUTPUT_BYTES: 65_536, // 64 KB max persisted stdout / stderr
  MAX_STREAM_CHUNK_BYTES: 4_096, // 4 KB live websocket chunk
  STREAM_COALESCE_MS: 50, // Worker output flush interval to prevent Pub/Sub floods
  MAX_STDIN_CHUNK_BYTES: 4_096,
  MAX_STDIN_TOTAL_BYTES: 32_768,
  STDIN_RATE_LIMIT_MAX_CHUNKS: 30,
  STDIN_RATE_LIMIT_WINDOW_SEC: 10,
} as const;

export const EXECUTION_QUEUE_NAME = 'codecollab-execution' as const;
export const EXECUTION_EVENTS_CHANNEL = 'codecollab:execution:events' as const;

export const buildExecutionStdinChannel = (runId: string): string =>
  `codecollab:execution:stdin:${runId}`;

export interface ExecutionUserSummary {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface ExecutionRunDto {
  id: string;
  projectId: string;
  branchId: string;
  fileId: string | null;
  userId: string;
  triggeredBy: ExecutionUserSummary;
  language: SupportedLanguage;
  status: ExecutionStatus;
  entryFileName: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  failureKind: ExecutionFailureKind | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionRunDetailDto extends ExecutionRunDto {
  sourceCode: string;
}

/** Canonical Socket.IO room identifier for streaming live run output and stdin. */
export const buildExecutionRoomKey = (runId: string): string =>
  `execution:${runId}`;

/** Canonical Socket.IO room identifier scoped strictly to authorized workspace members. */
export const buildProjectWorkspaceRoomKey = (projectId: string): string =>
  `project:${projectId}:members`;

/**
 * Strongly typed worker-to-API Redis Pub/Sub events validated by `apps/server`
 * before broadcasting to authorized Socket.IO execution rooms.
 */
export type WorkerExecutionEvent =
  | {
      type: 'started';
      runId: string;
      projectId: string;
      branchId: string;
      fileId: string | null;
      startedAt: string;
      timestamp: number;
    }
  | {
      type: 'stdout' | 'stderr';
      runId: string;
      projectId: string;
      branchId: string;
      fileId: string | null;
      seq: number;
      chunk: string;
      truncated: boolean;
      timestamp: number;
    }
  | {
      type: 'completed' | 'failed' | 'timeout' | 'cancelled';
      runId: string;
      projectId: string;
      branchId: string;
      fileId: string | null;
      status: Exclude<ExecutionStatus, 'QUEUED' | 'RUNNING'>;
      exitCode: number | null;
      failureKind: ExecutionFailureKind | null;
      errorMessage: string | null;
      durationMs: number | null;
      startedAt: string | null;
      endedAt: string;
      stdoutTruncated: boolean;
      stderrTruncated: boolean;
      timestamp: number;
    };
