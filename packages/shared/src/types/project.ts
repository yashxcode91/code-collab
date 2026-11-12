/**
 * Supported programming languages for Monaco syntax highlighting
 * and Docker sandbox execution.
 */
export type SupportedLanguage =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'cpp'
  | 'java';

/**
 * Access levels for collaborators inside a project workspace.
 */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

/**
 * Tree node variants within a workspace branch.
 */
export type FileNodeType = 'file' | 'folder';

/**
 * Per-file permission overrides and effective runtime capability.
 */
export type FileAccessPermission = 'edit' | 'read_only' | 'denied';

/**
 * Shared guardrails keeping multi-cursor UI rendering and Socket.IO traffic stable.
 */
export const COLLAB_LIMITS = {
  MIN_CONCURRENT_EDITORS: 1,
  DEFAULT_CONCURRENT_EDITORS: 5,
  MAX_CONCURRENT_EDITORS: 10,
  MAX_VISIBLE_CURSORS: 6,
  MAX_HEADER_AVATARS: 4,
  CURSOR_BADGE_IDLE_MS: 2500,
  AWARENESS_THROTTLE_MS: 50,
  MAX_YJS_UPDATE_BYTES: 262_144, // 256 KB max frame payload
  MAX_FILE_CONTENT_CHARS: 500_000,
} as const;

/**
 * Minimal public collaborator identity returned in member lists.
 * Deliberately omits private emails to protect collaborator privacy.
 */
export interface ProjectMemberUser {
  id: string;
  username: string;
  avatarUrl?: string;
}

/**
 * Core project workspace model.
 */
export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  language: SupportedLanguage;
  isPublic: boolean;
  maxConcurrentEditors: number;
  preventSameLineEdit: boolean;
  currentUserRole?: ProjectRole | null;
  memberCount?: number;
  branchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMemberDto {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  user: ProjectMemberUser;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBranchDto {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  parentBranchId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lightweight tree metadata used to render the Explorer sidebar without
 * transferring full file contents for every node upfront.
 */
export interface ProjectFileNodeDto {
  id: string;
  branchId: string;
  parentId: string | null;
  name: string;
  nodeType: FileNodeType;
  version: number;
  lockedById: string | null;
  lockedByUsername: string | null;
  lockedAt: string | null;
  effectivePermission: FileAccessPermission;
  createdAt: string;
  updatedAt: string;
}

/**
 * Full file payload returned when opening a specific file in Monaco Editor.
 */
export interface ProjectFileDetailDto extends ProjectFileNodeDto {
  content: string;
}

export interface ProjectFileAccessDto {
  id: string;
  fileId: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  permission: FileAccessPermission;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailResponse {
  project: Project;
  branches: ProjectBranchDto[];
  members: ProjectMemberDto[];
}

export type BranchMergeResolution = 'take_source' | 'keep_target' | 'custom';

export type BranchMergeChangeStatus = 'added' | 'modified' | 'type_conflict';

export interface BranchMergeFileChangeDto {
  path: string;
  nodeType: FileNodeType;
  status: BranchMergeChangeStatus;
  sourceNodeId: string;
  targetNodeId: string | null;
  sourceContent: string | null;
  targetContent: string | null;
  targetLockedByUsername: string | null;
  blockedByLockOrAcl: boolean;
  blockedReason: string | null;
}

export interface BranchMergePreviewResponse {
  sourceBranch: ProjectBranchDto;
  targetBranch: ProjectBranchDto;
  canMerge: boolean;
  blockedReason: string | null;
  summary: {
    added: number;
    modified: number;
    typeConflicts: number;
    unchanged: number;
    totalChanges: number;
  };
  changes: BranchMergeFileChangeDto[];
}

export interface BranchMergeResultResponse {
  sourceBranch: ProjectBranchDto;
  targetBranch: ProjectBranchDto;
  applied: {
    addedNodes: number;
    updatedFiles: number;
    keptTargetFiles: number;
  };
  deletedSourceBranch: boolean;
}
