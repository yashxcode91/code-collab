import {
  FileNodeType as DbFileNodeType,
  Prisma,
  prisma,
} from '@codecollab/database';
import {
  type BranchSnapshotDetailDto,
  type BranchSnapshotFileDto,
  type BranchSnapshotSummaryDto,
  type CreateSnapshotInput,
  type FileAccessPermission,
  type ProjectRole,
  type RestoreSnapshotInput,
  type RestoreSnapshotResultDto,
  SNAPSHOT_LIMITS,
  type SnapshotDiffResponse,
  type SnapshotFileDiffDto,
} from '@codecollab/shared';
import {
  broadcastBranchRestored,
  broadcastRestFileSync,
  broadcastSnapshotCreated,
} from '../../realtime/socketServer';
import { yjsRoomManager } from '../../realtime/yjsRoomManager';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertCanWriteFileNode,
  assertProjectAccess,
  assertValidUuid,
  toDtoAccessPermission,
  toDtoNodeType,
} from '../projects/project.auth';

// =====================================================================
// Internal Helpers & DTO Mappers
// =====================================================================

interface LiveBranchFileRow {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: DbFileNodeType;
  content: string;
  version: number;
  lockedById: string | null;
  lockedBy: { id: string; username: string } | null;
  accessRules: Array<{
    userId: string;
    permission: 'EDIT' | 'READ_ONLY' | 'DENIED';
  }>;
}

interface IndexedLiveNode {
  row: LiveBranchFileRow;
  path: string;
  depth: number;
  overrideForCaller: FileAccessPermission | null;
}

interface IndexedSnapshotFileRow {
  id: string;
  snapshotId: string;
  originalFileId: string | null;
  path: string;
  depth: number;
  nodeType: DbFileNodeType;
  content: string;
  sizeBytes: number;
}

type SnapshotHeaderRow = {
  id: string;
  projectId: string;
  branchId: string;
  title: string;
  description: string | null;
  restoredFromSnapshotId: string | null;
  fileCount: number;
  totalBytes: number;
  createdAt: Date;
  createdBy: {
    id: string;
    username: string;
    avatarUrl: string | null;
  } | null;
};

const SNAPSHOT_HEADER_SELECT = {
  id: true,
  projectId: true,
  branchId: true,
  title: true,
  description: true,
  restoredFromSnapshotId: true,
  fileCount: true,
  totalBytes: true,
  createdAt: true,
  createdBy: {
    select: {
      id: true,
      username: true,
      avatarUrl: true,
    },
  },
} as const;

const LIVE_FILE_SELECT = {
  id: true,
  parentId: true,
  name: true,
  nodeType: true,
  content: true,
  version: true,
  lockedById: true,
  lockedBy: { select: { id: true, username: true } },
  accessRules: { select: { userId: true, permission: true } },
} as const;

const mapSnapshotSummaryDto = (
  row: SnapshotHeaderRow
): BranchSnapshotSummaryDto => ({
  id: row.id,
  projectId: row.projectId,
  branchId: row.branchId,
  title: row.title,
  ...(row.description ? { description: row.description } : {}),
  restoredFromSnapshotId: row.restoredFromSnapshotId,
  fileCount: row.fileCount,
  totalBytes: row.totalBytes,
  createdBy: row.createdBy
    ? {
        id: row.createdBy.id,
        username: row.createdBy.username,
        ...(row.createdBy.avatarUrl
          ? { avatarUrl: row.createdBy.avatarUrl }
          : {}),
      }
    : null,
  createdAt: row.createdAt.toISOString(),
});

const mapSnapshotFileDto = (row: {
  id: string;
  snapshotId: string;
  originalFileId: string | null;
  path: string;
  nodeType: DbFileNodeType;
  content: string;
  sizeBytes: number;
}): BranchSnapshotFileDto => ({
  id: row.id,
  snapshotId: row.snapshotId,
  originalFileId: row.originalFileId,
  path: row.path,
  nodeType: toDtoNodeType(row.nodeType),
  content: row.content,
  sizeBytes: row.sizeBytes,
});

/**
 * Builds normalized POSIX relative paths and inherited per-caller ACL overrides
 * across all files/folders currently on a branch.
 */
