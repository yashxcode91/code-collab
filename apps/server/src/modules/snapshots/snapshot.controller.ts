import { Request, Response } from 'express';
import {
  type CreateSnapshotInput,
  ListSnapshotsQuerySchema,
  type RestoreSnapshotInput,
  SnapshotDiffQuerySchema,
} from '@codecollab/shared';
import {
  createBranchSnapshot,
  deleteBranchSnapshot,
  diffBranchSnapshot,
  getBranchSnapshotDetail,
  listBranchSnapshots,
  restoreBranchSnapshot,
} from './snapshot.service';

export const listBranchSnapshotsController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const query = ListSnapshotsQuerySchema.parse(req.query);

  const result = await listBranchSnapshots({
    projectId,
    branchId,
    userId: req.user!.id,
    cursor: query.cursor,
    limit: query.limit,
  });

  res.json({
    success: true,
    data: result,
  });
};

export const createBranchSnapshotController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId } = req.params as {
    projectId: string;
    branchId: string;
  };
  const input = req.body as CreateSnapshotInput;

  const snapshot = await createBranchSnapshot({
    projectId,
    branchId,
    userId: req.user!.id,
    input,
  });

  res.status(201).json({
    success: true,
    data: { snapshot },
  });
};

export const getBranchSnapshotDetailController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId, snapshotId } = req.params as {
    projectId: string;
    branchId: string;
    snapshotId: string;
  };

  const detail = await getBranchSnapshotDetail({
    projectId,
    branchId,
    snapshotId,
    userId: req.user!.id,
  });

  res.json({
    success: true,
    data: detail,
  });
};

export const diffBranchSnapshotController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId, snapshotId } = req.params as {
    projectId: string;
    branchId: string;
    snapshotId: string;
  };
  const query = SnapshotDiffQuerySchema.parse(req.query);

  const diff = await diffBranchSnapshot({
    projectId,
    branchId,
    snapshotId,
    targetSnapshotId: query.targetSnapshotId,
    userId: req.user!.id,
  });

  res.json({
    success: true,
    data: { diff },
  });
};

export const restoreBranchSnapshotController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId, snapshotId } = req.params as {
    projectId: string;
    branchId: string;
    snapshotId: string;
  };
  const input = req.body as RestoreSnapshotInput;

  const result = await restoreBranchSnapshot({
    projectId,
    branchId,
    snapshotId,
    userId: req.user!.id,
    input,
  });

  res.json({
    success: true,
    data: result,
  });
};

export const deleteBranchSnapshotController = async (
  req: Request,
  res: Response
) => {
  const { projectId, branchId, snapshotId } = req.params as {
    projectId: string;
    branchId: string;
    snapshotId: string;
  };

  await deleteBranchSnapshot({
    projectId,
    branchId,
    snapshotId,
    userId: req.user!.id,
  });

  res.json({
    success: true,
    data: { deleted: true },
  });
};
