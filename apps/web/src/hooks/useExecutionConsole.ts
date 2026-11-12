import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXECUTION_LIMITS,
  getUtf8ByteLength,
  type CreateExecutionRunInput,
  type ExecutionLifecyclePayload,
  type ExecutionRunDto,
  type ExecutionStreamChunkPayload,
  type SupportedLanguage,
} from '@codecollab/shared';
import type { TypedClientSocket } from '@/hooks/useRealtimeCollab';
import { ApiClientError } from '@/lib/api';
import {
  cancelExecutionRun,
  createExecutionRun,
  fetchBranchExecutionRuns,
  fetchExecutionRunDetail,
  queryKeys,
} from '@/lib/queries';

export interface ConsoleOutputSegment {
  id: string;
  stream: 'stdout' | 'stderr' | 'stdin' | 'system';
  text: string;
}

interface UseExecutionConsoleParams {
  socket: TypedClientSocket | null;
  projectId: string;
  branchId: string | null;
  activeRunId: string | null;
  enabled: boolean;
  onSelectRun: (runId: string | null) => void;
  onOpenConsole?: () => void;
}

const isTerminalStatus = (status: ExecutionRunDto['status']): boolean =>
  status === 'COMPLETED' ||
  status === 'FAILED' ||
  status === 'TIMEOUT' ||
  status === 'CANCELLED';

const buildSegmentsFromRun = (run: ExecutionRunDto): ConsoleOutputSegment[] => {
  const segments: ConsoleOutputSegment[] = [];
  if (run.stdout) {
    segments.push({
      id: `${run.id}:persisted-stdout`,
      stream: 'stdout',
      text: run.stdout,
    });
  }
  if (run.stderr) {
    segments.push({
      id: `${run.id}:persisted-stderr`,
      stream: 'stderr',
      text: run.stderr,
    });
  }
  return segments;
};

/**
 * Manages isolated Docker code execution runs, live Socket.IO stdout/stderr streaming
 * with sequence-number deduplication, interactive stdin transmission, and branch run history.
 */
