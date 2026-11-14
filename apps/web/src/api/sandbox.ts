import type {
  PreviewSandboxDTO,
  StartSandboxDTO,
  StopSandboxDTO,
} from '@codecollab/shared';
import { apiRequest } from '@/lib/api';

/**
 * Starts or re-connects to an isolated Docker sandbox container.
 */
export async function startSandbox(
  projectId: string,
  payload?: StartSandboxDTO
): Promise<PreviewSandboxDTO> {
  const res = await apiRequest<{ sandbox: PreviewSandboxDTO }>(
    `/api/projects/${encodeURIComponent(projectId)}/sandbox/start`,
    {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }
  );
  return res.sandbox;
}

/**
 * Halts and removes the sandbox container.
 */
export async function stopSandbox(
  projectId: string,
  payload?: StopSandboxDTO
): Promise<PreviewSandboxDTO> {
  const res = await apiRequest<{ sandbox: PreviewSandboxDTO }>(
    `/api/projects/${encodeURIComponent(projectId)}/sandbox/stop`,
    {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }
  );
  return res.sandbox;
}

/**
 * Queries live status, ports, and internal routing details.
 */
export async function getSandboxStatus(
  projectId: string,
  branchId?: string
): Promise<PreviewSandboxDTO | null> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : '';
  const res = await apiRequest<{ sandbox: PreviewSandboxDTO | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/sandbox/status${query}`
  );
  return res.sandbox;
}

/**
 * Fetches recent container stdout/stderr log output.
 */
export async function getSandboxLogs(
  projectId: string,
  branchId?: string,
  tail = 100
): Promise<string[]> {
  const params = new URLSearchParams();
  if (branchId) params.append('branchId', branchId);
  params.append('tail', String(tail));
  const res = await apiRequest<{ logs: string[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/sandbox/logs?${params.toString()}`
  );
  return res.logs;
}
