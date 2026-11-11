import {
  FileAccessPermission as DbFileAccessPermission,
  FileNodeType as DbFileNodeType,
  Prisma,
  ProjectRole as DbProjectRole,
  SupportedLanguage as DbSupportedLanguage,
  prisma,
} from '@codecollab/database';
import {
  FileAccessPermission,
  FileNodeType,
  ProjectRole,
  SupportedLanguage,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';

// Strict UUID v1-v5 pattern used to reject malformed route params before querying PostgreSQL
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ensures an untrusted route parameter is a valid UUID or throws `400 INVALID_ID`. */
export const assertValidUuid = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
    throw new AppError(400, 'INVALID_ID', `Invalid ${label} ID`);
  }
  return value;
};

// Numeric hierarchy so role checks (`ROLE_RANK[role] < ROLE_RANK[minRole]`) stay clear and extensible
const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

// Enum translation helpers isolate uppercase Prisma DB enums from lowercase @codecollab/shared DTOs

export const toDtoLanguage = (lang: DbSupportedLanguage): SupportedLanguage => {
  switch (lang) {
    case 'JAVASCRIPT':
      return 'javascript';
    case 'TYPESCRIPT':
      return 'typescript';
    case 'PYTHON':
      return 'python';
    case 'CPP':
      return 'cpp';
    case 'JAVA':
      return 'java';
  }
};

export const toDbLanguage = (lang: SupportedLanguage): DbSupportedLanguage => {
  switch (lang) {
    case 'javascript':
      return 'JAVASCRIPT';
    case 'typescript':
      return 'TYPESCRIPT';
    case 'python':
      return 'PYTHON';
    case 'cpp':
      return 'CPP';
    case 'java':
      return 'JAVA';
  }
};

export const toDtoRole = (role: DbProjectRole): ProjectRole => {
  switch (role) {
    case 'OWNER':
      return 'owner';
    case 'EDITOR':
      return 'editor';
    case 'VIEWER':
      return 'viewer';
  }
};

export const toDbRole = (role: ProjectRole): DbProjectRole => {
  switch (role) {
    case 'owner':
      return 'OWNER';
    case 'editor':
      return 'EDITOR';
    case 'viewer':
      return 'VIEWER';
  }
};

export const toDtoNodeType = (nodeType: DbFileNodeType): FileNodeType =>
  nodeType === 'FOLDER' ? 'folder' : 'file';

export const toDbNodeType = (nodeType: FileNodeType): DbFileNodeType =>
  nodeType === 'folder' ? 'FOLDER' : 'FILE';

export const toDtoAccessPermission = (
  perm: DbFileAccessPermission
): FileAccessPermission => {
  switch (perm) {
    case 'EDIT':
      return 'edit';
    case 'READ_ONLY':
      return 'read_only';
    case 'DENIED':
      return 'denied';
  }
};

export const toDbAccessPermission = (
  perm: FileAccessPermission
): DbFileAccessPermission => {
  switch (perm) {
    case 'edit':
      return 'EDIT';
    case 'read_only':
      return 'READ_ONLY';
    case 'denied':
      return 'DENIED';
  }
};

/** Type guard detecting Prisma's P2002 unique-constraint error code. */
export const isPrismaUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

export interface ProjectAuthContext {
  project: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    language: DbSupportedLanguage;
    isPublic: boolean;
    maxConcurrentEditors: number;
    preventSameLineEdit: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  role: ProjectRole | null;
}

/**
 * Verifies project existence and resolves the caller's effective project role.
 * Enforces IDOR isolation: private workspaces reject non-members cleanly.
 */
export const assertProjectAccess = async (
  projectId: string,
  userId: string,
  minRole?: ProjectRole
): Promise<ProjectAuthContext> => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        where: { userId },
        take: 1,
      },
    },
  });

  if (!project) {
    throw new AppError(404, 'PROJECT_NOT_FOUND', 'Workspace not found');
  }

  let role: ProjectRole | null = null;
  if (project.ownerId === userId) {
    role = 'owner';
  } else if (project.members[0]) {
    role = toDtoRole(project.members[0].role);
  }

  if (role === null && !project.isPublic) {
    throw new AppError(
      403,
      'PROJECT_FORBIDDEN',
      'You do not have permission to access this workspace'
    );
  }

  if (minRole && (!role || ROLE_RANK[role] < ROLE_RANK[minRole])) {
    throw new AppError(
      403,
      'INSUFFICIENT_ROLE',
      minRole === 'owner'
        ? 'Only the workspace owner can perform this action'
        : 'Editor permissions are required to modify this workspace'
    );
  }

  return { project, role };
};

