import crypto from 'node:crypto';
import { prisma } from '@codecollab/database';
import {
  AddProjectMemberInput,
  CreateBranchInput,
  CreateFileNodeInput,
  CreateProjectInput,
  FileAccessPermission,
  Project,
  ProjectBranchDto,
  ProjectDetailResponse,
  ProjectFileAccessDto,
  ProjectFileDetailDto,
  ProjectFileNodeDto,
  ProjectMemberDto,
  ProjectRole,
  SetFileAccessInput,
  UpdateBranchInput,
  UpdateFileNodeInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput,
} from '@codecollab/shared';
import { AppError } from '../../utils/AppError';
import {
  assertBranchInProject,
  assertCanWriteFileNode,
  assertFileInBranch,
  assertProjectAccess,
  computeEffectiveFilePermission,
  isPrismaUniqueViolation,
  toDbAccessPermission,
  toDbLanguage,
  toDbNodeType,
  toDbRole,
  toDtoAccessPermission,
  toDtoLanguage,
  toDtoNodeType,
  toDtoRole,
} from './project.auth';
import { buildStarterWorkspaceNodes } from './project.templates';
import { yjsRoomManager } from '../../realtime/yjsRoomManager';

// =====================================================================
// DTO Mappers (DB Rows -> Safe @codecollab/shared Wire Payloads)
// =====================================================================

