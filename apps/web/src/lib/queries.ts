import type {
  AddProjectMemberInput,
  BranchMergePreviewResponse,
  BranchMergeResultResponse,
  ChatMessageDto,
  CreateBranchInput,
  CreateChatMessageInput,
  CreateExecutionRunInput,
  CreateFileNodeInput,
  CreateProjectInput,
  ExecutionRunDetailDto,
  ExecutionRunDto,
  HealthCheckResponse,
  MergeBranchInput,
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
    mergePreview: (
      projectId: string,
      targetBranchId: string,
      sourceBranchId: string,
    ) =>
      [
        'projects',
        projectId,
        'branches',
        targetBranchId,
        'merge-preview',
        sourceBranchId,
      ] as const,
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
    runs: (projectId: string, branchId: string) =>
      ['projects', projectId, 'branches', branchId, 'runs'] as const,
    runDetail: (projectId: string, runId: string) =>
      ['projects', projectId, 'runs', runId] as const,
    chat: (projectId: string) => ['projects', projectId, 'chat'] as const,
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

/** Computes a dry-run diff preview for merging `sourceBranchId` into `targetBranchId`. */
export async function fetchBranchMergePreview(
  projectId: string,
  targetBranchId: string,
  sourceBranchId: string,
): Promise<BranchMergePreviewResponse> {
  return apiRequest<BranchMergePreviewResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(targetBranchId)}/merge/preview?sourceBranchId=${encodeURIComponent(sourceBranchId)}`,
  );
}

/** Atomically merges `input.sourceBranchId` into `targetBranchId`. */
export async function mergeBranches(
  projectId: string,
  targetBranchId: string,
  input: MergeBranchInput,
): Promise<BranchMergeResultResponse> {
  return apiRequest<BranchMergeResultResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(targetBranchId)}/merge`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
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

// =====================================================================
// Day 4: Code Execution Runs & Workspace Chat
// =====================================================================

/** Lists recent execution runs on a branch visible to the caller (respects file ACLs). */
export async function fetchBranchExecutionRuns(
  projectId: string,
  branchId: string,
): Promise<ExecutionRunDto[]> {
  const res = await apiRequest<{ runs: ExecutionRunDto[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/runs`,
  );
  return res.runs;
}

/** Enqueues an isolated Docker execution run for a branch snapshot. Owner/Editor only. */
export async function createExecutionRun(
  projectId: string,
  branchId: string,
  input: CreateExecutionRunInput,
): Promise<ExecutionRunDetailDto> {
  const res = await apiRequest<{ run: ExecutionRunDetailDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/runs`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.run;
}

/** Retrieves full status, output, and source snapshot for a single run. */
export async function fetchExecutionRunDetail(
  projectId: string,
  runId: string,
): Promise<ExecutionRunDetailDto> {
  const res = await apiRequest<{ run: ExecutionRunDetailDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
  );
  return res.run;
}

/** Requests cancellation of a queued or running execution container. */
export async function cancelExecutionRun(
  projectId: string,
  runId: string,
): Promise<ExecutionRunDto> {
  const res = await apiRequest<{ run: ExecutionRunDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}/cancel`,
    { method: 'POST' },
  );
  return res.run;
}

export interface ChatHistoryPage {
  messages: ChatMessageDto[];
  nextCursor: string | null;
}

/** Fetches cursor-paginated team chat messages for workspace members. */
export async function fetchProjectChatMessages(
  projectId: string,
  params?: { cursor?: string; limit?: number },
): Promise<ChatHistoryPage> {
  const search = new URLSearchParams();
  if (params?.cursor) search.set('cursor', params.cursor);
  if (params?.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiRequest<ChatHistoryPage>(
    `/api/projects/${encodeURIComponent(projectId)}/chat${qs ? `?${qs}` : ''}`,
  );
}

/** Persists and broadcasts a new workspace chat message via REST fallback. Owner/Editor only. */
export async function sendProjectChatMessage(
  projectId: string,
  input: CreateChatMessageInput,
): Promise<ChatMessageDto> {
  const res = await apiRequest<{ message: ChatMessageDto }>(
    `/api/projects/${encodeURIComponent(projectId)}/chat`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return res.message;
}
