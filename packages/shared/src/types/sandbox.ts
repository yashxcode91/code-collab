/**
 * Day 9: Developer Sandbox Container States
 */
export type SandboxStatus =
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED';

/**
 * Data Transfer Object representing an active or stopped developer sandbox instance.
 */
export interface PreviewSandboxDTO {
  id: string;
  projectId: string;
  branchId: string;
  containerId: string | null;
  containerName: string;
  internalIp: string | null;
  status: SandboxStatus;
  ports: number[];
  primaryPort: number;
  memoryLimitMb: number;
  cpuLimit: number;
  previewToken: string | null;
  previewUrl: string;
  errorMessage: string | null;
  lastPingAt: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request payload when triggering container boot
 */
export interface StartSandboxDTO {
  branchId?: string;
  primaryPort?: number;
  envVars?: Record<string, string>;
}

/**
 * Request payload when stopping container
 */
export interface StopSandboxDTO {
  branchId?: string;
  force?: boolean;
}

/**
 * Streaming terminal log chunk emitted from sandbox container stdout/stderr
 */
export interface SandboxLogChunk {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

/**
 * Signed HMAC payload authorizing iframe requests through the Preview Gateway Data Plane
 */
export interface PreviewTokenPayload {
  projectId: string;
  branchId: string;
  userId: string;
  primaryPort: number;
  exp: number;
}