/** Converts a Prisma Project row into the public API Project DTO. */
const mapProjectDto = (
  row: {
    id: string;
    name: string;
    description: string | null;
    ownerId: string;
    language: 'JAVASCRIPT' | 'TYPESCRIPT' | 'PYTHON' | 'CPP' | 'JAVA';
    isPublic: boolean;
    maxConcurrentEditors: number;
    preventSameLineEdit: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count?: { members: number; branches: number };
  },
  currentUserRole?: ProjectRole | null
): Project => ({
  id: row.id,
  name: row.name,
  ...(row.description ? { description: row.description } : {}),
  ownerId: row.ownerId,
  language: toDtoLanguage(row.language),
  isPublic: row.isPublic,
  maxConcurrentEditors: row.maxConcurrentEditors,
  preventSameLineEdit: row.preventSameLineEdit,
  ...(currentUserRole !== undefined ? { currentUserRole } : {}),
  ...(row._count
    ? {
        memberCount: row._count.members,
        branchCount: row._count.branches,
      }
    : {}),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Converts a Prisma ProjectBranch row into a ProjectBranchDto. */
const mapBranchDto = (row: {
  id: string;
  projectId: string;
  name: string;
  isDefault: boolean;
  isProtected: boolean;
  parentBranchId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectBranchDto => ({
  id: row.id,
  projectId: row.projectId,
  name: row.name,
  isDefault: row.isDefault,
  isProtected: row.isProtected,
  parentBranchId: row.parentBranchId,
  createdById: row.createdById,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Converts a Prisma ProjectMember row into a ProjectMemberDto.
 * Note: upstream queries only select { id, username, avatarUrl } so collaborator emails stay private.
 */
const mapMemberDto = (row: {
  id: string;
  projectId: string;
  userId: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; username: string; avatarUrl: string | null };
}): ProjectMemberDto => ({
  id: row.id,
  projectId: row.projectId,
  userId: row.userId,
  role: toDtoRole(row.role),
  user: {
    id: row.user.id,
    username: row.user.username,
    ...(row.user.avatarUrl ? { avatarUrl: row.user.avatarUrl } : {}),
  },
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Converts a Prisma ProjectFile row into a lightweight sidebar node DTO
 * (omitting full file content and binary yjsState) with computed permissions.
 */
const mapFileNodeDto = (
  row: {
    id: string;
    branchId: string;
    parentId: string | null;
    name: string;
    nodeType: 'FILE' | 'FOLDER';
    version: number;
    lockedById: string | null;
    lockedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lockedBy: { id: string; username: string } | null;
  },
  effectivePermission: FileAccessPermission
): ProjectFileNodeDto => ({
  id: row.id,
  branchId: row.branchId,
  parentId: row.parentId,
  name: row.name,
  nodeType: toDtoNodeType(row.nodeType),
  version: row.version,
  lockedById: row.lockedById,
  lockedByUsername: row.lockedBy?.username ?? null,
  lockedAt: row.lockedAt ? row.lockedAt.toISOString() : null,
  effectivePermission,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Walks upward from `nodeId` through all ancestor folders to resolve inherited
 * per-user ACL overrides, so restricting a parent folder cannot be bypassed by
 * requesting a nested file ID directly.
 *
 * Precedence during the walk: 'denied' short-circuits immediately; 'read_only'
 * is remembered while continuing upward in case a higher folder is 'denied'.
 */
export const resolveInheritedOverride = async (
  branchId: string,
  nodeId: string | null,
  userId: string
): Promise<FileAccessPermission | null> => {
  if (!nodeId) {
    return null;
  }

  // Load lightweight parent links + this user's rules for the branch once, then traverse in O(depth)
  const branchNodes = await prisma.projectFile.findMany({
    where: { branchId },
    select: {
      id: true,
      parentId: true,
      accessRules: {
        where: { userId },
        take: 1,
      },
    },
  });

  const nodeMap = new Map(branchNodes.map((n) => [n.id, n]));
  let cursor: string | null = nodeId;
  let inheritedReadOnly = false;
  let steps = 0;

  // Bounded loop protects against infinite traversal if corrupted data ever formed a cycle
  while (cursor && steps < 100) {
    steps += 1;
    const current = nodeMap.get(cursor);
    if (!current) {
      break;
    }
    const rule = current.accessRules[0];
    if (rule) {
      const perm = toDtoAccessPermission(rule.permission);
      if (perm === 'denied') {
        return 'denied';
      }
      if (perm === 'read_only') {
        inheritedReadOnly = true;
      }
    }
    cursor = current.parentId;
  }

  return inheritedReadOnly ? 'read_only' : null;
};

// =====================================================================
// Projects
// =====================================================================

/**
 * Lists all workspaces owned by or shared with the authenticated user,
 * ordered by most recently updated, along with collaborator/branch counts.
 */
export const listUserProjects = async (userId: string): Promise<Project[]> => {
  const rows = await prisma.project.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: {
      members: {
        where: { userId },
        take: 1,
      },
      _count: {
        select: { members: true, branches: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return rows.map((row) => {
    const currentUserRole: ProjectRole =
      row.ownerId === userId
        ? 'owner'
        : row.members[0]
          ? toDtoRole(row.members[0].role)
          : 'viewer';
    return mapProjectDto(row, currentUserRole);
  });
};

/**
 * Atomically provisions a new workspace with:
 * - Project settings & cursor/editing guardrails
 * - Owner membership row
 * - Default `main` branch
 * - Language-specific starter files (`README.md`, `src/`, entry file)
 */
export const createProject = async (
  userId: string,
  input: CreateProjectInput
): Promise<ProjectDetailResponse> => {
  const starterSpecs = buildStarterWorkspaceNodes(input.name, input.language);

  // Single DB transaction ensures we never create a workspace missing its main branch or owner row
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        description: input.description || null,
        ownerId: userId,
        language: toDbLanguage(input.language),
        isPublic: input.isPublic,
        maxConcurrentEditors: input.maxConcurrentEditors,
        preventSameLineEdit: input.preventSameLineEdit,
      },
    });

    const ownerMember = await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        role: 'OWNER',
      },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });

    const mainBranch = await tx.projectBranch.create({
      data: {
        projectId: project.id,
        name: 'main',
        isDefault: true,
        isProtected: false,
        createdById: userId,
      },
    });

    // Pre-mint UUIDs so nested starter files can reference their parent folder's real UUID
    const keyToId = new Map<string, string>();
    for (const spec of starterSpecs) {
      keyToId.set(spec.key, crypto.randomUUID());
    }

    const rootSpecs = starterSpecs.filter((s) => !s.parentKey);
    const childSpecs = starterSpecs.filter((s) => Boolean(s.parentKey));

    // Insert root nodes first (`parentKey: 'ROOT'` enforces unique root filenames in Postgres)
    if (rootSpecs.length > 0) {
      await tx.projectFile.createMany({
        data: rootSpecs.map((spec) => ({
          id: keyToId.get(spec.key)!,
          branchId: mainBranch.id,
          parentId: null,
          parentKey: 'ROOT',
          name: spec.name,
          nodeType: spec.nodeType,
          content: spec.content,
        })),
      });
    }

    // Insert nested child nodes second so the self-referencing parentId FK is already satisfied
    if (childSpecs.length > 0) {
      await tx.projectFile.createMany({
        data: childSpecs.map((spec) => {
          const parentId = keyToId.get(spec.parentKey!)!;
          return {
            id: keyToId.get(spec.key)!,
            branchId: mainBranch.id,
            parentId,
            parentKey: parentId,
            name: spec.name,
            nodeType: spec.nodeType,
            content: spec.content,
          };
        }),
      });
    }

    return {
      project: mapProjectDto(
        { ...project, _count: { members: 1, branches: 1 } },
        'owner'
      ),
      branches: [mapBranchDto(mainBranch)],
      members: [mapMemberDto(ownerMember)],
    };
  });
};

/**
 * Returns full metadata, branches, and collaborator roster for a workspace.
 * Enforces IDOR checks (`assertProjectAccess`) and runs branch/member queries in parallel.
 */
export const getProjectDetail = async (
  projectId: string,
  userId: string
): Promise<ProjectDetailResponse> => {
  const { project, role } = await assertProjectAccess(projectId, userId);

  const [branches, members] = await Promise.all([
    prisma.projectBranch.findMany({
      where: { projectId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    }),
    prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

  return {
    project: mapProjectDto(
      {
        ...project,
        _count: { members: members.length, branches: branches.length },
      },
      role
    ),
    branches: branches.map(mapBranchDto),
    members: members.map(mapMemberDto),
  };
};

/** Updates workspace settings (visibility, concurrent cursor cap, same-line lock). Owner-only. */
export const updateProject = async (
  projectId: string,
  userId: string,
  input: UpdateProjectInput
): Promise<Project> => {
  await assertProjectAccess(projectId, userId, 'owner');

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description ? input.description : null }
        : {}),
      ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
      ...(input.maxConcurrentEditors !== undefined
        ? { maxConcurrentEditors: input.maxConcurrentEditors }
        : {}),
      ...(input.preventSameLineEdit !== undefined
        ? { preventSameLineEdit: input.preventSameLineEdit }
        : {}),
    },
    include: {
      _count: { select: { members: true, branches: true } },
    },
  });

  return mapProjectDto(updated, 'owner');
};

/** Permanently deletes a workspace and cascades to branches, files, and memberships. Owner-only. */
export const deleteProject = async (
  projectId: string,
  userId: string
): Promise<void> => {
  await assertProjectAccess(projectId, userId, 'owner');
  await prisma.project.delete({ where: { id: projectId } });
};

// =====================================================================
// Collaborators / Members
// =====================================================================

/**
 * Adds a registered collaborator by email or username with an assignable role (`editor` | `viewer`).
 * Owner-only; rejects reassigning the owner and converts unique conflicts into `409 MEMBER_EXISTS`.
 */
export const addProjectMember = async (
  projectId: string,
  userId: string,
  input: AddProjectMemberInput
): Promise<ProjectMemberDto> => {
  const { project } = await assertProjectAccess(projectId, userId, 'owner');

  // Route email vs username lookup based on `@` presence
  const targetUser = input.identifier.includes('@')
    ? await prisma.user.findUnique({ where: { email: input.identifier } })
    : await prisma.user.findUnique({ where: { username: input.identifier } });

  if (!targetUser) {
    throw new AppError(
      404,
      'USER_NOT_FOUND',
      'No registered user matched that email or username'
    );
  }

  if (targetUser.id === project.ownerId) {
    throw new AppError(
      400,
      'CANNOT_MODIFY_OWNER',
      'Workspace owner membership cannot be reassigned'
    );
  }

  try {
    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId: targetUser.id,
        role: toDbRole(input.role),
      },
      include: {
        user: { select: { id: true, username: true, avatarUrl: true } },
      },
    });
    return mapMemberDto(member);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new AppError(
        409,
        'MEMBER_EXISTS',
        'This user is already a collaborator on the workspace'
      );
    }
    throw err;
  }
};

