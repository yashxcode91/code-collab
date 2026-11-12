import {
  ExecutionStatus as DbExecutionStatus,
  prisma,
} from '@codecollab/database';
import {
  buildFileRoomKey,
  CreateExecutionRunInput,
  EXECUTION_LIMITS,
  ExecutionFailureKind,
  ExecutionRunDetailDto,
  ExecutionRunDto,
  ExecutionStatus,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import { yjsRoomManager } from '../../realtime/yjsRoomManager';
import {
  assertBranchInProject,
  assertFileInBranch,
  assertProjectAccess,
  assertValidUuid,
  toDbLanguage,
  toDtoLanguage,
} from '../projects/project.auth';
import { resolveInheritedOverride } from '../projects/project.service';
import {
  consumeSlidingWindowLimit,
  enqueueExecutionJob,
  markExecutionCancelRequested,
  removeExecutionJob,
} from './execution.queue';

const EXECUTION_USER_SELECT = {
  id: true,
  username: true,
  avatarUrl: true,
} as const;

type ExecutionRowWithUser = {
  id: string;
  projectId: string;
  branchId: string;
  fileId: string | null;
  userId: string;
  language: 'JAVASCRIPT' | 'TYPESCRIPT' | 'PYTHON' | 'CPP' | 'JAVA';
  status: DbExecutionStatus;
  entryFileName: string;
  sourceCode: string;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  exitCode: number | null;
  failureKind: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
  };
};

export const toDtoExecutionStatus = (
  status: DbExecutionStatus
): ExecutionStatus => status;

