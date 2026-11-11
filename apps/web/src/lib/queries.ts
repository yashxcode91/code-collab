import type {
  CreateProjectInput,
  HealthCheckResponse,
  Project,
  ProjectDetailResponse,
  ProjectFileNodeDto,
} from '@codecollab/shared';
import { apiRequest } from '@/lib/api';

/**
 * Centralized TanStack React Query cache keys for CodeCollab.
 * Keeping keys in a single factory guarantees that mutations (create/delete)
 * invalidate the exact cache entries observed across Dashboard and Studio views.
 */
export const queryKeys = {
  health: ['health'] as const,
  projects: {
    all: ['projects'] as const,
    detail: (projectId: string) => ['projects', projectId] as const,
    files: (projectId: string, branchId: string) =>
      ['projects', projectId, 'branches', branchId, 'files'] as const,
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