/** Changes an existing collaborator's workspace role (`editor` <-> `viewer`). Owner-only. */
export const updateProjectMemberRole = async (
  projectId: string,
  targetUserId: string,
  callerId: string,
  input: UpdateProjectMemberRoleInput
): Promise<ProjectMemberDto> => {
  const { project } = await assertProjectAccess(projectId, callerId, 'owner');

  if (targetUserId === project.ownerId) {
    throw new AppError(
      400,
      'CANNOT_MODIFY_OWNER',
      'Cannot change the workspace owner role'
    );
  }

  const existing = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: targetUserId },
    },
  });

  if (!existing) {
    throw new AppError(404, 'MEMBER_NOT_FOUND', 'Collaborator not found');
  }

  const updated = await prisma.projectMember.update({
    where: { id: existing.id },
    data: { role: toDbRole(input.role) },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
    },
  });

  return mapMemberDto(updated);
};

/**
 * Removes a collaborator from the workspace (allowed for the workspace owner,
 * or for the collaborator themselves leaving voluntarily), then releases any
 * orphaned file locks and deletes their per-file ACL overrides.
 */
export const removeProjectMember = async (
  projectId: string,
  targetUserId: string,
  callerId: string
): Promise<void> => {
  // Self-leave only requires existing workspace membership; removing someone else requires owner
  const { project } = await assertProjectAccess(
    projectId,
    callerId,
    callerId === targetUserId ? 'viewer' : 'owner'
  );

  if (targetUserId === project.ownerId) {
    throw new AppError(
      400,
      'CANNOT_REMOVE_OWNER',
      'Workspace owner cannot be removed'
    );
  }

  const existing = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: targetUserId },
    },
  });

  if (!existing) {
    throw new AppError(404, 'MEMBER_NOT_FOUND', 'Collaborator not found');
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.delete({ where: { id: existing.id } });
    // Clear any stale file locks or per-file ACL overrides for the removed collaborator
    await tx.projectFile.updateMany({
      where: {
        lockedById: targetUserId,
        branch: { projectId },
      },
      data: { lockedById: null, lockedAt: null },
    });
    await tx.projectFileAccess.deleteMany({
      where: {
        userId: targetUserId,
        file: { branch: { projectId } },
      },
    });
  });
};

