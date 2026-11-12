import { Worker, type Job } from 'bullmq';
import { prisma, ExecutionStatus as DbExecutionStatus } from '@codecollab/database';
import {
  buildExecutionStdinChannel,
  EXECUTION_EVENTS_CHANNEL,
  EXECUTION_LIMITS,
  EXECUTION_QUEUE_NAME,
  type SupportedLanguage,
  type WorkerExecutionEvent,
  WorkerExecutionEventSchema,
  WorkerStdinMessageSchema,
} from '@codecollab/shared';
import {
  canonicalJsonStringify,
  closeRedisClient,
  createWorkerSubscriber,
  getBullMqConnectionOptions,
  getWorkerPubSubSecret,
  redisPub,
  signWorkerPubSubString,
  verifyWorkerPubSubSignature,
} from './lib/redis';
import {
  executeInDockerSandbox,
  reconcileOrphanedDockerResources,
  type ActiveExecutionHandle,
} from './services/dockerRunner';

export interface ExecutionJobData {
  runId: string;
}

export const buildExecutionCancelChannel = (runId: string): string =>
  `codecollab:execution:cancel:${runId}`;

export const buildExecutionCancelFlagKey = (runId: string): string =>
  `codecollab:execution:cancel-flag:${runId}`;

const publishWorkerEvent = (event: WorkerExecutionEvent): void => {
  const canonicalEvent = WorkerExecutionEventSchema.parse(event);
  const secret = getWorkerPubSubSecret();
  const payload = secret
    ? {
        event: canonicalEvent,
        sig: signWorkerPubSubString(canonicalJsonStringify(canonicalEvent), secret),
      }
    : canonicalEvent;

  void redisPub
    .publish(EXECUTION_EVENTS_CHANNEL, JSON.stringify(payload))
    .catch((err) => {
      console.error('⚠️ [worker] Failed to publish execution event:', err);
    });
};

/**
 * Reconciles execution runs stranded in `RUNNING` state and removes orphaned Docker
 * containers / temporary build directories after an unexpected worker crash or restart.
 */
export const reconcileStaleExecutions = async (
  staleAgeMs = 45_000
): Promise<{ reconciledRuns: number; removedContainers: number; removedTempDirs: number }> => {
  const cutoff = new Date(Date.now() - staleAgeMs);
  const endedAt = new Date();

  const staleRuns = await prisma.executionRun.findMany({
    where: {
      status: DbExecutionStatus.RUNNING,
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, updatedAt: { lt: cutoff } }],
    },
    select: {
      id: true,
      projectId: true,
      branchId: true,
      fileId: true,
      startedAt: true,
    },
  });

  const staleIds = staleRuns.map((r) => r.id);
  let reconciledRuns = 0;

  if (staleIds.length > 0) {
    const updated = await prisma.executionRun.updateMany({
      where: {
        id: { in: staleIds },
        status: DbExecutionStatus.RUNNING,
      },
      data: {
        status: DbExecutionStatus.FAILED,
        failureKind: 'INFRASTRUCTURE',
        errorMessage: 'Execution worker restarted before completion',
        endedAt,
      },
    });
    reconciledRuns = updated.count;

    for (const stale of staleRuns) {
      publishWorkerEvent({
        type: 'failed',
        runId: stale.id,
        projectId: stale.projectId,
        branchId: stale.branchId,
        fileId: stale.fileId,
        status: 'FAILED',
        exitCode: null,
        failureKind: 'INFRASTRUCTURE',
        errorMessage: 'Execution worker restarted before completion',
        durationMs: stale.startedAt
          ? Math.max(0, endedAt.getTime() - stale.startedAt.getTime())
          : null,
        startedAt: stale.startedAt?.toISOString() ?? null,
        endedAt: endedAt.toISOString(),
        stdoutTruncated: false,
        stderrTruncated: false,
        timestamp: Date.now(),
      });
    }
  }

  const orphanStats = await reconcileOrphanedDockerResources(staleIds);
  return {
    reconciledRuns,
    removedContainers: orphanStats.removedContainers,
    removedTempDirs: orphanStats.removedTempDirs,
  };
};

const toDbStatus = (
  status: 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'CANCELLED'
): DbExecutionStatus => {
  switch (status) {
    case 'COMPLETED':
      return DbExecutionStatus.COMPLETED;
    case 'FAILED':
      return DbExecutionStatus.FAILED;
    case 'TIMEOUT':
      return DbExecutionStatus.TIMEOUT;
    case 'CANCELLED':
      return DbExecutionStatus.CANCELLED;
  }
};