const buildLiveBranchPathIndex = (
  rows: LiveBranchFileRow[],
  callerId: string
): {
  entries: IndexedLiveNode[];
  byPath: Map<string, IndexedLiveNode>;
  byId: Map<string, IndexedLiveNode>;
} => {
  const rawById = new Map<string, LiveBranchFileRow>();
  for (const row of rows) {
    rawById.set(row.id, row);
  }

  const entries: IndexedLiveNode[] = [];
  const byPath = new Map<string, IndexedLiveNode>();
  const byId = new Map<string, IndexedLiveNode>();

  for (const row of rows) {
    const segments: string[] = [];
    let cursor: string | null = row.id;
    let steps = 0;

    while (cursor && steps < 100) {
      steps += 1;
      const node = rawById.get(cursor);
      if (!node) break;
      segments.unshift(node.name);
      cursor = node.parentId;
    }

    let aclCursor: string | null = row.id;
    let inheritedReadOnly = false;
    let overrideForCaller: FileAccessPermission | null = null;
    let aclSteps = 0;

    while (aclCursor && aclSteps < 100) {
      aclSteps += 1;
      const node = rawById.get(aclCursor);
      if (!node) break;
      const rule = node.accessRules.find((r) => r.userId === callerId);
      if (rule) {
        const perm = toDtoAccessPermission(rule.permission);
        if (perm === 'denied') {
          overrideForCaller = 'denied';
          break;
        }
        if (perm === 'read_only') {
          inheritedReadOnly = true;
        }
      }
      aclCursor = node.parentId;
    }

    if (overrideForCaller === null && inheritedReadOnly) {
      overrideForCaller = 'read_only';
    }

    const path = segments.join('/');
    const indexed: IndexedLiveNode = {
      row,
      path,
      depth: segments.length,
      overrideForCaller,
    };
    entries.push(indexed);
    byPath.set(path, indexed);
    byId.set(row.id, indexed);
  }

  entries.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  return { entries, byPath, byId };
};

/**
 * Checks whether a historical snapshot path or `originalFileId` maps to any
 * currently `'denied'` node or folder ancestor on the live branch.
 */
const isPathDeniedForCaller = (params: {
  role: ProjectRole | null;
  path: string;
  originalFileId: string | null;
  liveByPath: Map<string, IndexedLiveNode>;
  liveById: Map<string, IndexedLiveNode>;
}): boolean => {
  const { role, path, originalFileId, liveByPath, liveById } = params;
  if (role === 'owner') {
    return false;
  }

  if (originalFileId) {
    const byOrig = liveById.get(originalFileId);
    if (byOrig && byOrig.overrideForCaller === 'denied') {
      return true;
    }
  }

  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    const liveNode = liveByPath.get(prefix);
    if (liveNode && liveNode.overrideForCaller === 'denied') {
      return true;
    }
  }

  return false;
};

/**
 * Resolves the deepest existing folder ancestor on the live branch that would
 * govern creating or modifying a missing node at `path`.
 */
const resolveDeepestLiveAncestor = (
  path: string,
  liveByPath: Map<string, IndexedLiveNode>
): IndexedLiveNode | null => {
  const parts = path.split('/');
  let deepestFolder: IndexedLiveNode | null = null;
  for (let i = 1; i < parts.length; i += 1) {
    const ancestorPath = parts.slice(0, i).join('/');
    const existing = liveByPath.get(ancestorPath);
    if (!existing) break;
    if (existing.row.nodeType === 'FOLDER') {
      deepestFolder = existing;
    }
  }
  return deepestFolder;
};

/**
 * Creates an immutable `BranchSnapshot` + normalized `BranchSnapshotFile` set
 * inside an active Prisma transaction (reused by both manual create and
 * automatic pre-restore safety backups).
 */