// =====================================================================
// Branches
// =====================================================================

/** Lists all Git-style branches in the workspace (`main`/default branch sorted first). */
export const listBranches = async (
  projectId: string,
  userId: string
): Promise<ProjectBranchDto[]> => {
  await assertProjectAccess(projectId, userId);

  const branches = await prisma.projectBranch.findMany({
    where: { projectId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });

  return branches.map(mapBranchDto);
};

/**
 * Creates a new Git-style branch by cloning the file/folder tree and per-file ACL rules
 * from `sourceBranchId` (or the workspace's default branch if omitted).
 * Requires `editor` or `owner`.
 */
export const createBranch = async (
  projectId: string,
  userId: string,
  input: CreateBranchInput
): Promise<ProjectBranchDto> => {
  await assertProjectAccess(projectId, userId, 'editor');

  // Verify explicitly chosen source branch belongs to THIS project (blocks cross-project branch cloning)
  const sourceBranch = input.sourceBranchId
    ? await assertBranchInProject(projectId, input.sourceBranchId)
    : await prisma.projectBranch.findFirst({
        where: { projectId, isDefault: true },
      });

  if (!sourceBranch) {
    throw new AppError(
      404,
      'SOURCE_BRANCH_NOT_FOUND',
      'Source branch not found'
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const newBranch = await tx.projectBranch.create({
        data: {
          projectId,
          name: input.name,
          isDefault: false,
          isProtected: false,
          parentBranchId: sourceBranch.id,
          createdById: userId,
        },
      });

      const sourceNodes = await tx.projectFile.findMany({
        where: { branchId: sourceBranch.id },
        include: { accessRules: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      const childrenByParent = new Map<string, typeof sourceNodes>();
      for (const node of sourceNodes) {
        const key = node.parentId ?? 'ROOT';
        const bucket = childrenByParent.get(key) ?? [];
        bucket.push(node);
        childrenByParent.set(key, bucket);
      }

      const idMap = new Map<string, string>();
      const accessClones: Array<{
        fileId: string;
        userId: string;
        permission: 'EDIT' | 'READ_ONLY' | 'DENIED';
      }> = [];

      // Insert parent folders level-by-level (BFS) so self-referencing FKs always succeed
      const queue: string[] = ['ROOT'];
      while (queue.length > 0) {
        const nextQueue: string[] = [];
        const batch: Array<{
          id: string;
          branchId: string;
          parentId: string | null;
          parentKey: string;
          name: string;
          nodeType: 'FILE' | 'FOLDER';
          content: string;
          version: number;
          yjsState: null;
          lockedById: null;
          lockedAt: null;
        }> = [];

        for (const parentOldKey of queue) {
          const children = childrenByParent.get(parentOldKey) ?? [];
          for (const child of children) {
            const newId = crypto.randomUUID();
            idMap.set(child.id, newId);

            const mappedParentId = child.parentId
              ? (idMap.get(child.parentId) ?? null)
              : null;

            // Clone node with a fresh UUID and reset runtime fields (version=1, no active locks/Yjs state)
            batch.push({
              id: newId,
              branchId: newBranch.id,
              parentId: mappedParentId,
              parentKey: mappedParentId ?? 'ROOT',
              name: child.name,
              nodeType: child.nodeType,
              content: child.content,
              version: 1,
              yjsState: null,
              lockedById: null,
              lockedAt: null,
            });

            // Carry over per-file access rules so collaborators cannot bypass restrictions via branching
            for (const rule of child.accessRules) {
              accessClones.push({
                fileId: newId,
                userId: rule.userId,
                permission: rule.permission,
              });
            }

            if (child.nodeType === 'FOLDER') {
              nextQueue.push(child.id);
            }
          }
        }

        if (batch.length > 0) {
          await tx.projectFile.createMany({ data: batch });
        }
        queue.length = 0;
        queue.push(...nextQueue);
      }

      if (accessClones.length > 0) {
        await tx.projectFileAccess.createMany({ data: accessClones });
      }

      return mapBranchDto(newBranch);
    });
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new AppError(
        409,
        'BRANCH_EXISTS',
        `Branch "${input.name}" already exists in this workspace`
      );
    }
    throw err;
  }
};

/** Renames a branch or toggles `isProtected` (blocking direct editor writes). Owner-only. */
export const updateBranch = async (
  projectId: string,
  branchId: string,
  userId: string,
  input: UpdateBranchInput
): Promise<ProjectBranchDto> => {
  await assertProjectAccess(projectId, userId, 'owner');
  await assertBranchInProject(projectId, branchId);

  try {
    const updated = await prisma.projectBranch.update({
      where: { id: branchId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isProtected !== undefined
          ? { isProtected: input.isProtected }
          : {}),
      },
    });
    return mapBranchDto(updated);
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new AppError(
        409,
        'BRANCH_EXISTS',
        `Branch "${input.name}" already exists in this workspace`
      );
    }
    throw err;
  }
};

