import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BranchRestoredPayload,
  BranchSnapshotSummaryDto,
} from '@codecollab/shared';
import type { TypedClientSocket } from '@/hooks/useRealtimeCollab';
import { useBranchSnapshots } from '@/hooks/useBranchSnapshots';

const {
  fetchBranchSnapshotsMock,
  createBranchSnapshotMock,
  restoreBranchSnapshotMock,
  deleteBranchSnapshotMock,
} = vi.hoisted(() => ({
  fetchBranchSnapshotsMock: vi.fn(),
  createBranchSnapshotMock: vi.fn(),
  restoreBranchSnapshotMock: vi.fn(),
  deleteBranchSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queries')>();
  return {
    ...actual,
    fetchBranchSnapshots: fetchBranchSnapshotsMock,
    createBranchSnapshot: createBranchSnapshotMock,
    restoreBranchSnapshot: restoreBranchSnapshotMock,
    deleteBranchSnapshot: deleteBranchSnapshotMock,
  };
});

function makeSnap(
  id: string,
  title: string,
  branchId = 'branch-1',
): BranchSnapshotSummaryDto {
  return {
    id,
    projectId: 'proj-1',
    branchId,
    title,
    restoredFromSnapshotId: null,
    fileCount: 3,
    totalBytes: 256,
    createdBy: { id: 'user-1', username: 'alice' },
    createdAt: '2026-11-13T03:00:00.000Z',
  };
}

function createFakeSocket() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const socket = {
    connected: true,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
    }),
  };

  return {
    socket: socket as unknown as TypedClientSocket,
    trigger: (event: string, ...args: unknown[]) => {
      for (const fn of listeners.get(event) ?? []) {
        fn(...args);
      }
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      ),
  };
}

describe('useBranchSnapshots', () => {
  beforeEach(() => {
    fetchBranchSnapshotsMock.mockReset();
    createBranchSnapshotMock.mockReset();
    restoreBranchSnapshotMock.mockReset();
    deleteBranchSnapshotMock.mockReset();
  });

  it('loads snapshots, deduplicates live snapshot:created broadcasts, and ignores other branches', async () => {
    fetchBranchSnapshotsMock.mockResolvedValueOnce({
      snapshots: [makeSnap('s-1', 'Initial baseline')],
      nextCursor: null,
    });

    const { socket, trigger } = createFakeSocket();
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useBranchSnapshots({
          socket,
          projectId: 'proj-1',
          branchId: 'branch-1',
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.snapshots.map((s) => s.id)).toEqual(['s-1']);
    });

    const s2 = makeSnap('s-2', 'Live peer savepoint', 'branch-1');
    const otherBranchSnap = makeSnap('s-other', 'Wrong branch', 'branch-2');

    act(() => {
      trigger('snapshot:created', {
        projectId: 'proj-1',
        branchId: 'branch-1',
        snapshot: s2,
      });
      // Duplicate emission ignored
      trigger('snapshot:created', {
        projectId: 'proj-1',
        branchId: 'branch-1',
        snapshot: s2,
      });
      // Different branch ignored
      trigger('snapshot:created', {
        projectId: 'proj-1',
        branchId: 'branch-2',
        snapshot: otherBranchSnap,
      });
    });

    await waitFor(() => {
      expect(result.current.snapshots.map((s) => s.id)).toEqual(['s-2', 's-1']);
    });
  });

  it('forwards branch:restored events with deletedFileIds once per restore and exposes lastRestoreNotice', async () => {
    fetchBranchSnapshotsMock.mockResolvedValue({
      snapshots: [makeSnap('s-1', 'Clean V1')],
      nextCursor: null,
    });

    const onBranchRestored = vi.fn();
    const { socket, trigger } = createFakeSocket();
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useBranchSnapshots({
          socket,
          projectId: 'proj-1',
          branchId: 'branch-1',
          enabled: true,
          onBranchRestored,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.snapshots).toHaveLength(1);
    });

    const restorePayload: BranchRestoredPayload = {
      projectId: 'proj-1',
      branchId: 'branch-1',
      restoredSnapshotId: 's-1',
      restoredSnapshotTitle: 'Clean V1',
      restoredByUserId: 'user-owner',
      restoredByUsername: 'yash',
      safetySnapshotId: 's-backup',
      deletedFileIds: ['file-temp-1', 'file-temp-2'],
      restoredAt: '2026-11-13T03:05:00.000Z',
    };

    act(() => {
      trigger('branch:restored', restorePayload);
      trigger('branch:restored', restorePayload);
    });

    expect(onBranchRestored).toHaveBeenCalledTimes(1);
    expect(onBranchRestored).toHaveBeenCalledWith(restorePayload);
    expect(result.current.lastRestoreNotice).toContain('Clean V1');
    expect(result.current.lastRestoreNotice).toContain('@yash');
  });

  it('supports createSnapshot, cursor loadMoreSnapshots, and deleteSnapshot', async () => {
    fetchBranchSnapshotsMock
      .mockResolvedValueOnce({
        snapshots: [makeSnap('s-2', 'Newer')],
        nextCursor: 's-2',
      })
      .mockResolvedValueOnce({
        snapshots: [makeSnap('s-1', 'Older')],
        nextCursor: null,
      });

    const createdSnap = makeSnap('s-3', 'Created now');
    createBranchSnapshotMock.mockResolvedValueOnce(createdSnap);
    deleteBranchSnapshotMock.mockResolvedValueOnce({ deleted: true });

    const { socket } = createFakeSocket();
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useBranchSnapshots({
          socket,
          projectId: 'proj-1',
          branchId: 'branch-1',
          enabled: true,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.snapshots.map((s) => s.id)).toEqual(['s-2']);
    });

    await act(async () => {
      await result.current.loadMoreSnapshots();
    });
    expect(result.current.snapshots.map((s) => s.id)).toEqual(['s-2', 's-1']);
    expect(result.current.nextCursor).toBeNull();

    await act(async () => {
      const res = await result.current.createSnapshot({ title: 'Created now' });
      expect(res?.id).toBe('s-3');
    });
    expect(result.current.snapshots.map((s) => s.id)).toEqual([
      's-3',
      's-2',
      's-1',
    ]);

    await act(async () => {
      const ok = await result.current.deleteSnapshot('s-3');
      expect(ok).toBe(true);
    });
    await waitFor(() => {
      expect(result.current.snapshots.map((s) => s.id)).toEqual(['s-2', 's-1']);
    });
  });
});