export const mapExecutionRunDto = (
  row: ExecutionRowWithUser
): ExecutionRunDto => ({
  id: row.id,
  projectId: row.projectId,
  branchId: row.branchId,
  fileId: row.fileId,
  userId: row.userId,
  triggeredBy: {
    id: row.user.id,
    username: row.user.username,
    ...(row.user.avatarUrl ? { avatarUrl: row.user.avatarUrl } : {}),
  },
  language: toDtoLanguage(row.language),
  status: toDtoExecutionStatus(row.status),
  entryFileName: row.entryFileName,
  stdout: row.stdout,
  stderr: row.stderr,
  stdoutTruncated: row.stdoutTruncated,
  stderrTruncated: row.stderrTruncated,
  exitCode: row.exitCode,
  failureKind: (row.failureKind as ExecutionFailureKind | null) ?? null,
  errorMessage: row.errorMessage,
  durationMs: row.durationMs,
  startedAt: row.startedAt ? row.startedAt.toISOString() : null,
  endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export const mapExecutionRunDetailDto = (
  row: ExecutionRowWithUser
): ExecutionRunDetailDto => ({
  ...mapExecutionRunDto(row),
  sourceCode: row.sourceCode,
});

const defaultEntryNameByLanguage = {
  javascript: 'main.js',
  typescript: 'main.ts',
  python: 'main.py',
  cpp: 'main.cpp',
  java: 'Main.java',
} as const;

/**
 * Creates a persistent `ExecutionRun` snapshot, validates owner/editor & file ACLs,
 * enforces per-user sliding-window rate limits, and enqueues `{ runId }` into BullMQ.
 */
export const createExecutionRun = async (params: {
  projectId: string;
  branchId: string;
  userId: string;
  input: CreateExecutionRunInput;
}): Promise<ExecutionRunDetailDto> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validBranchId = assertValidUuid(params.branchId, 'branch');

  // Strict Day 4 rule: Only workspace owner or editor can execute code
  const { role } = await assertProjectAccess(
    validProjectId,
    params.userId,
    'editor'
  );
  const branch = await assertBranchInProject(validProjectId, validBranchId);

  const allowed = await consumeSlidingWindowLimit({
    key: `codecollab:ratelimit:exec:${params.userId}`,
    maxRequests: EXECUTION_LIMITS.RATE_LIMIT_MAX_RUNS,
    windowSec: EXECUTION_LIMITS.RATE_LIMIT_WINDOW_SEC,
  });

  if (!allowed) {
    throw new AppError(
      429,
      'RATE_LIMIT_EXCEEDED',
      `Execution rate limit exceeded (max ${EXECUTION_LIMITS.RATE_LIMIT_MAX_RUNS} runs per ${EXECUTION_LIMITS.RATE_LIMIT_WINDOW_SEC}s)`
    );
  }

  let resolvedFileId: string | null = null;
  let resolvedEntryFileName =
    params.input.entryFileName ??
    defaultEntryNameByLanguage[params.input.language];
  let resolvedSourceCode = params.input.sourceCode;

  if (params.input.fileId) {
    resolvedFileId = assertValidUuid(params.input.fileId, 'file');
    const file = await assertFileInBranch(
      branch.id,
      resolvedFileId,
      params.userId
    );
    if (file.nodeType !== 'FILE') {
      throw new AppError(
        400,
        'INVALID_NODE_TYPE',
        'Folders cannot be executed directly; select a source file'
      );
    }

    let override: 'edit' | 'read_only' | 'denied' | null = null;
    if (role !== 'owner') {
      override = await resolveInheritedOverride(
        branch.id,
        file.id,
        params.userId
      );
      if (override === 'denied') {
        throw new AppError(
          403,
          'FILE_ACCESS_DENIED',
          'You do not have permission to execute this file'
        );
      }
    }

    // Always bind execution metadata to the authoritative file name when anchored to a fileId
    resolvedEntryFileName = file.name;

    await yjsRoomManager.flushRoom(buildFileRoomKey(branch.id, file.id));
    const latestFile = await prisma.projectFile.findUnique({
      where: { id: file.id },
      select: { content: true },
    });
    const persistedContent = latestFile?.content ?? file.content;

    // Prevent editors from spoofing arbitrary source code against read-only files or protected branches
    const isRestrictedReadOnly =
      role !== 'owner' && (override === 'read_only' || branch.isProtected);
    if (isRestrictedReadOnly) {
      if (
        resolvedSourceCode !== undefined &&
        resolvedSourceCode !== persistedContent
      ) {
        if (override === 'read_only') {
          throw new AppError(
            403,
            'FILE_READ_ONLY',
            'Cannot execute modified source against a read-only file'
          );
        }
        throw new AppError(
          403,
          'BRANCH_PROTECTED',
          'Cannot execute modified source against a protected branch file'
        );
      }
      resolvedSourceCode = persistedContent;
    } else if (resolvedSourceCode === undefined) {
      resolvedSourceCode = persistedContent;
    }
  }

  if (resolvedSourceCode === undefined) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Provide either a valid fileId or sourceCode buffer to execute'
    );
  }

  const created = await prisma.executionRun.create({
    data: {
      projectId: validProjectId,
      branchId: branch.id,
      fileId: resolvedFileId,
      userId: params.userId,
      language: toDbLanguage(params.input.language),
      status: DbExecutionStatus.QUEUED,
      entryFileName: resolvedEntryFileName,
      sourceCode: resolvedSourceCode,
      initialStdin: params.input.initialStdin ?? null,
    },
    include: {
      user: { select: EXECUTION_USER_SELECT },
    },
  });

  try {
    await enqueueExecutionJob(created.id);
  } catch (err) {
    const failed = await prisma.executionRun.update({
      where: { id: created.id },
      data: {
        status: DbExecutionStatus.FAILED,
        failureKind: 'INFRASTRUCTURE',
        errorMessage: 'Execution queue temporarily unavailable',
        endedAt: new Date(),
      },
      include: {
        user: { select: EXECUTION_USER_SELECT },
      },
    });
    console.error('⚠️ [execution] Failed to enqueue BullMQ job:', err);
    return mapExecutionRunDetailDto(failed);
  }

  return mapExecutionRunDetailDto(created);
};

/**
 * Lists recent execution runs on a branch for authorized workspace members,
 * hiding any run anchored to a file marked `denied` for that collaborator.
 */
export const listBranchExecutionRuns = async (params: {
  projectId: string;
  branchId: string;
  userId: string;
  limit?: number;
}): Promise<ExecutionRunDto[]> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validBranchId = assertValidUuid(params.branchId, 'branch');

  const { role } = await assertProjectAccess(validProjectId, params.userId);
  if (role === null) {
    throw new AppError(
      403,
      'EXECUTION_FORBIDDEN',
      'Only workspace members can view execution history'
    );
  }

  await assertBranchInProject(validProjectId, validBranchId);

  const rows = await prisma.executionRun.findMany({
    where: {
      projectId: validProjectId,
      branchId: validBranchId,
    },
    include: {
      user: { select: EXECUTION_USER_SELECT },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(1, params.limit ?? 25), 50),
  });

  if (role === 'owner') {
    return rows.map(mapExecutionRunDto);
  }

  const filePermissionCache = new Map<string, boolean>();
  const visibleRows: ExecutionRowWithUser[] = [];

  for (const row of rows) {
    if (!row.fileId) {
      visibleRows.push(row);
      continue;
    }
    let allowed = filePermissionCache.get(row.fileId);
    if (allowed === undefined) {
      const override = await resolveInheritedOverride(
        row.branchId,
        row.fileId,
        params.userId
      );
      allowed = override !== 'denied';
      filePermissionCache.set(row.fileId, allowed);
    }
    if (allowed) {
      visibleRows.push(row);
    }
  }

  return visibleRows.map(mapExecutionRunDto);
};