/** Deletes a non-default branch and cascades its cloned file tree. Owner-only. */
export const deleteBranch = async (
  projectId: string,
  branchId: string,
  userId: string
): Promise<void> => {
  await assertProjectAccess(projectId, userId, 'owner');
  const branch = await assertBranchInProject(projectId, branchId);

  if (branch.isDefault) {
    throw new AppError(
      400,
      'CANNOT_DELETE_DEFAULT_BRANCH',
      'The default branch cannot be deleted'
    );
  }

  await prisma.projectBranch.delete({ where: { id: branch.id } });
};

// =====================================================================
// Files, Folders, Locks & Fine-Grained File ACLs
// =====================================================================

/**
 * Lists visible files and folders in a branch for the Explorer sidebar.
 * Walks top-down from root so DENIED folders hide their entire subtree and
 * READ_ONLY folders cascade down to descendants without transferring full content blobs.
 */
export const listBranchFiles = async (
  projectId: string,
  branchId: string,
  userId: string
): Promise<ProjectFileNodeDto[]> => {
  const { role } = await assertProjectAccess(projectId, userId);
  const branch = await assertBranchInProject(projectId, branchId);

  // Select only tree metadata + lock status + caller's own ACL rules (omit text/Yjs blobs)
  const nodes = await prisma.projectFile.findMany({
    where: { branchId: branch.id },
    select: {
      id: true,
      branchId: true,
      parentId: true,
      name: true,
      nodeType: true,
      version: true,
      lockedById: true,
      lockedAt: true,
      createdAt: true,
      updatedAt: true,
      lockedBy: { select: { id: true, username: true } },
      accessRules: {
        where: { userId },
        take: 1,
      },
    },
    orderBy: [{ nodeType: 'desc' }, { name: 'asc' }],
  });

  const childrenByParent = new Map<string, typeof nodes>();
  for (const node of nodes) {
    const key = node.parentId ?? 'ROOT';
    const list = childrenByParent.get(key) ?? [];
    list.push(node);
    childrenByParent.set(key, list);
  }

  // Traverse from ROOT so DENIED folders prune their entire subtree cleanly
  const visible: ProjectFileNodeDto[] = [];
  const queue: Array<{ parentKey: string; inheritedReadOnly: boolean }> = [
    { parentKey: 'ROOT', inheritedReadOnly: false },
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    const children = childrenByParent.get(item.parentKey) ?? [];

    for (const node of children) {
      const explicitOverride = node.accessRules[0]
        ? toDtoAccessPermission(node.accessRules[0].permission)
        : null;

      let effectiveOverride: FileAccessPermission | null = explicitOverride;
      if (!effectiveOverride && item.inheritedReadOnly) {
        effectiveOverride = 'read_only';
      }

      const effective = computeEffectiveFilePermission({
        role,
        userId,
        branchIsProtected: branch.isProtected,
        fileLockedById: node.lockedById,
        override: effectiveOverride,
      });

      if (effective === 'denied') {
        // Skipping both push to `visible` and push to `queue` prunes the hidden subtree
        continue;
      }

      visible.push(mapFileNodeDto(node, effective));

      if (node.nodeType === 'FOLDER') {
        queue.push({
          parentKey: node.id,
          // Propagate parent folder READ_ONLY flag down to all descendants
          inheritedReadOnly:
            item.inheritedReadOnly || explicitOverride === 'read_only',
        });
      }
    }
  }

  return visible;
};

/**
 * Loads a single file's text content and effective permission for Monaco Editor.
 * Enforces inherited folder ACLs (`403 FILE_ACCESS_DENIED`) and rejects folders.
 */
export const getFileDetail = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string
): Promise<ProjectFileDetailDto> => {
  const { role } = await assertProjectAccess(projectId, userId);
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId, userId);

  if (file.nodeType === 'FOLDER') {
    throw new AppError(
      400,
      'FOLDER_NOT_OPENABLE',
      'Cannot open folder content as a text file'
    );
  }

  const override = await resolveInheritedOverride(branch.id, file.id, userId);
  const effective = computeEffectiveFilePermission({
    role,
    userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: file.lockedById,
    override,
  });

  if (effective === 'denied') {
    throw new AppError(
      403,
      'FILE_ACCESS_DENIED',
      'You do not have access to this file'
    );
  }

  return {
    ...mapFileNodeDto(file, effective),
    content: file.content,
  };
};