export function useExecutionConsole({
  socket,
  projectId,
  branchId,
  activeRunId,
  enabled,
  onSelectRun,
  onOpenConsole,
}: UseExecutionConsoleParams) {
  const queryClient = useQueryClient();

  const [activeRun, setActiveRun] = useState<ExecutionRunDto | null>(null);
  const [segments, setSegments] = useState<ConsoleOutputSegment[]>([]);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  const activeRunIdRef = useRef<string | null>(activeRunId);
  activeRunIdRef.current = activeRunId;
  const activeRunFileIdRef = useRef<string | null>(null);
  activeRunFileIdRef.current = activeRun?.fileId ?? null;
  const onSelectRunRef = useRef(onSelectRun);
  onSelectRunRef.current = onSelectRun;
  const lastChunkSeqRef = useRef<number>(0);
  const segmentSeqRef = useRef<number>(0);
  const seededRunIdRef = useRef<string | null>(null);

  // Branch execution history (ACL-filtered by server)
  const runsQuery = useQuery({
    queryKey: queryKeys.projects.runs(projectId, branchId ?? 'none'),
    queryFn: () => fetchBranchExecutionRuns(projectId, branchId!),
    enabled: Boolean(enabled && projectId && branchId),
  });

  const runs = useMemo(() => runsQuery.data ?? [], [runsQuery.data]);

  // Clear local stream state ONLY when activeRunId changes
  useEffect(() => {
    setConsoleError(null);
    lastChunkSeqRef.current = 0;
    seededRunIdRef.current = null;

    if (!activeRunId) {
      setActiveRun(null);
      setSegments([]);
      setElapsedMs(0);
    }
  }, [activeRunId]);

  // Optimistically seed from history list ONCE per activeRunId if live/REST hasn't populated it yet
  useEffect(() => {
    if (!activeRunId || seededRunIdRef.current === activeRunId) return;

    const cached = runs.find((r) => r.id === activeRunId) ?? null;
    if (cached) {
      seededRunIdRef.current = activeRunId;
      setActiveRun((prev) => prev ?? cached);
      setSegments((prev) => (prev.length > 0 ? prev : buildSegmentsFromRun(cached)));
      setElapsedMs((prev) => (prev > 0 ? prev : cached.durationMs ?? 0));
    }
  }, [activeRunId, runs]);

  // Fallback REST fetch if run isn't hydrated yet or socket is disconnected
  useEffect(() => {
    if (!enabled || !projectId || !activeRunId) return;
    let cancelled = false;

    void fetchExecutionRunDetail(projectId, activeRunId)
      .then((detail) => {
        if (cancelled || activeRunIdRef.current !== detail.id) return;
        setActiveRun((prev) => {
          // Don't clobber live chunks already received beyond DB snapshot
          if (
            prev &&
            prev.id === detail.id &&
            lastChunkSeqRef.current > 0 &&
            prev.status === 'RUNNING' &&
            detail.status === 'RUNNING'
          ) {
            return prev;
          }
          setSegments(buildSegmentsFromRun(detail));
          return detail;
        });
        if (detail.durationMs !== null) {
          setElapsedMs(detail.durationMs);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError) {
          if (
            err.statusCode === 401 ||
            err.statusCode === 403 ||
            err.statusCode === 404
          ) {
            setActiveRun(null);
            setSegments([]);
            setElapsedMs(0);
          }
          setConsoleError(err.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeRunId, enabled, projectId]);

  // Live elapsed stopwatch while QUEUED or RUNNING
  useEffect(() => {
    if (!activeRun || isTerminalStatus(activeRun.status)) {
      if (activeRun?.durationMs !== null && activeRun?.durationMs !== undefined) {
        setElapsedMs(activeRun.durationMs);
      }
      return;
    }

    const anchorIso = activeRun.startedAt ?? activeRun.createdAt;
    const anchorMs = Date.parse(anchorIso);
    if (!Number.isFinite(anchorMs)) return;

    const tick = () => {
      setElapsedMs(Math.max(0, Date.now() - anchorMs));
    };
    tick();
    const timer = window.setInterval(tick, 100);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  // Multiplex Socket.IO execution room events on shared studio socket
  useEffect(() => {
    if (!socket || !enabled || !projectId) return;

    const joinRunRoom = (runId: string) => {
      if (!socket.connected) return;
      socket.emit('execution:join', { projectId, runId }, (ack) => {
        if (activeRunIdRef.current !== runId) return;
        if (!ack?.ok || !ack.data) {
          if (ack?.error) {
            setConsoleError(ack.error.message);
          }
          return;
        }
        seededRunIdRef.current = runId;
        lastChunkSeqRef.current = ack.data.lastChunkSeq;
        setActiveRun(ack.data.run);
        setSegments((prev) => {
          // Replace with authoritative DB snapshot on join/reconnect unless we already have stdin echoes?
          // Rebuild cleanly from persisted DB snapshot and keep sync clean from `lastChunkSeq` onward.
          const persisted = buildSegmentsFromRun(ack.data!.run);
          return persisted.length > 0 ? persisted : prev.filter((s) => s.stream === 'stdin');
        });
        if (ack.data.run.durationMs !== null) {
          setElapsedMs(ack.data.run.durationMs);
        }
      });
    };

    const handleConnect = () => {
      if (activeRunIdRef.current) {
        joinRunRoom(activeRunIdRef.current);
      }
    };

    const handleQueued = (run: ExecutionRunDto) => {
      if (run.projectId !== projectId) return;
      if (branchId && run.branchId === branchId) {
        queryClient.setQueryData<ExecutionRunDto[]>(
          queryKeys.projects.runs(projectId, branchId),
          (prev) => {
            const list = prev ?? [];
            if (list.some((item) => item.id === run.id)) return list;
            return [run, ...list].slice(0, 30);
          },
        );
      }
      if (activeRunIdRef.current === run.id) {
        setActiveRun(run);
      }
    };

    const handleStarted = (payload: ExecutionLifecyclePayload) => {
      if (payload.projectId !== projectId) return;
      if (activeRunIdRef.current === payload.runId) {
        setActiveRun((prev) =>
          prev
            ? {
                ...prev,
                status: 'RUNNING',
                startedAt: payload.startedAt,
              }
            : prev,
        );
      }
      if (branchId && payload.branchId === branchId) {
        queryClient.setQueryData<ExecutionRunDto[]>(
          queryKeys.projects.runs(projectId, branchId),
          (prev) =>
            prev?.map((item) =>
              item.id === payload.runId
                ? { ...item, status: 'RUNNING', startedAt: payload.startedAt }
                : item,
            ),
        );
      }
    };

    const handleChunk =
      (stream: 'stdout' | 'stderr') =>
      (payload: ExecutionStreamChunkPayload) => {
        if (payload.runId !== activeRunIdRef.current) return;
        if (payload.seq <= lastChunkSeqRef.current) {
          return;
        }
        lastChunkSeqRef.current = payload.seq;
        segmentSeqRef.current += 1;

        setSegments((prev) => [
          ...prev,
          {
            id: `${payload.runId}:${payload.seq}:${segmentSeqRef.current}`,
            stream,
            text: payload.chunk,
          },
        ]);

        if (payload.truncated) {
          setActiveRun((prev) =>
            prev
              ? {
                  ...prev,
                  ...(stream === 'stdout'
                    ? { stdoutTruncated: true }
                    : { stderrTruncated: true }),
                }
              : prev,
          );
        }
      };

    const handleTerminal = (payload: ExecutionLifecyclePayload) => {
      if (payload.projectId !== projectId) return;

      if (activeRunIdRef.current === payload.runId) {
        setActiveRun((prev) =>
          prev
            ? {
                ...prev,
                status: payload.status,
                exitCode: payload.exitCode,
                failureKind: payload.failureKind,
                errorMessage: payload.errorMessage,
                durationMs: payload.durationMs,
                startedAt: payload.startedAt ?? prev.startedAt,
                endedAt: payload.endedAt,
                stdoutTruncated: payload.stdoutTruncated,
                stderrTruncated: payload.stderrTruncated,
              }
            : prev,
        );
        if (payload.durationMs !== null) {
          setElapsedMs(payload.durationMs);
        }
      }

      if (branchId && payload.branchId === branchId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.runs(projectId, branchId),
        });
      }
    };

    const handleRealtimeError = (err: {
      code: string;
      message: string;
      projectId?: string;
      fileId?: string;
      runId?: string;
    }) => {
      if (
        err.code === 'UNAUTHORIZED' ||
        ((err.code === 'PROJECT_FORBIDDEN' || err.code === 'PROJECT_NOT_FOUND') &&
          (!err.projectId || err.projectId === projectId))
      ) {
        seededRunIdRef.current = activeRunIdRef.current;
        setActiveRun(null);
        setSegments([]);
        setElapsedMs(0);
        lastChunkSeqRef.current = 0;
        if (branchId) {
          queryClient.removeQueries({
            queryKey: queryKeys.projects.runs(projectId, branchId),
          });
        }
        setConsoleError(err.message);
        return;
      }

      if (
        err.code === 'FILE_ACCESS_DENIED' &&
        ((err.runId && err.runId === activeRunIdRef.current) ||
          (err.fileId && err.fileId === activeRunFileIdRef.current))
      ) {
        seededRunIdRef.current = activeRunIdRef.current;
        setActiveRun(null);
        setSegments([]);
        setElapsedMs(0);
        lastChunkSeqRef.current = 0;
        onSelectRunRef.current(null);
        setConsoleError(err.message);
        return;
      }

      if (err.runId && err.runId === activeRunIdRef.current) {
        setConsoleError(err.message);
      }
    };

    const onStdout = handleChunk('stdout');
    const onStderr = handleChunk('stderr');

    socket.on('connect', handleConnect);
    socket.on('execution:queued', handleQueued);
    socket.on('execution:started', handleStarted);
    socket.on('execution:stdout', onStdout);
    socket.on('execution:stderr', onStderr);
    socket.on('execution:completed', handleTerminal);
    socket.on('execution:failed', handleTerminal);
    socket.on('execution:timeout', handleTerminal);
    socket.on('execution:cancelled', handleTerminal);
    socket.on('realtime:error', handleRealtimeError);

    if (activeRunId) {
      joinRunRoom(activeRunId);
    }

    return () => {
      if (activeRunId && socket.connected) {
        socket.emit('execution:leave', { runId: activeRunId });
      }
      socket.off('connect', handleConnect);
      socket.off('execution:queued', handleQueued);
      socket.off('execution:started', handleStarted);
      socket.off('execution:stdout', onStdout);
      socket.off('execution:stderr', onStderr);
      socket.off('execution:completed', handleTerminal);
      socket.off('execution:failed', handleTerminal);
      socket.off('execution:timeout', handleTerminal);
      socket.off('execution:cancelled', handleTerminal);
      socket.off('realtime:error', handleRealtimeError);
    };
  }, [activeRunId, branchId, enabled, projectId, queryClient, socket]);

  // Create Run Mutation
  const createRunMutation = useMutation({
    mutationFn: (input: CreateExecutionRunInput) => {
      if (!branchId) {
        throw new Error('Select a branch before executing code');
      }
      return createExecutionRun(projectId, branchId, input);
    },
    onSuccess: (created) => {
      setConsoleError(null);
      lastChunkSeqRef.current = 0;
      setSegments([]);
      setElapsedMs(0);
      setActiveRun(created);
      onSelectRun(created.id);
      onOpenConsole?.();

      if (branchId) {
        queryClient.setQueryData<ExecutionRunDto[]>(
          queryKeys.projects.runs(projectId, branchId),
          (prev) => {
            const list = prev ?? [];
            if (list.some((item) => item.id === created.id)) return list;
            return [created, ...list].slice(0, 30);
          },
        );
      }
    },
    onError: (err) => {
      onOpenConsole?.();
      setConsoleError(
        err instanceof Error ? err.message : 'Unable to start code execution',
      );
    },
  });

  // Cancel Run Mutation
  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => cancelExecutionRun(projectId, runId),
    onSuccess: (updated) => {
      setConsoleError(null);
      if (activeRunIdRef.current === updated.id) {
        setActiveRun(updated);
      }
      if (branchId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.runs(projectId, branchId),
        });
      }
    },
    onError: (err) => {
      setConsoleError(
        err instanceof Error ? err.message : 'Unable to cancel execution run',
      );
    },
  });

  const runCode = useCallback(
    async (params: {
      language: SupportedLanguage;
      fileId?: string | null;
      entryFileName?: string;
      sourceCode: string;
    }) => {
      if (params.sourceCode.length > EXECUTION_LIMITS.MAX_SOURCE_CHARS) {
        setConsoleError(
          `Source file exceeds ${EXECUTION_LIMITS.MAX_SOURCE_CHARS.toLocaleString()} character execution limit`,
        );
        onOpenConsole?.();
        return;
      }

      await createRunMutation.mutateAsync({
        language: params.language,
        ...(params.fileId ? { fileId: params.fileId } : {}),
        ...(params.entryFileName ? { entryFileName: params.entryFileName } : {}),
        sourceCode: params.sourceCode,
      });
    },
    [createRunMutation, onOpenConsole],
  );

  const cancelActiveRun = useCallback(() => {
    if (!activeRunId) return;
    cancelRunMutation.mutate(activeRunId);
  }, [activeRunId, cancelRunMutation]);

  const sendStdin = useCallback(
    (rawInput: string, appendNewline = true): Promise<boolean> => {
      return new Promise((resolve) => {
        if (!activeRunId || !socket || !socket.connected) {
          setConsoleError('Live execution socket is disconnected');
          resolve(false);
          return;
        }

        const payloadData = appendNewline ? `${rawInput}\n` : rawInput;
        if (!payloadData) {
          resolve(false);
          return;
        }

        if (getUtf8ByteLength(payloadData) > EXECUTION_LIMITS.MAX_STDIN_CHUNK_BYTES) {
          setConsoleError(
            `Stdin line exceeds ${EXECUTION_LIMITS.MAX_STDIN_CHUNK_BYTES} byte chunk limit`,
          );
          resolve(false);
          return;
        }

        socket.emit(
          'execution:stdin',
          { runId: activeRunId, data: payloadData },
          (ack) => {
            if (!ack?.ok) {
              setConsoleError(ack?.error?.message ?? 'Failed to deliver stdin');
              resolve(false);
              return;
            }
            setConsoleError(null);
            segmentSeqRef.current += 1;
            setSegments((prev) => [
              ...prev,
              {
                id: `${activeRunId}:stdin:${segmentSeqRef.current}`,
                stream: 'stdin',
                text: payloadData,
              },
            ]);
            resolve(true);
          },
        );
      });
    },
    [activeRunId, socket],
  );

  const clearConsoleError = useCallback(() => setConsoleError(null), []);

  const clearOutputSegments = useCallback(() => {
    setSegments([]);
  }, []);

  return {
    runs,
    runsLoading: runsQuery.isLoading,
    activeRun,
    segments,
    elapsedMs,
    consoleError,
    isStarting: createRunMutation.isPending,
    isCancelling: cancelRunMutation.isPending,
    runCode,
    cancelActiveRun,
    sendStdin,
    clearConsoleError,
    clearOutputSegments,
    refetchRuns: runsQuery.refetch,
  };
}
