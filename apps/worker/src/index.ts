import dotenv from 'dotenv';
import path from 'node:path';
import { verifyRunnerImagesAvailable } from './config/runtimes';
import { createExecutionWorker, reconcileStaleExecutions } from './worker';

// Load monorepo root `.env` when running via `pnpm --filter @codecollab/worker dev`
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config();

const bootstrap = async () => {
  const { missing } = await verifyRunnerImagesAvailable();
  if (missing.length > 0) {
    const message = `Missing Docker runner images (${missing.join(', ')}). Run "sh docker/runners/build-all.sh" before starting the worker.`;
    if (process.env.ALLOW_MISSING_RUNNER_IMAGES === 'true') {
      console.warn(`⚠️  ${message}`);
    } else {
      console.error(`❌ ${message}`);
      process.exit(1);
    }
  }

  const recovery = await reconcileStaleExecutions();
  if (
    recovery.reconciledRuns > 0 ||
    recovery.removedContainers > 0 ||
    recovery.removedTempDirs > 0
  ) {
    console.log(
      `🧹 Startup reconciliation cleaned ${recovery.reconciledRuns} stale run(s), ${recovery.removedContainers} orphan container(s), and ${recovery.removedTempDirs} temp dir(s).`
    );
  }

  const { shutdown } = createExecutionWorker();
  console.log('⚙️  CodeCollab Execution Worker listening on queue codecollab-execution');

  let shuttingDown = false;
  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down execution worker cleanly...`);
    try {
      await shutdown();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void handleSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });
};

void bootstrap();