/**
 * Verifies branch existence AND strict containment within projectId,
 * preventing cross-project branch parameter spoofing.
 */
export const assertBranchInProject = async (
  projectId: string,
  branchId: string
) => {
  const branch = await prisma.projectBranch.findUnique({
    where: { id: branchId },
  });

  if (!branch || branch.projectId !== projectId) {
    throw new AppError(
      404,
      'BRANCH_NOT_FOUND',
      'Branch not found in this workspace'
    );
  }

  return branch;
};

/**
 * Verifies file/folder existence AND strict containment within branchId.
 */
export const assertFileInBranch = async (
  branchId: string,
  fileId: string,
  userId?: string
) => {
  const file = await prisma.projectFile.findUnique({
    where: { id: fileId },
    include: {
      lockedBy: {
        select: { id: true, username: true },
      },
      ...(userId
        ? {
            accessRules: {
              where: { userId },
              take: 1,
            },
          }
        : {}),
    },
  });

  if (!file || file.branchId !== branchId) {
    throw new AppError(
      404,
      'FILE_NOT_FOUND',
      'File or folder not found on this branch'
    );
  }

  return file;
};

/**
 * Resolves the effective permission of a caller on a specific file/folder node
 * combining per-file ACL overrides, branch protection, file lock, and project role.
 */
export const computeEffectiveFilePermission = (params: {
  role: ProjectRole | null;
  userId: string;
  branchIsProtected: boolean;
  fileLockedById: string | null;
  override?: FileAccessPermission | null;
}): FileAccessPermission => {
  const { role, userId, branchIsProtected, fileLockedById, override } = params;

  // 1. Per-file denial/read-only applies to non-owners immediately
  if (role !== 'owner') {
    if (override === 'denied') {
      return 'denied';
    }
    if (override === 'read_only') {
      return 'read_only';
    }
  }

  // 2. Public visitors and VIEWER members never gain write rights
  if (!role || role === 'viewer') {
    return 'read_only';
  }

  // 3. Protected branch restricts writes solely to project owner
  if (branchIsProtected && role !== 'owner') {
    return 'read_only';
  }

  // 4. Exclusive checkout lock prevents edits from anyone except lock holder
  if (fileLockedById && fileLockedById !== userId) {
    return 'read_only';
  }

  return 'edit';
};

/**
 * Throws a specific `403` AppError explaining *which* layer blocked a write mutation
 * (per-file ACL vs role vs protected branch vs exclusive lock). Mirrors
 * `computeEffectiveFilePermission` precedence so UI capability and API enforcement match.
 */
export const assertCanWriteFileNode = (params: {
  role: ProjectRole | null;
  userId: string;
  branchIsProtected: boolean;
  fileLockedById: string | null;
  lockedByUsername?: string | null;
  override?: FileAccessPermission | null;
}) => {
  const {
    role,
    userId,
    branchIsProtected,
    fileLockedById,
    lockedByUsername,
    override,
  } = params;

  if (role !== 'owner' && override === 'denied') {
    throw new AppError(
      403,
      'FILE_ACCESS_DENIED',
      'You do not have access to this file'
    );
  }

  if (role !== 'owner' && override === 'read_only') {
    throw new AppError(
      403,
      'FILE_READ_ONLY',
      'This file is marked read-only for your account'
    );
  }

  if (!role || ROLE_RANK[role] < ROLE_RANK.editor) {
    throw new AppError(
      403,
      'INSUFFICIENT_ROLE',
      'Editor permissions are required to modify files'
    );
  }

  if (branchIsProtected && role !== 'owner') {
    throw new AppError(
      403,
      'BRANCH_PROTECTED',
      'This branch is protected; create or switch to a feature branch to edit'
    );
  }

  if (fileLockedById && fileLockedById !== userId) {
    throw new AppError(
      403,
      'FILE_LOCKED',
      `File is locked by @${lockedByUsername ?? 'another collaborator'}`
    );
  }
};
