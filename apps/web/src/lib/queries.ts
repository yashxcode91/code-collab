import type {
  AddProjectMemberInput,
  CreateBranchInput,
  CreateFileNodeInput,
  CreateProjectInput,
  HealthCheckResponse,
  Project,
  ProjectBranchDto,
  ProjectDetailResponse,
  ProjectFileAccessDto,
  ProjectFileDetailDto,
  ProjectFileNodeDto,
  ProjectMemberDto,
  SetFileAccessInput,
  UpdateBranchInput,
  UpdateFileNodeInput,
  UpdateProjectInput,
  UpdateProjectMemberRoleInput,
} from '@codecollab/shared';
import { apiRequest } from '@/lib/api';

/**
 * Centralized TanStack React Query cache keys for CodeCollab.
 * Keeping keys in a single factory guarantees that mutations (create/delete/save/ACL)
 * invalidate the exact cache entries observed across Dashboard and Studio views.
 */
export const queryKeys = {
  health: ['health'] as const,
  projects: {
    all: ['projects'] as const,
    detail: (projectId: string) => ['projects', projectId] as const,
    files: (projectId: string, branchId: string) =>
      ['projects', projectId, 'branches', branchId, 'files'] as const,
    fileDetail: (projectId: string, branchId: string, fileId: string) =>
      ['projects', projectId, 'branches', branchId, 'files', fileId] as const,
    fileAccess: (projectId: string, branchId: string, fileId: string) =>
      [
        'projects',
        projectId,
        'branches',
        branchId,
        'files',
        fileId,
        'access',
      ] as const,
  },
} as const;

/** Fetches live backend API, PostgreSQL, and Redis telemetry from `/api/health`. */
export async function fetchHealth(): Promise<HealthCheckResponse> {
  return apiRequest<HealthCheckResponse>('/api/health');
}

/** Fetches all workspaces owned by or shared with the authenticated user. */
export async function fetchProjects(): Promise<Project[]> {
  const res = await apiRequest<{ projects: Project[] }>('/api/projects');
  return res.projects;
}

/**
 * Fetches full metadata for a single workspace, including its Git-style branches
 * and authorized collaborator list, used by `/studio/:projectId` and Orbital tree previews.
 */
export async function fetchProjectDetail(
  projectId: string,
): Promise<ProjectDetailResponse> {
  return apiRequest<ProjectDetailResponse>(
    `/api/projects/${encodeURIComponent(projectId)}`,
  );
}

/** Updates workspace settings (`name`, `description`, `isPublic`, `maxConcurrentEditors`, `preventSameLineEdit`). */
export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const res = await apiRequest<{ project: Project }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return res.project;
}

/**
 * Fetches file & folder tree metadata for a specific project branch from PostgreSQL
 * (`/api/projects/:projectId/branches/:branchId/files`).
 */
