import type { Request, Response } from 'express';
import { prisma } from '@codecollab/database';
import { AppError } from '../../utils/AppError';
import { assertProjectAccess, assertValidUuid } from '../projects/project.auth';
import { sandboxManager } from './sandboxManager.service';

/**
 * Resolves the target branch for sandbox operations:
 * either the explicitly supplied branchId (validated to belong to this project)
 * or the default branch of the workspace.
 */
async function resolveBranch(
  projectId: string,
  explicitBranchId?: string
): Promise<{ id: string; name: string }> {
  if (explicitBranchId) {
    const branch = await prisma.projectBranch.findFirst({
      where: { id: explicitBranchId, projectId },
      select: { id: true, name: true },
    });
    if (!branch) {
      throw new AppError(404, 'BRANCH_NOT_FOUND', 'Target branch not found in project');
    }
    return branch;
  }

  const defaultBranch = await prisma.projectBranch.findFirst({
    where: { projectId, isDefault: true },
    select: { id: true, name: true },
  });

  if (defaultBranch) {
    return defaultBranch;
  }

  const anyBranch = await prisma.projectBranch.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  if (!anyBranch) {
    throw new AppError(404, 'BRANCH_NOT_FOUND', 'Workspace has no active branches');
  }

  return anyBranch;
}

/**
 * POST /api/projects/:projectId/sandbox/start
 * Starts or re-connects to an isolated Docker sandbox container.
 */
export async function startSandboxController(
  req: Request,
  res: Response
): Promise<void> {
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const userId = req.user!.id;

  await assertProjectAccess(projectId, userId, 'viewer');
  const branch = await resolveBranch(projectId, req.body?.branchId);

  const sandbox = await sandboxManager.startSandbox({
    projectId,
    branchId: branch.id,
    userId,
    primaryPort: req.body?.primaryPort ?? 5173,
  });

  res.status(200).json({
    success: true,
    data: { sandbox },
  });
}

/**
 * POST /api/projects/:projectId/sandbox/stop
 * Halts and removes the sandbox container.
 */
export async function stopSandboxController(
  req: Request,
  res: Response
): Promise<void> {
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const userId = req.user!.id;

  await assertProjectAccess(projectId, userId, 'editor');
  const branch = await resolveBranch(projectId, req.body?.branchId);

  const sandbox = await sandboxManager.stopSandbox(projectId, branch.id);

  res.status(200).json({
    success: true,
    data: { sandbox },
  });
}

/**
 * GET /api/projects/:projectId/sandbox/status
 * Queries live status, ports, and internal routing details.
 */
export async function getSandboxStatusController(
  req: Request,
  res: Response
): Promise<void> {
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const userId = req.user!.id;

  await assertProjectAccess(projectId, userId);
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branch = await resolveBranch(projectId, branchId);

  const sandbox = await sandboxManager.getSandboxStatus(projectId, branch.id);

  res.status(200).json({
    success: true,
    data: { sandbox },
  });
}

/**
 * GET /api/projects/:projectId/sandbox/logs
 * Fetches recent container stdout/stderr log output.
 */
export async function getSandboxLogsController(
  req: Request,
  res: Response
): Promise<void> {
  const projectId = assertValidUuid(req.params.projectId, 'project');
  const userId = req.user!.id;

  await assertProjectAccess(projectId, userId);
  const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const branch = await resolveBranch(projectId, branchId);

  const tail = typeof req.query.tail === 'string' ? parseInt(req.query.tail, 10) : 100;
  const safeTail = isNaN(tail) || tail <= 0 ? 100 : Math.min(tail, 1000);

  const logs = await sandboxManager.getSandboxLogs(projectId, branch.id, safeTail);

  res.status(200).json({
    success: true,
    data: { logs },
  });
}
