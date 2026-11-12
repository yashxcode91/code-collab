import type { FileNodeType } from './project';

export const SNAPSHOT_LIMITS = {
  MAX_SNAPSHOTS_PER_BRANCH: 50,
  MAX_TITLE_CHARS: 120,
  MAX_DESCRIPTION_CHARS: 1_000,
  MAX_SNAPSHOT_FILES: 500,
  MAX_SNAPSHOT_TOTAL_BYTES: 10 * 1024 * 1024, // 10 MB aggregate branch text per snapshot
  DEFAULT_PAGE_SIZE: 30,
  MAX_PAGE_SIZE: 100,
  RATE_LIMIT_WINDOW_SEC: 60,
  RATE_LIMIT_MAX_MUTATIONS: 15,
  RATE_LIMIT_MAX_DIFFS: 30,
  RATE_LIMIT_MAX_READS: 60,
} as const;

export interface SnapshotAuthorDto {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface BranchSnapshotSummaryDto {
  id: string;
  projectId: string;
  branchId: string;
  title: string;
  description?: string;
  restoredFromSnapshotId: string | null;
  fileCount: number;
  totalBytes: number;
  createdBy: SnapshotAuthorDto | null;
  createdAt: string;
}

export interface BranchSnapshotFileDto {
  id: string;
  snapshotId: string;
  originalFileId: string | null;
  path: string;
  nodeType: FileNodeType;
  content: string;
  sizeBytes: number;
}

export interface BranchSnapshotDetailDto {
  snapshot: BranchSnapshotSummaryDto;
  files: BranchSnapshotFileDto[];
  redactedCount: number;
}

export type SnapshotDiffStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'type_conflict';

export interface SnapshotFileDiffDto {
  path: string;
  nodeType: FileNodeType;
  status: SnapshotDiffStatus;
  baseContent: string | null;
  targetContent: string | null;
  blockedByLockOrAcl: boolean;
  blockedReason: string | null;
}

export interface SnapshotDiffResponse {
  snapshotId: string;
  targetSnapshotId: string | null;
  baseLabel: string;
  targetLabel: string;
  summary: {
    added: number;
    modified: number;
    deleted: number;
    typeConflicts: number;
    unchanged: number;
    totalChanges: number;
    redactedCount: number;
  };
  changes: SnapshotFileDiffDto[];
}

export interface RestoreSnapshotResultDto {
  restoredSnapshot: BranchSnapshotSummaryDto;
  safetySnapshot: BranchSnapshotSummaryDto | null;
  applied: {
    createdNodes: number;
    updatedFiles: number;
    deletedNodes: number;
  };
}