/**
 * Creates a new file or folder node inside root (`parentId: null`) or an existing folder.
 * Requires `editor`+, non-protected branch (unless owner), and write permission on parent folder.
 */
export const createFileNode = async (
  projectId: string,
  branchId: string,
  userId: string,
  input: CreateFileNodeInput
): Promise<ProjectFileDetailDto> => {
  const { role } = await assertProjectAccess(projectId, userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);

  if (branch.isProtected && role !== 'owner') {
    throw new AppError(
      403,
      'BRANCH_PROTECTED',
      'This branch is protected; switch to another branch to create files'
    );
  }

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await assertFileInBranch(branch.id, parentId, userId);
    if (parent.nodeType !== 'FOLDER') {
      throw new AppError(
        400,
        'INVALID_PARENT',
        'Files and folders can only be created inside a folder'
      );
    }
    const parentOverride = await resolveInheritedOverride(
      branch.id,
      parent.id,
      userId
    );
    assertCanWriteFileNode({
      role,
      userId,
      branchIsProtected: branch.isProtected,
      fileLockedById: parent.lockedById,
      lockedByUsername: parent.lockedBy?.username,
      override: parentOverride,
    });
  }

  try {
    const created = await prisma.projectFile.create({
      data: {
        branchId: branch.id,
        parentId,
        parentKey: parentId ?? 'ROOT',
        name: input.name,
        nodeType: toDbNodeType(input.nodeType),
        content: input.nodeType === 'folder' ? '' : (input.content ?? ''),
      },
      include: {
        lockedBy: { select: { id: true, username: true } },
      },
    });

    const effective = computeEffectiveFilePermission({
      role,
      userId,
      branchIsProtected: branch.isProtected,
      fileLockedById: created.lockedById,
      override: null,
    });

    return {
      ...mapFileNodeDto(created, effective),
      content: created.content,
    };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new AppError(
        409,
        'FILE_EXISTS',
        `"${input.name}" already exists in this folder`
      );
    }
    throw err;
  }
};

/**
 * Renames, moves (`parentId`), or saves text content on an existing node.
 * Enforces ACLs, branch protection, file locks, folder cycle prevention, and
 * atomic compare-and-swap optimistic versioning when `expectedVersion` is supplied.
 */
export const updateFileNode = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string,
  input: UpdateFileNodeInput
): Promise<ProjectFileDetailDto> => {
  const { role } = await assertProjectAccess(projectId, userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId, userId);

  if (input.content !== undefined && file.nodeType === 'FOLDER') {
    throw new AppError(
      400,
      'INVALID_FOLDER_CONTENT',
      'Cannot write text content to a folder'
    );
  }

  const override = await resolveInheritedOverride(branch.id, file.id, userId);
  assertCanWriteFileNode({
    role,
    userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: file.lockedById,
    lockedByUsername: file.lockedBy?.username,
    override,
  });

  // Guard parent move against cycles & non-folder targets
  if (input.parentId !== undefined) {
    if (input.parentId === file.id) {
      throw new AppError(
        400,
        'FOLDER_CYCLE',
        'Cannot move a folder inside itself'
      );
    }

    if (input.parentId !== null) {
      const targetParent = await assertFileInBranch(
        branch.id,
        input.parentId,
        userId
      );
      if (targetParent.nodeType !== 'FOLDER') {
        throw new AppError(
          400,
          'INVALID_PARENT',
          'Destination parent must be a folder'
        );
      }

      if (file.nodeType === 'FOLDER') {
        // Walk upward from destination folder toward root; hitting `file.id` would create a detached cycle
        const allNodes = await prisma.projectFile.findMany({
          where: { branchId: branch.id },
          select: { id: true, parentId: true },
        });
        const parentLookup = new Map(allNodes.map((n) => [n.id, n.parentId]));
        let walk: string | null | undefined = targetParent.id;
        let depth = 0;
        while (walk && depth < 100) {
          if (walk === file.id) {
            throw new AppError(
              400,
              'FOLDER_CYCLE',
              'Cannot move a folder into one of its own subfolders'
            );
          }
          walk = parentLookup.get(walk);
          depth += 1;
        }
      }
    }
  }

  const nextParentId =
    input.parentId !== undefined ? input.parentId : file.parentId;
  const updateData = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.parentId !== undefined
      ? { parentId: nextParentId, parentKey: nextParentId ?? 'ROOT' }
      : {}),
    ...(input.content !== undefined
      ? { content: input.content, yjsState: null }
      : {}),
    version: { increment: 1 },
  };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (input.expectedVersion !== undefined) {
        // Optimistic Concurrency Control (CAS): only update if no other collaborator bumped `version`
        const res = await tx.projectFile.updateMany({
          where: { id: file.id, version: input.expectedVersion },
          data: updateData,
        });

        if (res.count === 0) {
          // Version mismatch -> return current server version & content so client can prompt a merge/reload
          const latest = await tx.projectFile.findUnique({
            where: { id: file.id },
            select: { version: true, content: true, updatedAt: true },
          });
          throw new AppError(
            409,
            'FILE_VERSION_CONFLICT',
            'File was modified by another collaborator before your save completed',
            latest
          );
        }

        const fresh = await tx.projectFile.findUnique({
          where: { id: file.id },
          include: { lockedBy: { select: { id: true, username: true } } },
        });
        if (!fresh) {
          throw new AppError(404, 'FILE_NOT_FOUND', 'File no longer exists');
        }
        return fresh;
      }

      return tx.projectFile.update({
        where: { id: file.id },
        data: updateData,
        include: { lockedBy: { select: { id: true, username: true } } },
      });
    });

    if (input.content !== undefined) {
      // Keep any live WebSocket Y.Doc aligned if REST saved new plain-text content directly
      yjsRoomManager.syncFileContentFromRest(
        branch.id,
        updated.id,
        updated.content,
        updated.version
      );
    }

    const effective = computeEffectiveFilePermission({
      role,
      userId,
      branchIsProtected: branch.isProtected,
      fileLockedById: updated.lockedById,
      override,
    });

    return {
      ...mapFileNodeDto(updated, effective),
      content: updated.content,
    };
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new AppError(
        409,
        'FILE_EXISTS',
        `A sibling item named "${input.name ?? file.name}" already exists there`
      );
    }
    throw err;
  }
};

