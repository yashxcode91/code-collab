import { Request, Response } from 'express';
import type { CreateExecutionRunInput } from '@codecollab/shared';
import {
  broadcastExecutionCancelled,
  broadcastExecutionQueued,
} from '../../realtime/socketServer';
import {
  cancelExecutionRun,
  createExecutionRun,
  getExecutionRunDetail,
  listBranchExecutionRuns,
} from './execution.service';

export const createExecutionRunController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const input = req.body as CreateExecutionRunInput;

  const run = await createExecutionRun({
    projectId,
    branchId,
    userId: req.user!.id,
    input,
  });

  if (run.status === 'QUEUED') {
    void broadcastExecutionQueued(run);
  }

  res.status(201).json({
    success: true,
    data: { run },
  });
};

export const listBranchExecutionRunsController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const limitRaw = req.query.limit;
  const limit =
    typeof limitRaw === 'string' && /^\d+$/.test(limitRaw)
      ? Number(limitRaw)
      : undefined;

  const runs = await listBranchExecutionRuns({
    projectId,
    branchId,
    userId: req.user!.id,
    limit,
  });

  res.json({
    success: true,
    data: { runs },
  });
};

export const getExecutionRunDetailController = async (
  req: Request,
  res: Response
) => {
  const { projectId, runId } = req.params as {
    projectId: string;
    runId: string;
  };

  const run = await getExecutionRunDetail({
    projectId,
    runId,
    userId: req.user!.id,
  });

  res.json({
    success: true,
    data: { run },
  });
};

export const cancelExecutionRunController = async (
  req: Request,
  res: Response
) => {
  const { projectId, runId } = req.params as {
    projectId: string;
    runId: string;
  };

  const { run, cancelledImmediately } = await cancelExecutionRun({
    projectId,
    runId,
    userId: req.user!.id,
  });

  if (cancelledImmediately) {
    broadcastExecutionCancelled(run);
  }

  res.json({
    success: true,
    data: { run },
  });
};