const createSnapshotInTx = async (
  tx: Prisma.TransactionClient,
  params: {
    projectId: string;
    branchId: string;
    userId: string;
    title: string;
    description?: string;
    restoredFromSnapshotId?: string | null;
    isSafetyBackup?: boolean;
  }
): Promise<BranchSnapshotSummaryDto> => {
  const existingCount = await tx.branchSnapshot.count({
    where: { branchId: params.branchId },
  });

  const cap = params.isSafetyBackup
    ? SNAPSHOT_LIMITS.MAX_SNAPSHOTS_PER_BRANCH + 5
    : SNAPSHOT_LIMITS.MAX_SNAPSHOTS_PER_BRANCH;

  if (existingCount >= cap) {
    throw new AppError(
      409,
      'SNAPSHOT_LIMIT_REACHED',
      `Branch snapshot limit reached (${SNAPSHOT_LIMITS.MAX_SNAPSHOTS_PER_BRANCH} max). Delete older snapshots to create a new one.`
    );
  }

  const rows = await tx.projectFile.findMany({
    where: { branchId: params.branchId },
    select: LIVE_FILE_SELECT,
  });

  if (rows.length > SNAPSHOT_LIMITS.MAX_SNAPSHOT_FILES) {
    throw new AppError(
      400,
      'SNAPSHOT_TOO_MANY_FILES',
      `Branch has ${rows.length} nodes (max ${SNAPSHOT_LIMITS.MAX_SNAPSHOT_FILES} per snapshot)`
    );
  }

  const liveIndex = buildLiveBranchPathIndex(rows, params.userId);
  let totalBytes = 0;

  const filePayload = liveIndex.entries.map((entry) => {
    const isFile = entry.row.nodeType === 'FILE';
    const content = isFile ? entry.row.content : '';
    const sizeBytes = isFile ? Buffer.byteLength(content, 'utf8') : 0;
    totalBytes += sizeBytes;
    return {
      originalFileId: entry.row.id,
      path: entry.path,
      nodeType: entry.row.nodeType,
      content,
      sizeBytes,
    };
  });

  if (totalBytes > SNAPSHOT_LIMITS.MAX_SNAPSHOT_TOTAL_BYTES) {
    throw new AppError(
      400,
      'SNAPSHOT_TOO_LARGE',
      `Snapshot size exceeds ${Math.round(SNAPSHOT_LIMITS.MAX_SNAPSHOT_TOTAL_BYTES / (1024 * 1024))} MB limit`
    );
  }

  const created = await tx.branchSnapshot.create({
    data: {
      projectId: params.projectId,
      branchId: params.branchId,
      createdById: params.userId,
      title: params.title,
      ...(params.description ? { description: params.description } : {}),
      restoredFromSnapshotId: params.restoredFromSnapshotId ?? null,
      fileCount: filePayload.length,
      totalBytes,
    },
    select: SNAPSHOT_HEADER_SELECT,
  });

  if (filePayload.length > 0) {
    await tx.branchSnapshotFile.createMany({
      data: filePayload.map((f) => ({
        snapshotId: created.id,
        originalFileId: f.originalFileId,
        path: f.path,
        nodeType: f.nodeType,
        content: f.content,
        sizeBytes: f.sizeBytes,
      })),
    });
  }

  return mapSnapshotSummaryDto(created);
};

/** Loads a snapshot verifying strict containment inside `(projectId, branchId)`. */
const assertSnapshotInBranch = async (
  projectId: string,
  branchId: string,
  snapshotId: string
) => {
  const snapshot = await prisma.branchSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      ...SNAPSHOT_HEADER_SELECT,
      files: {
        orderBy: { path: 'asc' },
        select: {
          id: true,
          snapshotId: true,
          originalFileId: true,
          path: true,
          nodeType: true,
          content: true,
          sizeBytes: true,
        },
      },
    },
  });

  if (
    !snapshot ||
    snapshot.projectId !== projectId ||
    snapshot.branchId !== branchId
  ) {
    throw new AppError(
      404,
      'SNAPSHOT_NOT_FOUND',
      'Snapshot not found on this branch'
    );
  }

  return snapshot;
};

// =====================================================================
// Exported Snapshot Service Operations
// =====================================================================

/** Captures an immutable snapshot of a branch after flushing live Yjs rooms. */
export const createBranchSnapshot = async (params: {
  projectId: string;
  branchId: string;
  userId: string;
  input: CreateSnapshotInput;
}): Promise<BranchSnapshotSummaryDto> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');

  await assertProjectAccess(projectId, params.userId, 'editor');
  await assertBranchInProject(projectId, branchId);

  // Persist any active in-memory CRDT edits so the snapshot reflects live editor buffers
  await yjsRoomManager.flushBranchRooms(branchId);

  const summary = await prisma.$transaction((tx) =>
    createSnapshotInTx(tx, {
      projectId,
      branchId,
      userId: params.userId,
      title: params.input.title,
      description: params.input.description,
    })
  );

  broadcastSnapshotCreated({
    projectId,
    branchId,
    snapshot: summary,
  });

  return summary;
};

