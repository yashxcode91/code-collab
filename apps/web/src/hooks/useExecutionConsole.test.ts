import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionRunDto } from '@codecollab/shared';
import type { TypedClientSocket } from '@/hooks/useRealtimeCollab';
import { useExecutionConsole } from '@/hooks/useExecutionConsole';

const {
  fetchBranchExecutionRunsMock,
  fetchExecutionRunDetailMock,
  createExecutionRunMock,
  cancelExecutionRunMock,
} = vi.hoisted(() => ({
  fetchBranchExecutionRunsMock: vi.fn(),
  fetchExecutionRunDetailMock: vi.fn(),
  createExecutionRunMock: vi.fn(),
  cancelExecutionRunMock: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  queryKeys: {
    projects: {
      runs: (projectId: string, branchId: string) =>
        ['projects', projectId, 'branches', branchId, 'runs'] as const,
    },
  },
  fetchBranchExecutionRuns: fetchBranchExecutionRunsMock,
  fetchExecutionRunDetail: fetchExecutionRunDetailMock,
  createExecutionRun: createExecutionRunMock,
  cancelExecutionRun: cancelExecutionRunMock,
}));

function makeRun(overrides: Partial<ExecutionRunDto> = {}): ExecutionRunDto {
  return {
    id: 'run-1',
    projectId: 'proj-1',
    branchId: 'br-1',
    fileId: 'file-1',
    userId: 'user-me',
    language: 'python',
    status: 'RUNNING',
    entryFileName: 'main.py',
    stdout: 'boot\n',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    exitCode: null,
    failureKind: null,
    errorMessage: null,
    durationMs: null,
    startedAt: '2026-11-13T00:00:00.000Z',
    endedAt: null,
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
    triggeredBy: { id: 'user-me', username: 'yash' },
    ...overrides,
  };
}

function createFakeSocket(runSnapshot: ExecutionRunDto, lastChunkSeq = 2) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitSpy = vi.fn((event: string, _payload: unknown, ack?: unknown) => {
    if (event === 'execution:join' && typeof ack === 'function') {
      ack({ ok: true, data: { run: runSnapshot, lastChunkSeq } });
    }
    if (event === 'execution:stdin' && typeof ack === 'function') {
      ack({ ok: true });
    }
  });

  const socket = {
    connected: true,
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(fn);
    }),
    emit: emitSpy,
  };

  return {
    socket: socket as unknown as TypedClientSocket,
    emitSpy,
    trigger: (event: string, payload: unknown) => {
      for (const fn of listeners.get(event) ?? []) {
        fn(payload);
      }
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe('useExecutionConsole', () => {
  beforeEach(() => {
    fetchBranchExecutionRunsMock.mockReset();
    fetchExecutionRunDetailMock.mockReset();
    createExecutionRunMock.mockReset();
    cancelExecutionRunMock.mockReset();
  });

  it('deduplicates stale/replayed stdout chunks using lastChunkSeqRef and enforces UTF-8 stdin byte ceiling', async () => {
    const run = makeRun({ status: 'RUNNING', stdout: 'boot\n' });
    fetchBranchExecutionRunsMock.mockResolvedValue([run]);
    fetchExecutionRunDetailMock.mockResolvedValue({ ...run, sourceCode: 'print(1)' });

    const fake = createFakeSocket(run, 2);
    const { wrapper } = createWrapper();
    const onSelectRun = vi.fn();

    const { result } = renderHook(
      () =>
        useExecutionConsole({
          socket: fake.socket,
          projectId: 'proj-1',
          branchId: 'br-1',
          activeRunId: 'run-1',
          enabled: true,
          onSelectRun,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.activeRun?.id).toBe('run-1');
    });

    // seq <= 2 must be skipped; seq 3 & 4 append cleanly
    act(() => {
      fake.trigger('execution:stdout', {
        runId: 'run-1',
        projectId: 'proj-1',
        seq: 2,
        chunk: 'stale-replay\n',
        truncated: false,
      });
      fake.trigger('execution:stdout', {
        runId: 'run-1',
        projectId: 'proj-1',
        seq: 3,
        chunk: 'live-line-3\n',
        truncated: false,
      });
    });

    expect(result.current.segments.map((s) => s.text)).toEqual([
      'boot\n',
      'live-line-3\n',
    ]);

    // Multi-byte UTF-8 bomb (> 4096 bytes) rejected locally without socket emission
    let ok = true;
    await act(async () => {
      ok = await result.current.sendStdin('😀'.repeat(1200), false);
    });
    expect(ok).toBe(false);
    expect(result.current.consoleError).toContain('4096 byte chunk limit');
    expect(
      fake.emitSpy.mock.calls.some(([ev]) => ev === 'execution:stdin')
    ).toBe(false);

    // Valid stdin emits cleanly and echoes local stdin segment
    await act(async () => {
      ok = await result.current.sendStdin('Alice', true);
    });
    expect(ok).toBe(true);
    expect(result.current.segments.map((s) => s.stream)).toContain('stdin');
  });

  it('wipes activeRun, terminal segments, and selects null when FILE_ACCESS_DENIED eviction arrives (VULN-01)', async () => {
    const run = makeRun({ id: 'run-secret', fileId: 'file-secret' });
    fetchBranchExecutionRunsMock.mockResolvedValue([run]);
    fetchExecutionRunDetailMock.mockResolvedValue({ ...run, sourceCode: 'print(1)' });

    const fake = createFakeSocket(run, 1);
    const { wrapper } = createWrapper();
    const onSelectRun = vi.fn();

    const { result } = renderHook(
      () =>
        useExecutionConsole({
          socket: fake.socket,
          projectId: 'proj-1',
          branchId: 'br-1',
          activeRunId: 'run-secret',
          enabled: true,
          onSelectRun,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.activeRun?.id).toBe('run-secret');
    });

    act(() => {
      fake.trigger('realtime:error', {
        code: 'FILE_ACCESS_DENIED',
        message: 'Your access to this executed file has been revoked',
        projectId: 'proj-1',
        runId: 'run-secret',
        fileId: 'file-secret',
      });
    });

    expect(result.current.activeRun).toBeNull();
    expect(result.current.segments).toEqual([]);
    expect(result.current.consoleError).toContain('revoked');
    expect(onSelectRun).toHaveBeenCalledWith(null);
  });
});
