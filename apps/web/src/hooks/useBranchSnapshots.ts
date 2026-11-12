import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import type {
  BranchRestoredPayload,
  BranchSnapshotSummaryDto,
  ClientToServerEvents,
  CreateSnapshotInput,
  RestoreSnapshotInput,
  RestoreSnapshotResultDto,
  ServerToClientEvents,
  SnapshotCreatedPayload,
} from '@codecollab/shared';
import { ApiClientError } from '@/lib/api';
import {
  createBranchSnapshot,
  deleteBranchSnapshot,
  fetchBranchSnapshots,
  queryKeys,
  restoreBranchSnapshot,
  type SnapshotListPage,
} from '@/lib/queries';

type TypedRealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface UseBranchSnapshotsOptions {
  socket: TypedRealtimeSocket | null;
  projectId: string;
  branchId: string | null;
  enabled: boolean;
  onBranchRestored?: (payload: BranchRestoredPayload) => void;
}

/**
 * Manages Day 5 branch snapshot history, live Socket.IO snapshot/restore events,
 * cursor pagination, and restore/delete mutations cleanly.
 */
export function useBranchSnapshots({
  socket,
  projectId,
  branchId,
  enabled,
  onBranchRestored,
}: UseBranchSnapshotsOptions) {
  const queryClient = useQueryClient();
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [lastRestoreNotice, setLastRestoreNotice] = useState<string | null>(
    null,
  );
  const [olderPages, setOlderPages] = useState<BranchSnapshotSummaryDto[]>([]);
  const [olderNextCursor, setOlderNextCursor] = useState<string | null>(null);
  const [hasLoadedMore, setHasLoadedMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const onBranchRestoredRef = useRef(onBranchRestored);
  onBranchRestoredRef.current = onBranchRestored;
  const seenRestoreKeysRef = useRef<Set<string>>(new Set());

  // Reset transient notices and extra pages when switching projects or branches
  useEffect(() => {
    setSnapshotError(null);
    setLastRestoreNotice(null);
    setOlderPages([]);
    setOlderNextCursor(null);
    setHasLoadedMore(false);
    seenRestoreKeysRef.current.clear();
  }, [projectId, branchId]);

  const listQuery = useQuery({
    queryKey: queryKeys.projects.snapshots(projectId, branchId ?? 'none'),
    queryFn: () => fetchBranchSnapshots(projectId, branchId!),
    enabled: Boolean(enabled && projectId && branchId),
  });

  // Merge first React Query page with manually fetched older cursor pages (deduplicated)
  const mergedSnapshots = (() => {
    const firstPage = listQuery.data?.snapshots ?? [];
    if (olderPages.length === 0) return firstPage;
    const seen = new Set(firstPage.map((s) => s.id));
    const tail = olderPages.filter((s) => !seen.has(s.id));
    return [...firstPage, ...tail];
  })();

  const effectiveNextCursor = hasLoadedMore
    ? olderNextCursor
    : (listQuery.data?.nextCursor ?? null);

  // Subscribe to real-time snapshot creation and branch restore broadcasts
  useEffect(() => {
    if (!socket || !enabled || !projectId || !branchId) return;

    const handleSnapshotCreated = (payload: SnapshotCreatedPayload) => {
      if (payload.projectId !== projectId || payload.branchId !== branchId) {
        return;
      }

      queryClient.setQueryData<SnapshotListPage>(
        queryKeys.projects.snapshots(projectId, branchId),
        (prev) => {
          if (!prev) {
            return {
              snapshots: [payload.snapshot],
              nextCursor: null,
              totalCount: 1,
            };
          }
          if (prev.snapshots.some((s) => s.id === payload.snapshot.id)) {
            return prev;
          }
          return {
            ...prev,
            snapshots: [payload.snapshot, ...prev.snapshots],
            ...(prev.totalCount !== undefined
              ? { totalCount: prev.totalCount + 1 }
              : {}),
          };
        },
      );
    };

    const handleBranchRestored = (payload: BranchRestoredPayload) => {
      if (payload.projectId !== projectId || payload.branchId !== branchId) {
        return;
      }

      const dedupKey = `${payload.restoredSnapshotId}:${payload.restoredAt}`;
      if (seenRestoreKeysRef.current.has(dedupKey)) {
        return;
      }
      seenRestoreKeysRef.current.add(dedupKey);
      if (seenRestoreKeysRef.current.size > 50) {
        const oldest = seenRestoreKeysRef.current.values().next().value;
        if (oldest) seenRestoreKeysRef.current.delete(oldest);
      }

      setLastRestoreNotice(
        `Branch restored to "${payload.restoredSnapshotTitle}" by @${payload.restoredByUsername}`,
      );
      onBranchRestoredRef.current?.(payload);

      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.snapshots(projectId, branchId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.files(projectId, branchId),
      });
    };

    socket.on('snapshot:created', handleSnapshotCreated);
    socket.on('branch:restored', handleBranchRestored);

    return () => {
      socket.off('snapshot:created', handleSnapshotCreated);
      socket.off('branch:restored', handleBranchRestored);
    };
  }, [socket, enabled, projectId, branchId, queryClient]);

  const createMutation = useMutation({
    mutationFn: (input: CreateSnapshotInput) =>
      createBranchSnapshot(projectId, branchId!, input),
    onSuccess: (created) => {
      setSnapshotError(null);
      if (branchId) {
        queryClient.setQueryData<SnapshotListPage>(
          queryKeys.projects.snapshots(projectId, branchId),
          (prev) => {
            if (!prev) {
              return { snapshots: [created], nextCursor: null, totalCount: 1 };
            }
            if (prev.snapshots.some((s) => s.id === created.id)) return prev;
            return {
              ...prev,
              snapshots: [created, ...prev.snapshots],
              ...(prev.totalCount !== undefined
                ? { totalCount: prev.totalCount + 1 }
                : {}),
            };
          },
        );
      }
    },
    onError: (err) => {
      setSnapshotError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to create branch snapshot',
      );
    },
  });

  const restoreMutation = useMutation({
    mutationFn: ({
      snapshotId,
      input,
    }: {
      snapshotId: string;
      input?: RestoreSnapshotInput;
    }) => restoreBranchSnapshot(projectId, branchId!, snapshotId, input),
    onSuccess: () => {
      setSnapshotError(null);
      if (branchId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.snapshots(projectId, branchId),
        });
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId, branchId),
        });
      }
    },
    onError: (err) => {
      setSnapshotError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to restore branch snapshot',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (snapshotId: string) =>
      deleteBranchSnapshot(projectId, branchId!, snapshotId),
    onSuccess: (_res, snapshotId) => {
      setSnapshotError(null);
      setOlderPages((prev) => prev.filter((s) => s.id !== snapshotId));
      if (branchId) {
        queryClient.setQueryData<SnapshotListPage>(
          queryKeys.projects.snapshots(projectId, branchId),
          (prev) =>
            prev
              ? {
                  ...prev,
                  snapshots: prev.snapshots.filter((s) => s.id !== snapshotId),
                  ...(prev.totalCount !== undefined
                    ? { totalCount: Math.max(0, prev.totalCount - 1) }
                    : {}),
                }
              : prev,
        );
      }
    },
    onError: (err) => {
      setSnapshotError(
        err instanceof ApiClientError
          ? err.message
          : 'Failed to delete branch snapshot',
      );
    },
  });

  const createSnapshot = useCallback(
    async (
      input: CreateSnapshotInput,
    ): Promise<BranchSnapshotSummaryDto | null> => {
      if (!projectId || !branchId) return null;
      try {
        return await createMutation.mutateAsync(input);
      } catch {
        return null;
      }
    },
    [branchId, createMutation, projectId],
  );

  const restoreSnapshot = useCallback(
    async (
      snapshotId: string,
      input?: RestoreSnapshotInput,
    ): Promise<RestoreSnapshotResultDto | null> => {
      if (!projectId || !branchId) return null;
      try {
        return await restoreMutation.mutateAsync({ snapshotId, input });
      } catch {
        return null;
      }
    },
    [branchId, projectId, restoreMutation],
  );

  const deleteSnapshot = useCallback(
    async (snapshotId: string): Promise<boolean> => {
      if (!projectId || !branchId) return false;
      try {
        await deleteMutation.mutateAsync(snapshotId);
        return true;
      } catch {
        return false;
      }
    },
    [branchId, deleteMutation, projectId],
  );

  const loadMoreSnapshots = useCallback(async () => {
    if (!projectId || !branchId || !effectiveNextCursor || isLoadingMore) {
      return;
    }
    setIsLoadingMore(true);
    try {
      const page = await fetchBranchSnapshots(projectId, branchId, {
        cursor: effectiveNextCursor,
      });
      setOlderPages((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = page.snapshots.filter((s) => !seen.has(s.id));
        return [...prev, ...next];
      });
      setOlderNextCursor(page.nextCursor);
      setHasLoadedMore(true);
    } catch (err) {
      setSnapshotError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to load older snapshots',
      );
    } finally {
      setIsLoadingMore(false);
    }
  }, [branchId, effectiveNextCursor, isLoadingMore, projectId]);

  const clearSnapshotError = useCallback(() => setSnapshotError(null), []);
  const clearRestoreNotice = useCallback(() => setLastRestoreNotice(null), []);

  return {
    snapshots: mergedSnapshots,
    totalCount: listQuery.data?.totalCount ?? mergedSnapshots.length,
    nextCursor: effectiveNextCursor,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    isLoadingMore,
    isCreating: createMutation.isPending,
    isRestoring: restoreMutation.isPending,
    isDeleting: deleteMutation.isPending,
    snapshotError,
    lastRestoreNotice,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    loadMoreSnapshots,
    clearSnapshotError,
    clearRestoreNotice,
    refetchSnapshots: () => void listQuery.refetch(),
  };
}