/** Lists cursor-paginated snapshot history for a branch (`createdAt DESC`). */
export const listBranchSnapshots = async (params: {
  projectId: string;
  branchId: string;
  userId: string;
  cursor?: string;
  limit: number;
}): Promise<{
  snapshots: BranchSnapshotSummaryDto[];
  nextCursor: string | null;
}> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');

  await assertProjectAccess(projectId, params.userId);
  await assertBranchInProject(projectId, branchId);

  let cursorCreatedAt: Date | null = null;
  let cursorId: string | null = null;

  if (params.cursor) {
    const validCursor = assertValidUuid(params.cursor, 'cursor');
    const anchor = await prisma.branchSnapshot.findUnique({
      where: { id: validCursor },
      select: { id: true, branchId: true, createdAt: true },
    });
    if (!anchor || anchor.branchId !== branchId) {
      throw new AppError(404, 'SNAPSHOT_NOT_FOUND', 'Cursor snapshot not found');
    }
    cursorCreatedAt = anchor.createdAt;
    cursorId = anchor.id;
  }

  const rows = await prisma.branchSnapshot.findMany({
    where: {
      projectId,
      branchId,
      ...(cursorCreatedAt && cursorId
        ? {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              {
                AND: [
                  { createdAt: cursorCreatedAt },
                  { id: { lt: cursorId } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: params.limit + 1,
    select: SNAPSHOT_HEADER_SELECT,
  });

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? pageRows[pageRows.length - 1]?.id ?? null : null;

  return {
    snapshots: pageRows.map(mapSnapshotSummaryDto),
    nextCursor,
  };
};

/**
 * Fetches full file listing and contents for a specific snapshot, omitting any
 * nodes governed by a `'denied'` per-file/folder ACL on the live branch.
 */
export const getBranchSnapshotDetail = async (params: {
  projectId: string;
  branchId: string;
  snapshotId: string;
  userId: string;
}): Promise<BranchSnapshotDetailDto> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');
  const snapshotId = assertValidUuid(params.snapshotId, 'snapshot');

  const { role } = await assertProjectAccess(projectId, params.userId);
  await assertBranchInProject(projectId, branchId);

  const [snapshot, liveRows] = await Promise.all([
    assertSnapshotInBranch(projectId, branchId, snapshotId),
    prisma.projectFile.findMany({
      where: { branchId },
      select: LIVE_FILE_SELECT,
    }),
  ]);

  const liveIndex = buildLiveBranchPathIndex(liveRows, params.userId);
  const visibleFiles: BranchSnapshotFileDto[] = [];
  let redactedCount = 0;

  for (const file of snapshot.files) {
    if (
      isPathDeniedForCaller({
        role,
        path: file.path,
        originalFileId: file.originalFileId,
        liveByPath: liveIndex.byPath,
        liveById: liveIndex.byId,
      })
    ) {
      redactedCount += 1;
      continue;
    }
    visibleFiles.push(mapSnapshotFileDto(file));
  }

  return {
    snapshot: mapSnapshotSummaryDto(snapshot),
    files: visibleFiles,
    redactedCount,
  };
};

/**
 * Computes a normalized tree diff comparing `snapshotId` (base/original) against
 * either `targetSnapshotId` or the live branch working tree (target/modified),
 * hiding any `'denied'` ACL paths and flagging lock/ACL restore blockers.
 */
export const diffBranchSnapshot = async (params: {
  projectId: string;
  branchId: string;
  snapshotId: string;
  targetSnapshotId?: string;
  userId: string;
}): Promise<SnapshotDiffResponse> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');
  const snapshotId = assertValidUuid(params.snapshotId, 'snapshot');
  const targetSnapshotId = params.targetSnapshotId
    ? assertValidUuid(params.targetSnapshotId, 'targetSnapshot')
    : undefined;

  if (targetSnapshotId && targetSnapshotId === snapshotId) {
    throw new AppError(
      400,
      'SAME_SNAPSHOT_DIFF',
      'Cannot compare a snapshot against itself'
    );
  }

  const { role } = await assertProjectAccess(projectId, params.userId);
  const branch = await assertBranchInProject(projectId, branchId);

  if (!targetSnapshotId) {
    await yjsRoomManager.flushBranchRooms(branchId);
  }

  const [baseSnapshot, targetSnapshot, liveRows] = await Promise.all([
    assertSnapshotInBranch(projectId, branchId, snapshotId),
    targetSnapshotId
      ? assertSnapshotInBranch(projectId, branchId, targetSnapshotId)
      : Promise.resolve(null),
    prisma.projectFile.findMany({
      where: { branchId },
      select: LIVE_FILE_SELECT,
    }),
  ]);

  const liveIndex = buildLiveBranchPathIndex(liveRows, params.userId);

  type NormalizedNode = {
    path: string;
    originalFileId: string | null;
    nodeType: DbFileNodeType;
    content: string;
    liveNode?: IndexedLiveNode;
  };

  const baseMap = new Map<string, NormalizedNode>();
  for (const f of baseSnapshot.files) {
    baseMap.set(f.path, {
      path: f.path,
      originalFileId: f.originalFileId,
      nodeType: f.nodeType,
      content: f.content,
    });
  }

  const targetMap = new Map<string, NormalizedNode>();
  if (targetSnapshot) {
    for (const f of targetSnapshot.files) {
      targetMap.set(f.path, {
        path: f.path,
        originalFileId: f.originalFileId,
        nodeType: f.nodeType,
        content: f.content,
      });
    }
  } else {
    for (const entry of liveIndex.entries) {
      targetMap.set(entry.path, {
        path: entry.path,
        originalFileId: entry.row.id,
        nodeType: entry.row.nodeType,
        content: entry.row.content,
        liveNode: entry,
      });
    }
  }

  const allPaths = Array.from(
    new Set([...baseMap.keys(), ...targetMap.keys()])
  ).sort((a, b) => a.localeCompare(b));

  const changes: SnapshotFileDiffDto[] = [];
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let typeConflicts = 0;
  let unchanged = 0;
  let redactedCount = 0;

  const evaluateRestoreBlocker = (
    liveNode: IndexedLiveNode | undefined,
    fallbackPath: string
  ): string | null => {
    if (targetSnapshot) return null; // Snapshot-to-snapshot comparison is read-only
    if (!role || role === 'viewer') {
      return 'Editor permissions are required to restore';
    }
    if (branch.isProtected && role !== 'owner') {
      return 'Protected branches can only be restored by the workspace owner';
    }
    const targetNode =
      liveNode ?? resolveDeepestLiveAncestor(fallbackPath, liveIndex.byPath);
    if (!targetNode) return null;

    if (role !== 'owner' && targetNode.overrideForCaller === 'read_only') {
      return `Read-only ACL override on "${targetNode.path}" blocks restore`;
    }
    if (
      targetNode.row.lockedById &&
      targetNode.row.lockedById !== params.userId
    ) {
      return `Locked by @${targetNode.row.lockedBy?.username ?? 'collaborator'}`;
    }
    return null;
  };

  for (const path of allPaths) {
    const baseNode = baseMap.get(path);
    const targetNode = targetMap.get(path);

    const denied =
      isPathDeniedForCaller({
        role,
        path,
        originalFileId:
          targetNode?.originalFileId ?? baseNode?.originalFileId ?? null,
        liveByPath: liveIndex.byPath,
        liveById: liveIndex.byId,
      }) ||
      (baseNode &&
        isPathDeniedForCaller({
          role,
          path,
          originalFileId: baseNode.originalFileId,
          liveByPath: liveIndex.byPath,
          liveById: liveIndex.byId,
        }));

    if (denied) {
      redactedCount += 1;
      continue;
    }

    if (!baseNode && targetNode) {
      added += 1;
      const blockedReason = evaluateRestoreBlocker(targetNode.liveNode, path);
      changes.push({
        path,
        nodeType: toDtoNodeType(targetNode.nodeType),
        status: 'added',
        baseContent: null,
        targetContent: targetNode.nodeType === 'FILE' ? targetNode.content : null,
        blockedByLockOrAcl: Boolean(blockedReason),
        blockedReason,
      });
      continue;
    }

    if (baseNode && !targetNode) {
      deleted += 1;
      const blockedReason = evaluateRestoreBlocker(undefined, path);
      changes.push({
        path,
        nodeType: toDtoNodeType(baseNode.nodeType),
        status: 'deleted',
        baseContent: baseNode.nodeType === 'FILE' ? baseNode.content : null,
        targetContent: null,
        blockedByLockOrAcl: Boolean(blockedReason),
        blockedReason,
      });
      continue;
    }

    if (baseNode && targetNode) {
      if (baseNode.nodeType !== targetNode.nodeType) {
        typeConflicts += 1;
        const blockedReason = evaluateRestoreBlocker(targetNode.liveNode, path);
        changes.push({
          path,
          nodeType: toDtoNodeType(baseNode.nodeType),
          status: 'type_conflict',
          baseContent: baseNode.nodeType === 'FILE' ? baseNode.content : null,
          targetContent:
            targetNode.nodeType === 'FILE' ? targetNode.content : null,
          blockedByLockOrAcl: Boolean(blockedReason),
          blockedReason,
        });
        continue;
      }

      if (baseNode.nodeType === 'FOLDER' || baseNode.content === targetNode.content) {
        unchanged += 1;
        continue;
      }

      modified += 1;
      const blockedReason = evaluateRestoreBlocker(targetNode.liveNode, path);
      changes.push({
        path,
        nodeType: 'file',
        status: 'modified',
        baseContent: baseNode.content,
        targetContent: targetNode.content,
        blockedByLockOrAcl: Boolean(blockedReason),
        blockedReason,
      });
    }
  }

  return {
    snapshotId: baseSnapshot.id,
    targetSnapshotId: targetSnapshot ? targetSnapshot.id : null,
    baseLabel: `Snapshot: ${baseSnapshot.title}`,
    targetLabel: targetSnapshot
      ? `Snapshot: ${targetSnapshot.title}`
      : `Live branch (${branch.name})`,
    summary: {
      added,
      modified,
      deleted,
      typeConflicts,
      unchanged,
      totalChanges: added + modified + deleted + typeConflicts,
      redactedCount,
    },
    changes,
  };
};

/**
 * Atomically restores a branch's file/folder tree to match `snapshotId`, optionally
 * capturing a pre-restore safety backup first, enforcing protected branch / ACL / lock
 * constraints, and pushing Yjs CRDT resync/room-eviction events afterward.
 */
export const restoreBranchSnapshot = async (params: {
  projectId: string;
  branchId: string;
  snapshotId: string;
  userId: string;
  input: RestoreSnapshotInput;
}): Promise<RestoreSnapshotResultDto> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');
  const snapshotId = assertValidUuid(params.snapshotId, 'snapshot');

  const { role } = await assertProjectAccess(projectId, params.userId, 'editor');
  const resolvedRole: ProjectRole = role ?? 'editor';
  const branch = await assertBranchInProject(projectId, branchId);

  if (branch.isProtected && resolvedRole !== 'owner') {
    throw new AppError(
      403,
      'BRANCH_PROTECTED',
      'Only workspace owners can restore snapshots on a protected branch'
    );
  }

  const targetSnapshot = await assertSnapshotInBranch(
    projectId,
    branchId,
    snapshotId
  );

  // Flush dirty in-memory Yjs edits first so any pre-restore safety snapshot captures latest state
  await yjsRoomManager.flushBranchRooms(branchId);

  const actor = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { username: true },
  });
  const actorUsername = actor?.username ?? 'collaborator';

  const syncedFiles: Array<{ id: string; content: string; version: number }> =
    [];
  const deletedFileIds: string[] = [];
  let createdNodes = 0;
  let updatedFiles = 0;
  let deletedNodes = 0;
  let safetySnapshot: BranchSnapshotSummaryDto | null = null;

  await prisma.$transaction(async (tx) => {
    const snap = await tx.branchSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true,
        projectId: true,
        branchId: true,
        files: {
          orderBy: { path: 'asc' },
          select: {
            id: true,
            snapshotId: true,
            originalFileId: true,
            path: true,
            nodeType: true,
            content: true,
            sizeBytes: true,
          },
        },
      },
    });

    if (!snap || snap.projectId !== projectId || snap.branchId !== branchId) {
      throw new AppError(
        404,
        'SNAPSHOT_NOT_FOUND',
        'Snapshot not found on this branch'
      );
    }

    if (params.input.createSafetySnapshot) {
      const autoTitle =
        params.input.safetySnapshotTitle ??
        `Auto-backup before restoring "${targetSnapshot.title}"`.slice(
          0,
          SNAPSHOT_LIMITS.MAX_TITLE_CHARS
        );
      safetySnapshot = await createSnapshotInTx(tx, {
        projectId,
        branchId,
        userId: params.userId,
        title: autoTitle,
        restoredFromSnapshotId: snap.id,
        isSafetyBackup: true,
      });
    }

    const liveRows = await tx.projectFile.findMany({
      where: { branchId },
      select: LIVE_FILE_SELECT,
    });
    const liveIndex = buildLiveBranchPathIndex(liveRows, params.userId);

    const sortedSnapFiles: IndexedSnapshotFileRow[] = snap.files
      .map((f) => ({
        ...f,
        depth: f.path.split('/').length,
      }))
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));

    const snapByPath = new Map<string, IndexedSnapshotFileRow>();
    for (const f of sortedSnapFiles) {
      snapByPath.set(f.path, f);
    }

    // Determine nodes to remove (absent in snapshot, OR different nodeType)
    const removedNodes: IndexedLiveNode[] = [];
    const removedIds = new Set<string>();

    for (const liveEntry of liveIndex.entries) {
      const snapMatch = snapByPath.get(liveEntry.path);
      if (!snapMatch || snapMatch.nodeType !== liveEntry.row.nodeType) {
        removedNodes.push(liveEntry);
        removedIds.add(liveEntry.row.id);
      }
    }

    // Security & concurrency pre-flight on every affected node
    for (const removed of removedNodes) {
      assertCanWriteFileNode({
        role: resolvedRole,
        userId: params.userId,
        branchIsProtected: branch.isProtected,
        fileLockedById: removed.row.lockedById,
        lockedByUsername: removed.row.lockedBy?.username,
        override: removed.overrideForCaller,
      });
      if (removed.row.nodeType === 'FILE') {
        deletedFileIds.push(removed.row.id);
      }
      deletedNodes += 1;
    }

    for (const snapFile of sortedSnapFiles) {
      const liveEntry = liveIndex.byPath.get(snapFile.path);
      if (liveEntry && !removedIds.has(liveEntry.row.id)) {
        if (
          snapFile.nodeType === 'FILE' &&
          liveEntry.row.content !== snapFile.content
        ) {
          assertCanWriteFileNode({
            role: resolvedRole,
            userId: params.userId,
            branchIsProtected: branch.isProtected,
            fileLockedById: liveEntry.row.lockedById,
            lockedByUsername: liveEntry.row.lockedBy?.username,
            override: liveEntry.overrideForCaller,
          });
        }
      } else {
        const ancestor = resolveDeepestLiveAncestor(
          snapFile.path,
          liveIndex.byPath
        );
        if (ancestor && !removedIds.has(ancestor.row.id)) {
          assertCanWriteFileNode({
            role: resolvedRole,
            userId: params.userId,
            branchIsProtected: branch.isProtected,
            fileLockedById: ancestor.row.lockedById,
            lockedByUsername: ancestor.row.lockedBy?.username,
            override: ancestor.overrideForCaller,
          });
        }
      }
    }

    // 1. Delete removed top-most nodes (child descendants cascade in PostgreSQL)
    const deleteRootIds = removedNodes
      .filter((n) => !n.row.parentId || !removedIds.has(n.row.parentId))
      .map((n) => n.row.id);

    if (deleteRootIds.length > 0) {
      await tx.projectFile.deleteMany({
        where: { id: { in: deleteRootIds } },
      });
    }

    // 2. Track kept node IDs and apply updates / recreations top-down
    const activeIdByPath = new Map<string, string>();
    for (const liveEntry of liveIndex.entries) {
      if (!removedIds.has(liveEntry.row.id)) {
        activeIdByPath.set(liveEntry.path, liveEntry.row.id);
      }
    }

    for (const snapFile of sortedSnapFiles) {
      const existingId = activeIdByPath.get(snapFile.path);
      if (existingId) {
        const liveEntry = liveIndex.byId.get(existingId);
        if (
          snapFile.nodeType === 'FILE' &&
          liveEntry &&
          liveEntry.row.content !== snapFile.content
        ) {
          const updated = await tx.projectFile.update({
            where: { id: existingId },
            data: {
              content: snapFile.content,
              yjsState: null,
              version: { increment: 1 },
            },
          });
          updatedFiles += 1;
          syncedFiles.push({
            id: updated.id,
            content: updated.content,
            version: updated.version,
          });
        }
        continue;
      }

      const parts = snapFile.path.split('/');
      const name = parts[parts.length - 1] ?? snapFile.path;
      const parentPath = parts.slice(0, -1).join('/');
      const parentId = parentPath ? activeIdByPath.get(parentPath) ?? null : null;

      const created = await tx.projectFile.create({
        data: {
          branchId,
          parentId,
          parentKey: parentId ?? 'ROOT',
          name,
          nodeType: snapFile.nodeType,
          content: snapFile.nodeType === 'FILE' ? snapFile.content : '',
          version: 1,
        },
      });
      activeIdByPath.set(snapFile.path, created.id);
      createdNodes += 1;
    }
  });

  // 3. Synchronize or evict active in-memory Yjs rooms & notify live collaborators
  if (deletedFileIds.length > 0) {
    yjsRoomManager.destroyRoomsByFileIds(branchId, deletedFileIds);
  }

  for (const synced of syncedFiles) {
    const delta = yjsRoomManager.syncFileContentFromRest(
      branchId,
      synced.id,
      synced.content,
      synced.version
    );
    broadcastRestFileSync({
      branchId,
      fileId: synced.id,
      delta,
      senderId: 'system:snapshot-restore',
    });
  }

  if (safetySnapshot) {
    broadcastSnapshotCreated({
      projectId,
      branchId,
      snapshot: safetySnapshot,
    });
  }

  await broadcastBranchRestored({
    projectId,
    branchId,
    restoredSnapshotId: targetSnapshot.id,
    restoredSnapshotTitle: targetSnapshot.title,
    restoredByUserId: params.userId,
    restoredByUsername: actorUsername,
    safetySnapshotId: (safetySnapshot as BranchSnapshotSummaryDto | null)?.id ?? null,
    deletedFileIds,
    restoredAt: new Date().toISOString(),
  });

  return {
    restoredSnapshot: mapSnapshotSummaryDto(targetSnapshot),
    safetySnapshot,
    applied: {
      createdNodes,
      updatedFiles,
      deletedNodes,
    },
  };
};