/**
 * Deletes a file or folder (cascading descendants).
 * Before wiping a folder, traverses all descendants to ensure no nested file
 * is locked by someone else or hidden/read-only for a non-owner caller.
 */
export const deleteFileNode = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string
): Promise<void> => {
  const { role } = await assertProjectAccess(projectId, userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId, userId);

  const override = await resolveInheritedOverride(branch.id, file.id, userId);
  assertCanWriteFileNode({
    role,
    userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: file.lockedById,
    lockedByUsername: file.lockedBy?.username,
    override,
  });

  if (file.nodeType === 'FOLDER') {
    const branchNodes = await prisma.projectFile.findMany({
      where: { branchId: branch.id },
      select: {
        id: true,
        parentId: true,
        lockedById: true,
        accessRules: { where: { userId }, take: 1 },
      },
    });
    const childrenByParent = new Map<string, typeof branchNodes>();
    for (const node of branchNodes) {
      if (!node.parentId) continue;
      const list = childrenByParent.get(node.parentId) ?? [];
      list.push(node);
      childrenByParent.set(node.parentId, list);
    }

    const queue = [...(childrenByParent.get(file.id) ?? [])];
    while (queue.length > 0) {
      const desc = queue.shift()!;
      if (desc.lockedById && desc.lockedById !== userId) {
        throw new AppError(
          403,
          'DESCENDANT_LOCKED',
          'Cannot delete folder because a file inside it is locked by another collaborator'
        );
      }
      if (role !== 'owner' && desc.accessRules[0]) {
        const perm = toDtoAccessPermission(desc.accessRules[0].permission);
        if (perm === 'denied' || perm === 'read_only') {
          throw new AppError(
            403,
            'DESCENDANT_PROTECTED',
            'Cannot delete folder containing restricted files'
          );
        }
      }
      const next = childrenByParent.get(desc.id);
      if (next) queue.push(...next);
    }
  }

  await prisma.projectFile.delete({ where: { id: file.id } });
  yjsRoomManager.destroyRoomIfLoaded(branch.id, file.id);
};

/**
 * Places an exclusive checkout lock on a file so only the lock holder can save edits.
 * Blocked on folders, read-only/denied files, protected branches (non-owners), and already-locked files.
 */
export const lockFileNode = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string
): Promise<ProjectFileNodeDto> => {
  const { role } = await assertProjectAccess(projectId, userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId, userId);

  if (file.nodeType === 'FOLDER') {
    throw new AppError(
      400,
      'CANNOT_LOCK_FOLDER',
      'Only individual files can be checkout-locked'
    );
  }

  const override = await resolveInheritedOverride(branch.id, file.id, userId);
  if (role !== 'owner' && (override === 'denied' || override === 'read_only')) {
    throw new AppError(
      403,
      'FILE_READ_ONLY',
      'You cannot lock a file you do not have edit access to'
    );
  }

  if (branch.isProtected && role !== 'owner') {
    throw new AppError(
      403,
      'BRANCH_PROTECTED',
      'Only workspace owners can lock files on a protected branch'
    );
  }

  if (file.lockedById && file.lockedById !== userId) {
    throw new AppError(
      409,
      'FILE_ALREADY_LOCKED',
      `File is already locked by @${file.lockedBy?.username ?? 'another user'}`
    );
  }

  const updated = await prisma.projectFile.update({
    where: { id: file.id },
    data: { lockedById: userId, lockedAt: new Date() },
    include: { lockedBy: { select: { id: true, username: true } } },
  });

  const effective = computeEffectiveFilePermission({
    role,
    userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: updated.lockedById,
    override,
  });

  return mapFileNodeDto(updated, effective);
};