/**
 * BullMQ worker processing isolated sandbox executions:
 * - Guards against duplicate / redelivered jobs using atomic DB status transition (`QUEUED` -> `RUNNING`).
 * - Subscribes to live Redis stdin & cancellation channels per active container.
 * - Coalesces stdout/stderr frames (`EXECUTION_LIMITS.STREAM_COALESCE_MS`) and persists final state in PostgreSQL.
 */
export const createExecutionWorker = () => {
  const activeHandles = new Map<string, ActiveExecutionHandle>();
  const activeJobPromises = new Set<Promise<void>>();
  const subClient = createWorkerSubscriber();

  subClient.on('message', (channel, rawMessage) => {
    if (channel.startsWith('codecollab:execution:stdin:')) {
      const runId = channel.slice('codecollab:execution:stdin:'.length);
      const handle = activeHandles.get(runId);
      if (!handle) return;
      try {
        const parsedJson: unknown = JSON.parse(rawMessage);
        const validated = WorkerStdinMessageSchema.safeParse(parsedJson);
        if (!validated.success) return;

        const secret = getWorkerPubSubSecret();
        if (secret) {
          if (
            !validated.data.sig ||
            !verifyWorkerPubSubSignature(
              `${runId}:${validated.data.data}`,
              validated.data.sig,
              secret
            )
          ) {
            return;
          }
        }
        handle.writeStdin(validated.data.data);
      } catch {
        // Ignore malformed stdin control message
      }
      return;
    }

    if (channel.startsWith('codecollab:execution:cancel:')) {
      const runId = channel.slice('codecollab:execution:cancel:'.length);
      const handle = activeHandles.get(runId);
      handle?.cancel();
    }
  });

  const executeClaimedJob = async (job: Job<ExecutionJobData>): Promise<void> => {
    const { runId } = job.data;
    const startedAt = new Date();

    // Atomic conditional claim: prevents duplicate execution on BullMQ at-least-once redelivery
    // and skips runs already cancelled before the worker picked them up.
    const claim = await prisma.executionRun.updateMany({
      where: { id: runId, status: DbExecutionStatus.QUEUED },
      data: { status: DbExecutionStatus.RUNNING, startedAt },
    });

    if (claim.count === 0) {
      return;
    }

    const stdinChannel = buildExecutionStdinChannel(runId);
    const cancelChannel = buildExecutionCancelChannel(runId);
    let subscribed = false;
    let runMeta: {
      id: string;
      projectId: string;
      branchId: string;
      fileId: string | null;
    } | null = null;

    let preSpawnCancelled = false;
    activeHandles.set(runId, {
      writeStdin: () => false,
      cancel: () => {
        preSpawnCancelled = true;
      },
      getAccumulatedOutput: () => ({
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    });

    try {
      const run = await prisma.executionRun.findUnique({
        where: { id: runId },
        select: {
          id: true,
          projectId: true,
          branchId: true,
          fileId: true,
          language: true,
          entryFileName: true,
          sourceCode: true,
          initialStdin: true,
        },
      });

      if (!run) {
        return;
      }

      runMeta = {
        id: run.id,
        projectId: run.projectId,
        branchId: run.branchId,
        fileId: run.fileId,
      };

      await subClient.subscribe(stdinChannel, cancelChannel);
      subscribed = true;

      const cancelFlag = await redisPub
        .get(buildExecutionCancelFlagKey(run.id))
        .catch(() => null);
      if (cancelFlag === '1') {
        preSpawnCancelled = true;
      }

      if (preSpawnCancelled) {
        const endedAt = new Date();
        await prisma.executionRun.updateMany({
          where: { id: run.id, status: DbExecutionStatus.RUNNING },
          data: {
            status: DbExecutionStatus.CANCELLED,
            failureKind: 'CANCELLED',
            errorMessage: 'Execution cancelled before container start',
            durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
            endedAt,
          },
        });
        publishWorkerEvent({
          type: 'cancelled',
          runId: run.id,
          projectId: run.projectId,
          branchId: run.branchId,
          fileId: run.fileId,
          status: 'CANCELLED',
          exitCode: null,
          failureKind: 'CANCELLED',
          errorMessage: 'Execution cancelled before container start',
          durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          stdoutTruncated: false,
          stderrTruncated: false,
          timestamp: Date.now(),
        });
        return;
      }

      publishWorkerEvent({
        type: 'started',
        runId: run.id,
        projectId: run.projectId,
        branchId: run.branchId,
        fileId: run.fileId,
        startedAt: startedAt.toISOString(),
        timestamp: Date.now(),
      });

      const result = await executeInDockerSandbox({
        runId: run.id,
        language: run.language.toLowerCase() as SupportedLanguage,
        entryFileName: run.entryFileName,
        sourceCode: run.sourceCode,
        initialStdin: run.initialStdin,
        onSpawned: (handle) => {
          activeHandles.set(run.id, handle);
          if (preSpawnCancelled) {
            handle.cancel();
          }
        },
        onStreamChunk: ({ stream, seq, chunk, truncated, timestamp }) => {
          publishWorkerEvent({
            type: stream,
            runId: run.id,
            projectId: run.projectId,
            branchId: run.branchId,
            fileId: run.fileId,
            seq,
            chunk,
            truncated,
            timestamp,
          });
        },
      });

      const endedAt = new Date();
      const dbStatus = toDbStatus(result.status);

      await prisma.executionRun.updateMany({
        where: { id: run.id, status: DbExecutionStatus.RUNNING },
        data: {
          status: dbStatus,
          exitCode: result.exitCode,
          failureKind: result.failureKind,
          errorMessage: result.errorMessage,
          stdout: result.stdout,
          stderr: result.stderr,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated,
          durationMs: result.durationMs,
          endedAt,
        },
      });

      const terminalTypeMap = {
        COMPLETED: 'completed',
        FAILED: 'failed',
        TIMEOUT: 'timeout',
        CANCELLED: 'cancelled',
      } as const;

      publishWorkerEvent({
        type: terminalTypeMap[result.status],
        runId: run.id,
        projectId: run.projectId,
        branchId: run.branchId,
        fileId: run.fileId,
        status: result.status,
        exitCode: result.exitCode,
        failureKind: result.failureKind,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        stdoutTruncated: result.stdoutTruncated,
        stderrTruncated: result.stderrTruncated,
        timestamp: Date.now(),
      });
    } catch (err) {
      const endedAt = new Date();
      const errorMessage =
        err instanceof Error
          ? err.message.slice(0, 500)
          : 'Unexpected worker infrastructure failure';

      await prisma.executionRun
        .updateMany({
          where: { id: runId, status: DbExecutionStatus.RUNNING },
          data: {
            status: DbExecutionStatus.FAILED,
            failureKind: 'INFRASTRUCTURE',
            errorMessage,
            endedAt,
          },
        })
        .catch(() => undefined);

      if (runMeta) {
        publishWorkerEvent({
          type: 'failed',
          runId: runMeta.id,
          projectId: runMeta.projectId,
          branchId: runMeta.branchId,
          fileId: runMeta.fileId,
          status: 'FAILED',
          exitCode: null,
          failureKind: 'INFRASTRUCTURE',
          errorMessage,
          durationMs: Date.now() - startedAt.getTime(),
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          stdoutTruncated: false,
          stderrTruncated: false,
          timestamp: Date.now(),
        });
      }
    } finally {
      activeHandles.delete(runId);
      if (subscribed) {
        await subClient
          .unsubscribe(stdinChannel, cancelChannel)
          .catch(() => undefined);
      }
      await redisPub.del(buildExecutionCancelFlagKey(runId)).catch(() => undefined);
    }
  };

  const processExecutionJob = (job: Job<ExecutionJobData>): Promise<void> => {
    const jobPromise = executeClaimedJob(job).finally(() => {
      activeJobPromises.delete(jobPromise);
    });
    activeJobPromises.add(jobPromise);
    return jobPromise;
  };

  const worker = new Worker<ExecutionJobData>(
    EXECUTION_QUEUE_NAME,
    processExecutionJob,
    {
      connection: getBullMqConnectionOptions(),
      concurrency: EXECUTION_LIMITS.MAX_CONCURRENT_PER_WORKER,
      // Keep job lease comfortably above COMPILE_TIMEOUT_MS + TIMEOUT_MS so BullMQ never stalls an active container
      lockDuration: 45_000,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(
      `⚠️ [worker] Job ${job?.id ?? 'unknown'} infrastructure failure:`,
      err.message
    );
  });

  worker.on('error', (err) => {
    console.error('⚠️ [worker] BullMQ worker error:', err.message);
  });

  const shutdown = async (): Promise<void> => {
    for (const handle of activeHandles.values()) {
      handle.cancel();
    }
    await worker.close();
    if (activeJobPromises.size > 0) {
      await Promise.race([
        Promise.allSettled(Array.from(activeJobPromises)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await closeRedisClient(subClient);
    await closeRedisClient(redisPub);
    await prisma.$disconnect();
  };

  return { worker, shutdown };
};