/**
 * Deletes an older snapshot. Allowed only for the workspace owner or the
 * snapshot creator (when not on a protected branch).
 */
export const deleteBranchSnapshot = async (params: {
  projectId: string;
  branchId: string;
  snapshotId: string;
  userId: string;
}): Promise<void> => {
  const projectId = assertValidUuid(params.projectId, 'project');
  const branchId = assertValidUuid(params.branchId, 'branch');
  const snapshotId = assertValidUuid(params.snapshotId, 'snapshot');

  const { role } = await assertProjectAccess(projectId, params.userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);

  if (branch.isProtected && role !== 'owner') {
    throw new AppError(
      403,
      'BRANCH_PROTECTED',
      'Only workspace owners can delete snapshots on a protected branch'
    );
  }

  const snapshot = await prisma.branchSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      projectId: true,
      branchId: true,
      createdById: true,
    },
  });

  if (
    !snapshot ||
    snapshot.projectId !== projectId ||
    snapshot.branchId !== branchId
  ) {
    throw new AppError(
      404,
      'SNAPSHOT_NOT_FOUND',
      'Snapshot not found on this branch'
    );
  }

  if (role !== 'owner' && snapshot.createdById !== params.userId) {
    throw new AppError(
      403,
      'INSUFFICIENT_ROLE',
      'Only the workspace owner or snapshot creator can delete this snapshot'
    );
  }

  await prisma.branchSnapshot.delete({ where: { id: snapshot.id } });
};
