import type {
  AgentApplyStagedFilesRequestDto,
  AgentCreateSessionRequestDto,
  AgentDiscardStagedFilesRequestDto,
  AgentSessionDetailDto,
  AgentSessionSummaryDto,
  AgentStreamEventDto,
} from '@codecollab/shared';
import { apiRequest } from '@/lib/api';

/**
 * Creates a new autonomous agent session and initializes planning.
 */
export async function createAgentSession(
  projectId: string,
  branchId: string,
  payload: AgentCreateSessionRequestDto,
): Promise<AgentSessionDetailDto> {
  return apiRequest<AgentSessionDetailDto>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Fetches the complete state of an agent session, including plan steps,
 * tool call execution history, and staged files.
 */
export async function getAgentSession(
  projectId: string,
  branchId: string,
  sessionId: string,
): Promise<AgentSessionDetailDto> {
  return apiRequest<AgentSessionDetailDto>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions/${encodeURIComponent(sessionId)}`,
  );
}

/**
 * Atomically applies quarantined staged files to the active branch
 * using Optimistic Concurrency Control (OCC).
 */
export async function applyAgentStagedFiles(
  projectId: string,
  branchId: string,
  sessionId: string,
  payload?: AgentApplyStagedFilesRequestDto,
): Promise<{ appliedCount: number; sessionStatus: string }> {
  return apiRequest<{ appliedCount: number; sessionStatus: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions/${encodeURIComponent(sessionId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    },
  );
}

/**
 * Discards all or specific quarantined staged files from the session buffer.
 */
export async function discardAgentStagedFiles(
  projectId: string,
  branchId: string,
  sessionId: string,
  payload?: AgentDiscardStagedFilesRequestDto,
): Promise<{ discardedCount: number }> {
  return apiRequest<{ discardedCount: number }>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions/${encodeURIComponent(sessionId)}/staged`,
    {
      method: 'DELETE',
      body: JSON.stringify(payload ?? {}),
    },
  );
}

/**
 * Cancels a running agent session, halting subsequent tool iterations.
 */
export async function cancelAgentSession(
  projectId: string,
  branchId: string,
  sessionId: string,
): Promise<AgentSessionSummaryDto> {
  return apiRequest<AgentSessionSummaryDto>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: 'POST',
    },
  );
}

export interface StreamAgentSessionCallbacks {
  onEvent: (event: AgentStreamEventDto) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}

/**
 * Streams real-time agent execution events over Server-Sent Events (SSE) using
 * `fetch()` + `ReadableStreamDefaultReader` with double-newline buffering.
 *
 * This design handles authentication cookies natively (`credentials: 'include'`),
 * supports `POST` endpoints, and protects against chunk-split JSON syntax errors.
 */
export async function streamAgentSession(
  projectId: string,
  branchId: string,
  sessionId: string,
  callbacks: StreamAgentSessionCallbacks,
): Promise<void> {
  const url = `/api/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/agent/sessions/${encodeURIComponent(sessionId)}/stream`;

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    signal: callbacks.signal,
  });

  if (!response.ok) {
    let errorMessage = `Stream connection failed with HTTP ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // response body was not JSON
    }
    const err = new Error(errorMessage);
    callbacks.onError?.(err);
    throw err;
  }

  if (!response.body) {
    const err = new Error('ReadableStream not supported by environment');
    callbacks.onError?.(err);
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      // The last element is either empty (if ended with \n\n) or a partial frame
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const trimmed = frame.trim();
        if (!trimmed || trimmed.startsWith(':')) {
          // Heartbeat or comment line
          continue;
        }

        const lines = trimmed.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const dataStr = line.slice(5).trim();
            if (dataStr) {
              try {
                const event = JSON.parse(dataStr) as AgentStreamEventDto;
                callbacks.onEvent(event);
              } catch (parseErr) {
                console.warn('[streamAgentSession] Failed to parse SSE frame:', dataStr, parseErr);
              }
            }
          }
        }
      }
    }
    callbacks.onDone?.();
  } catch (streamErr) {
    if (callbacks.signal?.aborted) {
      return;
    }
    callbacks.onError?.(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
  } finally {
    reader.releaseLock();
  }
}
