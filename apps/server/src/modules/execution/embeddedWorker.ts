import { Worker, type Job } from 'bullmq';
import { prisma, ExecutionStatus as DbExecutionStatus } from '@codecollab/database';
import {
  EXECUTION_EVENTS_CHANNEL,
  EXECUTION_QUEUE_NAME,
  type WorkerExecutionEvent,
} from '@codecollab/shared';
import { getExecutionPubSubSecret, redis, signPubSubString } from '../../lib/redis';

export interface EmbeddedWorkerHandle {
  close: () => Promise<void>;
}

let embeddedWorkerInstance: Worker | null = null;

const publishWorkerEvent = (event: WorkerExecutionEvent): void => {
  const secret = getExecutionPubSubSecret();
  const serialized = JSON.stringify(event);
  const payload = secret
    ? {
        event,
        sig: signPubSubString(serialized, secret),
      }
    : event;

  void redis
    .publish(EXECUTION_EVENTS_CHANNEL, JSON.stringify(payload))
    .catch((err) => {
      console.error('⚠️ [embedded-worker] Failed to publish execution event:', err);
    });
};

export const startEmbeddedWorker = (): EmbeddedWorkerHandle | null => {
  if (process.env.EMBEDDED_WORKER !== 'true') {
    return null;
  }

  const queueName = process.env.EXECUTION_QUEUE_NAME || EXECUTION_QUEUE_NAME;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  console.log(`⚙️  [embedded-worker] Starting embedded BullMQ execution worker on queue "${queueName}"...`);

  embeddedWorkerInstance = new Worker(
    queueName,
    async (job: Job<{ runId: string }>) => {
      const { runId } = job.data;
      const startedAt = new Date();

      const run = await prisma.executionRun.findUnique({
        where: { id: runId },
      });

      if (!run) return;

      await prisma.executionRun.update({
        where: { id: runId },
        data: { status: DbExecutionStatus.RUNNING, startedAt },
      });

      publishWorkerEvent({
        type: 'started',
        runId,
        projectId: run.projectId,
        branchId: run.branchId,
        fileId: run.fileId,
        startedAt: startedAt.toISOString(),
        timestamp: Date.now(),
      });

      // Free tier cloud instances do not run Docker-in-Docker daemons
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();
      const message =
        'Code execution requires a dedicated Docker runner node. On cloud Free Tier (no Docker daemon), container execution is paused. Run locally via Docker Compose for full C++, Python, TS, and Java sandboxed execution.';

      await prisma.executionRun.update({
        where: { id: runId },
        data: {
          status: DbExecutionStatus.FAILED,
          failureKind: 'INFRASTRUCTURE',
          errorMessage: message,
          endedAt,
          durationMs,
        },
      });

      publishWorkerEvent({
        type: 'failed',
        runId,
        projectId: run.projectId,
        branchId: run.branchId,
        fileId: run.fileId,
        status: 'FAILED',
        exitCode: 1,
        failureKind: 'INFRASTRUCTURE',
        errorMessage: message,
        durationMs,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        stdoutTruncated: false,
        stderrTruncated: false,
        timestamp: Date.now(),
      });
    },
    {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
      },
      concurrency: 2,
    }
  );

  embeddedWorkerInstance.on('error', (err) => {
    console.error('⚠️ [embedded-worker] BullMQ worker error:', err.message);
  });

  return {
    close: async () => {
      if (embeddedWorkerInstance) {
        await embeddedWorkerInstance.close();
        embeddedWorkerInstance = null;
      }
    },
  };
};