/**
 * Fetches full details (including source snapshot & bounded stdout/stderr) for reconnects.
 */
export const getExecutionRunDetail = async (params: {
  projectId: string;
  runId: string;
  userId: string;
}): Promise<ExecutionRunDetailDto> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validRunId = assertValidUuid(params.runId, 'run');

  const { role } = await assertProjectAccess(validProjectId, params.userId);
  if (role === null) {
    throw new AppError(
      403,
      'EXECUTION_FORBIDDEN',
      'Only workspace members can inspect execution runs'
    );
  }

  const row = await prisma.executionRun.findUnique({
    where: { id: validRunId },
    include: {
      user: { select: EXECUTION_USER_SELECT },
    },
  });

  if (!row || row.projectId !== validProjectId) {
    throw new AppError(404, 'EXECUTION_NOT_FOUND', 'Execution run not found');
  }

  if (row.fileId && role !== 'owner') {
    const override = await resolveInheritedOverride(
      row.branchId,
      row.fileId,
      params.userId
    );
    if (override === 'denied') {
      throw new AppError(
        403,
        'FILE_ACCESS_DENIED',
        'You do not have permission to inspect this execution run'
      );
    }
  }

  return mapExecutionRunDetailDto(row);
};

/**
 * Cancels a QUEUED or RUNNING execution run.
 * Restricted to Owner or Editor who created the run (or Workspace Owner).
 */
export const cancelExecutionRun = async (params: {
  projectId: string;
  runId: string;
  userId: string;
}): Promise<{ run: ExecutionRunDto; cancelledImmediately: boolean }> => {
  const validProjectId = assertValidUuid(params.projectId, 'project');
  const validRunId = assertValidUuid(params.runId, 'run');

  const { role } = await assertProjectAccess(
    validProjectId,
    params.userId,
    'editor'
  );

  const existing = await prisma.executionRun.findUnique({
    where: { id: validRunId },
    include: {
      user: { select: EXECUTION_USER_SELECT },
    },
  });

  if (!existing || existing.projectId !== validProjectId) {
    throw new AppError(404, 'EXECUTION_NOT_FOUND', 'Execution run not found');
  }

  if (existing.userId !== params.userId && role !== 'owner') {
    throw new AppError(
      403,
      'EXECUTION_FORBIDDEN',
      'Only the run creator or workspace owner can cancel this execution'
    );
  }

  if (existing.status === DbExecutionStatus.QUEUED) {
    await markExecutionCancelRequested(existing.id);
    const updatedCount = await prisma.executionRun.updateMany({
      where: { id: existing.id, status: DbExecutionStatus.QUEUED },
      data: {
        status: DbExecutionStatus.CANCELLED,
        failureKind: 'CANCELLED',
        errorMessage: 'Execution cancelled before container start',
        endedAt: new Date(),
      },
    });

    if (updatedCount.count > 0) {
      await removeExecutionJob(existing.id);
      const refreshed = await prisma.executionRun.findUniqueOrThrow({
        where: { id: existing.id },
        include: { user: { select: EXECUTION_USER_SELECT } },
      });
      return {
        run: mapExecutionRunDto(refreshed),
        cancelledImmediately: true,
      };
    }
  }

  const latest = await prisma.executionRun.findUnique({
    where: { id: validRunId },
    include: { user: { select: EXECUTION_USER_SELECT } },
  });

  if (
    !latest ||
    (latest.status !== DbExecutionStatus.RUNNING &&
      latest.status !== DbExecutionStatus.QUEUED)
  ) {
    throw new AppError(
      409,
      'EXECUTION_NOT_RUNNING',
      'Execution run has already finished'
    );
  }

  await markExecutionCancelRequested(latest.id);
  return {
    run: mapExecutionRunDto(latest),
    cancelledImmediately: false,
  };
};
