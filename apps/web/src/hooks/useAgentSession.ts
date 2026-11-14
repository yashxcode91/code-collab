import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  AgentSessionDetailDto,
  AgentStagedFileDto,
  AgentStreamEventDto,
  AgentToolCallDto,
} from '@codecollab/shared';
import {
  applyAgentStagedFiles,
  cancelAgentSession,
  createAgentSession,
  discardAgentStagedFiles,
  getAgentSession,
  streamAgentSession,
} from '@/api/agent';
import { queryKeys } from '@/lib/queries';

export interface UseAgentSessionOptions {
  projectId: string;
  branchId: string | null;
  onFilesApplied?: () => void;
}

export function useAgentSession({
  projectId,
  branchId,
  onFilesApplied,
}: UseAgentSessionOptions) {
  const queryClient = useQueryClient();
  const [activeSession, setActiveSession] = useState<AgentSessionDetailDto | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfHealingCount, setSelfHealingCount] = useState(0);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [selectedStagedPath, setSelectedStagedPath] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up streaming abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  /**
   * Dispatches incoming SSE events onto the local activeSession state.
   */
  const handleStreamEvent = useCallback((event: AgentStreamEventDto) => {
    switch (event.type) {
      case 'session_status':
        setActiveSession((prev) => (prev ? { ...prev, status: event.status } : null));
        break;

      case 'plan_created':
        setActiveSession((prev) => (prev ? { ...prev, steps: event.steps } : null));
        break;

      case 'step_started':
        setActiveSession((prev) => {
          if (!prev) return null;
          const updatedSteps = prev.steps.map((s) =>
            s.stepNumber === event.stepNumber
              ? { ...s, status: 'RUNNING' as const, startedAt: new Date().toISOString() }
              : s,
          );
          return { ...prev, steps: updatedSteps };
        });
        break;

      case 'step_completed':
        setActiveSession((prev) => {
          if (!prev) return null;
          const updatedSteps = prev.steps.map((s) =>
            s.stepNumber === event.stepNumber
              ? {
                  ...s,
                  status: event.status,
                  errorMessage: event.errorMessage,
                  completedAt: new Date().toISOString(),
                }
              : s,
          );
          return { ...prev, steps: updatedSteps };
        });
        break;

      case 'tool_call_started':
        setActiveSession((prev) => {
          if (!prev) return null;
          const newToolCall: AgentToolCallDto = {
            id: event.toolCallId,
            sessionId: event.sessionId,
            toolName: event.toolName,
            inputPayload: event.input,
            status: 'RUNNING',
            createdAt: new Date().toISOString(),
          };
          return {
            ...prev,
            toolCalls: [...prev.toolCalls, newToolCall],
          };
        });
        break;

      case 'tool_call_finished':
        setActiveSession((prev) => {
          if (!prev) return null;
          const updatedCalls = prev.toolCalls.map((tc) =>
            tc.id === event.toolCallId
              ? {
                  ...tc,
                  status: event.status,
                  durationMs: event.durationMs,
                  outputPayload: event.output,
                  errorMessage: event.error,
                }
              : tc,
          );
          return { ...prev, toolCalls: updatedCalls };
        });
        break;

      case 'file_staged':
        setActiveSession((prev) => {
          if (!prev) return null;
          const existingIdx = prev.stagedFiles.findIndex(
            (sf) => sf.filePath === event.file.filePath,
          );
          let newStaged: AgentStagedFileDto[];
          if (existingIdx >= 0) {
            newStaged = [...prev.stagedFiles];
            newStaged[existingIdx] = event.file;
          } else {
            newStaged = [...prev.stagedFiles, event.file];
          }
          return { ...prev, stagedFiles: newStaged };
        });
        break;

      case 'self_healing_attempt':
        setSelfHealingCount(event.attempt);
        setActiveSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'SELF_HEALING',
                selfHealingAttempts: event.attempt,
              }
            : null,
        );
        break;

      case 'done':
        setIsStreaming(false);
        setActiveSession((prev) =>
          prev
            ? {
                ...prev,
                status: event.status,
              }
            : null,
        );
        break;

      case 'error':
        setIsStreaming(false);
        setError(event.message);
        break;
    }
  }, []);

  /**
   * Starts a new autonomous agent session and connects to the SSE stream.
   */
  const startSession = useCallback(
    async (prompt: string, title?: string, model?: string) => {
      if (!branchId) {
        setError('Cannot launch agent: No active branch selected');
        return;
      }

      setError(null);
      setIsStarting(true);
      setSelfHealingCount(0);

      // Cancel any ongoing stream
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const session = await createAgentSession(projectId, branchId, {
          prompt,
          title,
          model,
        });
        setActiveSession(session);
        setIsStarting(false);
        setIsStreaming(true);

        // Connect to stream
        await streamAgentSession(projectId, branchId, session.id, {
          signal: controller.signal,
          onEvent: handleStreamEvent,
          onDone: () => {
            setIsStreaming(false);
          },
          onError: (streamErr) => {
            setIsStreaming(false);
            setError(streamErr.message);
          },
        });
      } catch (err) {
        setIsStarting(false);
        setIsStreaming(false);
        setError(err instanceof Error ? err.message : 'Failed to initialize agent session');
      }
    },
    [projectId, branchId, handleStreamEvent],
  );

  /**
   * Cancels the active agent session and stops the stream.
   */
  const cancelSession = useCallback(async () => {
    if (!branchId || !activeSession) return;
    setIsCancelling(true);
    abortControllerRef.current?.abort();

    try {
      await cancelAgentSession(projectId, branchId, activeSession.id);
      setActiveSession((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel session');
    } finally {
      setIsCancelling(false);
      setIsStreaming(false);
    }
  }, [projectId, branchId, activeSession]);

  /**
   * Atomically applies staged files to the active branch.
   */
  const applyStaged = useCallback(
    async (filePaths?: string[]) => {
      if (!branchId || !activeSession) return;
      setIsApplying(true);
      setError(null);

      try {
        await applyAgentStagedFiles(projectId, branchId, activeSession.id, {
          filePaths,
        });

        // Invalidate project files cache so the file tree & editor reflect changes
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId, branchId),
        });

        setActiveSession((prev) =>
          prev
            ? {
                ...prev,
                status: 'COMPLETED',
                stagedFiles: prev.stagedFiles.map((sf) =>
                  !filePaths || filePaths.includes(sf.filePath)
                    ? { ...sf, isApplied: true }
                    : sf,
                ),
              }
            : null,
        );

        setDiffModalOpen(false);
        onFilesApplied?.();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Concurrency conflict or error occurred while applying staged files',
        );
        // Refresh session to pull updated hasConflict flags
        try {
          const fresh = await getAgentSession(projectId, branchId, activeSession.id);
          setActiveSession(fresh);
        } catch {
          // ignore
        }
      } finally {
        setIsApplying(false);
      }
    },
    [projectId, branchId, activeSession, queryClient, onFilesApplied],
  );

  /**
   * Discards staged files from the session quarantine buffer.
   */
  const discardStaged = useCallback(
    async (filePaths?: string[]) => {
      if (!branchId || !activeSession) return;
      setIsDiscarding(true);
      setError(null);

      try {
        await discardAgentStagedFiles(projectId, branchId, activeSession.id, {
          filePaths,
        });

        setActiveSession((prev) => {
          if (!prev) return null;
          const remaining = filePaths
            ? prev.stagedFiles.filter((sf) => !filePaths.includes(sf.filePath))
            : [];
          return { ...prev, stagedFiles: remaining };
        });

        setDiffModalOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to discard staged files');
      } finally {
        setIsDiscarding(false);
      }
    },
    [projectId, branchId, activeSession],
  );

  /**
   * Reloads the full session state from backend.
   */
  const loadSession = useCallback(
    async (sessionId: string) => {
      if (!branchId) return;
      try {
        const data = await getAgentSession(projectId, branchId, sessionId);
        setActiveSession(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      }
    },
    [projectId, branchId],
  );

  return {
    activeSession,
    isStarting,
    isStreaming,
    isApplying,
    isDiscarding,
    isCancelling,
    error,
    selfHealingCount,
    diffModalOpen,
    selectedStagedPath,
    setDiffModalOpen,
    setSelectedStagedPath,
    startSession,
    cancelSession,
    applyStaged,
    discardStaged,
    loadSession,
    clearError: () => setError(null),
  };
}