/**
 * Releases an exclusive checkout lock on a file.
 * Can be called by the current lock holder OR the workspace owner (to rescue abandoned locks).
 */
export const unlockFileNode = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string
): Promise<ProjectFileNodeDto> => {
  const { role } = await assertProjectAccess(projectId, userId, 'editor');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId, userId);

  if (file.lockedById && file.lockedById !== userId && role !== 'owner') {
    throw new AppError(
      403,
      'FILE_LOCK_FORBIDDEN',
      `Only @${file.lockedBy?.username ?? 'the lock holder'} or the workspace owner can unlock this file`
    );
  }

  const updated = await prisma.projectFile.update({
    where: { id: file.id },
    data: { lockedById: null, lockedAt: null },
    include: { lockedBy: { select: { id: true, username: true } } },
  });

  const override = await resolveInheritedOverride(branch.id, file.id, userId);
  const effective = computeEffectiveFilePermission({
    role,
    userId,
    branchIsProtected: branch.isProtected,
    fileLockedById: updated.lockedById,
    override,
  });

  return mapFileNodeDto(updated, effective);
};

// =====================================================================
// Per-File Collaborator ACLs (Owner Only)
// =====================================================================

/** Lists per-user ACL overrides attached to a specific file or folder. Owner-only. */
export const listFileAccessRules = async (
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string
): Promise<ProjectFileAccessDto[]> => {
  await assertProjectAccess(projectId, userId, 'owner');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId);

  const rules = await prisma.projectFileAccess.findMany({
    where: { fileId: file.id },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rules.map((r) => ({
    id: r.id,
    fileId: r.fileId,
    userId: r.userId,
    username: r.user.username,
    ...(r.user.avatarUrl ? { avatarUrl: r.user.avatarUrl } : {}),
    permission: toDtoAccessPermission(r.permission),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
};

/**
 * Creates or updates a per-user ACL override (`edit` | `read_only` | `denied`) on a file or folder.
 * Owner-only; target must be a current collaborator and cannot be the owner themselves.
 */
export const setFileAccessRule = async (
  projectId: string,
  branchId: string,
  fileId: string,
  callerId: string,
  input: SetFileAccessInput
): Promise<ProjectFileAccessDto> => {
  const { project } = await assertProjectAccess(projectId, callerId, 'owner');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId);

  if (input.userId === project.ownerId) {
    throw new AppError(
      400,
      'CANNOT_RESTRICT_OWNER',
      'Workspace owner permissions cannot be restricted'
    );
  }

  const member = await prisma.projectMember.findUnique({
    where: {
      projectId_userId: { projectId, userId: input.userId },
    },
  });

  if (!member) {
    throw new AppError(
      404,
      'MEMBER_NOT_FOUND',
      'User must be a workspace collaborator before setting per-file permissions'
    );
  }

  const rule = await prisma.projectFileAccess.upsert({
    where: {
      fileId_userId: { fileId: file.id, userId: input.userId },
    },
    update: { permission: toDbAccessPermission(input.permission) },
    create: {
      fileId: file.id,
      userId: input.userId,
      permission: toDbAccessPermission(input.permission),
    },
    include: {
      user: { select: { id: true, username: true, avatarUrl: true } },
    },
  });

  return {
    id: rule.id,
    fileId: rule.fileId,
    userId: rule.userId,
    username: rule.user.username,
    ...(rule.user.avatarUrl ? { avatarUrl: rule.user.avatarUrl } : {}),
    permission: toDtoAccessPermission(rule.permission),
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
};

/** Removes a per-user ACL override so the collaborator reverts to workspace/inherited defaults. Owner-only. */
export const removeFileAccessRule = async (
  projectId: string,
  branchId: string,
  fileId: string,
  targetUserId: string,
  callerId: string
): Promise<void> => {
  await assertProjectAccess(projectId, callerId, 'owner');
  const branch = await assertBranchInProject(projectId, branchId);
  const file = await assertFileInBranch(branch.id, fileId);

  await prisma.projectFileAccess.deleteMany({
    where: { fileId: file.id, userId: targetUserId },
  });
};
