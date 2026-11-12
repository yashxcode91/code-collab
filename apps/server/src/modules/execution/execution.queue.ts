import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import {
  buildExecutionStdinChannel,
  EXECUTION_LIMITS,
  EXECUTION_QUEUE_NAME,
} from '@codecollab/shared';
import {
  getExecutionPubSubSecret,
  redis,
  signPubSubString,
} from '../../lib/redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export interface ExecutionQueueJobPayload {
  runId: string;
}

const getQueueName = (): string => {
  if (process.env.EXECUTION_QUEUE_NAME) {
    return process.env.EXECUTION_QUEUE_NAME;
  }
  return process.env.NODE_ENV === 'test'
    ? `${EXECUTION_QUEUE_NAME}-test`
    : EXECUTION_QUEUE_NAME;
};

let executionQueue: Queue<ExecutionQueueJobPayload> | null = null;

const getExecutionQueue = (): Queue<ExecutionQueueJobPayload> => {
  if (!executionQueue) {
    executionQueue = new Queue<ExecutionQueueJobPayload>(getQueueName(), {
      connection: {
        url: REDIS_URL,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        // Never blindly retry user programs on failures; infra errors are logged distinctly
        attempts: 1,
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    });
    executionQueue.on('error', (err) => {
      console.error('⚠️ [server] BullMQ queue error:', err.message);
    });
  }
  return executionQueue;
};

/**
 * Producer-only enqueue entrypoint. Passes ONLY `{ runId }` through Redis so large
 * source snapshots and user stdin never bloat BullMQ payloads.
 */
export const enqueueExecutionJob = async (runId: string): Promise<void> => {
  const queue = getExecutionQueue();
  await queue.add('execute', { runId }, { jobId: runId });
};

/**
 * Atomic Redis sliding-window rate limiter using a sorted set (`ZREMRANGEBYSCORE` + `ZCARD`).
 * Returns `true` if allowed, `false` if the caller exceeded `maxRequests` within `windowSec`.
 */
export const consumeSlidingWindowLimit = async (params: {
  key: string;
  maxRequests: number;
  windowSec: number;
}): Promise<boolean> => {
  const now = Date.now();
  const windowStart = now - params.windowSec * 1000;
  const member = `${now}:${randomUUID()}`;

  const luaScript = `
    redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
    local count = redis.call('ZCARD', KEYS[1])
    if count >= tonumber(ARGV[3]) then
      return 0
    end
    redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[5]))
    return 1
  `;

  const allowed = await redis.eval(
    luaScript,
    1,
    params.key,
    String(windowStart),
    String(now),
    String(params.maxRequests),
    member,
    String(params.windowSec * 1000)
  );

  return allowed === 1;
};

/**
 * Atomically tracks cumulative UTF-8 stdin bytes sent to a running container
 * against `EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES`.
 */
export const reserveRunStdinBytes = async (
  runId: string,
  additionalBytes: number
): Promise<boolean> => {
  const key = `codecollab:ratelimit:stdin-bytes:${runId}`;
  const luaScript = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local nextVal = current + tonumber(ARGV[1])
    if nextVal > tonumber(ARGV[2]) then
      return 0
    end
    redis.call('SET', KEYS[1], tostring(nextVal), 'EX', tonumber(ARGV[3]))
    return 1
  `;

  const ok = await redis.eval(
    luaScript,
    1,
    key,
    String(additionalBytes),
    String(EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES),
    '300'
  );
  return ok === 1;
};

export const buildExecutionCancelFlagKey = (runId: string): string =>
  `codecollab:execution:cancel-flag:${runId}`;

export const publishExecutionStdin = async (
  runId: string,
  data: string
): Promise<void> => {
  const secret = getExecutionPubSubSecret();
  const payload = secret
    ? { data, sig: signPubSubString(`${runId}:${data}`, secret) }
    : { data };
  await redis.publish(buildExecutionStdinChannel(runId), JSON.stringify(payload));
};

export const publishExecutionCancel = async (runId: string): Promise<void> => {
  await redis.publish(
    `codecollab:execution:cancel:${runId}`,
    JSON.stringify({ runId })
  );
};

export const markExecutionCancelRequested = async (
  runId: string
): Promise<void> => {
  await redis.set(buildExecutionCancelFlagKey(runId), '1', 'EX', 300);
  await publishExecutionCancel(runId);
};

export const removeExecutionJob = async (runId: string): Promise<void> => {
  const queue = getExecutionQueue();
  try {
    await queue.remove(runId);
  } catch {
    // Best-effort cleanup (job may already be active or absent)
  }
};

export const closeExecutionQueue = async (): Promise<void> => {
  if (executionQueue) {
    await executionQueue.close();
    executionQueue = null;
  }
};