export async function fetchBranchFiles(
  projectId: string,
  branchId: string,
): Promise<ProjectFileNodeDto[]> {
  const res = await apiRequest<{ files: ProjectFileNodeDto[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files`,
  );
  return res.files;
}

/** Creates a new collaborative workspace with a server-provisioned default branch. */
export async function createProject(
  input: CreateProjectInput,
): Promise<ProjectDetailResponse> {
  return apiRequest<ProjectDetailResponse>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Permanently deletes a workspace (owner-only enforced on the Express backend). */
export async function deleteProject(
  projectId: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: 'DELETE' },
  );
}

// =====================================================================
// Collaborators
// =====================================================================

/** Invites a registered collaborator to the workspace by username or email. Owner-only. */
export async function addProjectMember(
  projectId: string,
  input: AddProjectMemberInput,
): Promise<ProjectMemberDto> {
  const res = await apiRequest<{ member: ProjectMemberDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.member;
}

/** Updates an existing collaborator's workspace role (`editor` <-> `viewer`). Owner-only. */
export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  input: UpdateProjectMemberRoleInput,
): Promise<ProjectMemberDto> {
  const res = await apiRequest<{ member: ProjectMemberDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return res.member;
}

/** Removes a collaborator (owner) or leaves a shared workspace (self). */
export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

// =====================================================================
// Branches
// =====================================================================

/** Clones a new branch snapshot from `sourceBranchId` (or default branch). */
export async function createBranch(
  projectId: string,
  input: CreateBranchInput,
): Promise<ProjectBranchDto> {
  const res = await apiRequest<{ branch: ProjectBranchDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.branch;
}

/** Renames a branch or toggles `isProtected` status. Owner-only. */
export async function updateBranch(
  projectId: string,
  branchId: string,
  input: UpdateBranchInput,
): Promise<ProjectBranchDto> {
  const res = await apiRequest<{ branch: ProjectBranchDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return res.branch;
}

/** Deletes a non-default branch and its cloned files. Owner-only. */
export async function deleteBranch(
  projectId: string,
  branchId: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`,
    { method: 'DELETE' },
  );
}

// =====================================================================
// Files, Folders & Locks
// =====================================================================

/** Fetches a single file's content, version, lock state, and effective permission. */
export async function fetchFileDetail(
  projectId: string,
  branchId: string,
  fileId: string,
): Promise<ProjectFileDetailDto> {
  const res = await apiRequest<{ file: ProjectFileDetailDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}`,
  );
  return res.file;
}

/** Creates a file or folder inside a workspace branch. */
export async function createFileNode(
  projectId: string,
  branchId: string,
  input: CreateFileNodeInput,
): Promise<ProjectFileDetailDto> {
  const res = await apiRequest<{ file: ProjectFileDetailDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.file;
}

/**
 * Renames, moves, or saves text content on an existing node.
 * Supplying `expectedVersion` triggers atomic CAS protection (`409 FILE_VERSION_CONFLICT` if stale).
 */
export async function updateFileNode(
  projectId: string,
  branchId: string,
  fileId: string,
  input: UpdateFileNodeInput,
): Promise<ProjectFileDetailDto> {
  const res = await apiRequest<{ file: ProjectFileDetailDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return res.file;
}

/** Deletes a file or folder node (and cascades non-protected descendants). */
export async function deleteFileNode(
  projectId: string,
  branchId: string,
  fileId: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
  );
}

/** Acquires an exclusive checkout lock on a file. */
export async function lockFileNode(
  projectId: string,
  branchId: string,
  fileId: string,
): Promise<ProjectFileNodeDto> {
  const res = await apiRequest<{ file: ProjectFileNodeDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}/lock`,
    { method: 'POST' },
  );
  return res.file;
}

/** Releases a checkout lock (callable by lock holder or workspace owner). */
export async function unlockFileNode(
  projectId: string,
  branchId: string,
  fileId: string,
): Promise<ProjectFileNodeDto> {
  const res = await apiRequest<{ file: ProjectFileNodeDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}/lock`,
    { method: 'DELETE' },
  );
  return res.file;
}

// =====================================================================
// Per-File Access Overrides (Owner Only)
// =====================================================================

/** Lists per-collaborator ACL overrides attached to a file or folder. Owner-only. */
export async function fetchFileAccessRules(
  projectId: string,
  branchId: string,
  fileId: string,
): Promise<ProjectFileAccessDto[]> {
  const res = await apiRequest<{ rules: ProjectFileAccessDto[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}/access`,
  );
  return res.rules;
}

/** Assigns or updates an explicit `edit` | `read_only` | `denied` ACL override for a collaborator. */
export async function setFileAccessRule(
  projectId: string,
  branchId: string,
  fileId: string,
  input: SetFileAccessInput,
): Promise<ProjectFileAccessDto> {
  const res = await apiRequest<{ rule: ProjectFileAccessDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}/access`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
  return res.rule;
}

/** Removes an explicit ACL override so the collaborator inherits folder/workspace defaults. */
export async function removeFileAccessRule(
  projectId: string,
  branchId: string,
  fileId: string,
  userId: string,
): Promise<{ message: string }> {
  return apiRequest<{ message: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/files/${encodeURIComponent(fileId)}/access/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}
