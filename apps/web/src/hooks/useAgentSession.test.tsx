import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentSessionDetailDto,
  AgentStagedFileDto,
} from '@codecollab/shared';
import { useAgentSession } from '@/hooks/useAgentSession';

// Mock API layer
const {
  createAgentSessionMock,
  getAgentSessionMock,
  applyAgentStagedFilesMock,
  discardAgentStagedFilesMock,
  cancelAgentSessionMock,
  streamAgentSessionMock,
} = vi.hoisted(() => ({
  createAgentSessionMock: vi.fn(),
  getAgentSessionMock: vi.fn(),
  applyAgentStagedFilesMock: vi.fn(),
  discardAgentStagedFilesMock: vi.fn(),
  cancelAgentSessionMock: vi.fn(),
  streamAgentSessionMock: vi.fn(),
}));

vi.mock('@/api/agent', () => ({
  createAgentSession: createAgentSessionMock,
  getAgentSession: getAgentSessionMock,
  applyAgentStagedFiles: applyAgentStagedFilesMock,
  discardAgentStagedFiles: discardAgentStagedFilesMock,
  cancelAgentSession: cancelAgentSessionMock,
  streamAgentSession: streamAgentSessionMock,
}));

function createMockSession(overrides: Partial<AgentSessionDetailDto> = {}): AgentSessionDetailDto {
  return {
    id: 'session-123',
    projectId: 'proj-1',
    branchId: 'branch-1',
    userId: 'user-1',
    title: 'Test Autonomous Workflow',
    prompt: 'Implement auth validation',
    status: 'PLANNING',
    model: 'gemini-1.5-pro',
    totalInputTokens: 100,
    totalOutputTokens: 200,
    selfHealingAttempts: 0,
    maxSelfHealingAttempts: 3,
    errorMessage: null,
    expiresAt: null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [],
    toolCalls: [],
    stagedFiles: [],
    ...overrides,
  };
}

describe('useAgentSession hook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  function createWrapper() {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  it('initializes with default empty state', () => {
    const { result } = renderHook(
      () => useAgentSession({ projectId: 'proj-1', branchId: 'branch-1' }),
      { wrapper: createWrapper() },
    );

    expect(result.current.activeSession).toBeNull();
    expect(result.current.isStarting).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.selfHealingCount).toBe(0);
    expect(result.current.diffModalOpen).toBe(false);
  });

  it('launches agent session and decodes streaming plan & tool events', async () => {
    const mockSession = createMockSession({
      steps: [
        {
          id: 'step-1',
          sessionId: 'session-123',
          stepNumber: 1,
          title: 'Analyze codebase',
          description: 'Inspect existing auth files',
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    createAgentSessionMock.mockResolvedValueOnce(mockSession);

    // Mock stream execution that emits events
    streamAgentSessionMock.mockImplementationOnce(
      async (_projId, _bId, _sId, callbacks) => {
        // 1. Step starts
        callbacks.onEvent({
          type: 'step_started',
          sessionId: 'session-123',
          stepNumber: 1,
          title: 'Analyze codebase',
        });

        // 2. Tool call starts & completes
        callbacks.onEvent({
          type: 'tool_call_started',
          sessionId: 'session-123',
          toolCallId: 'tool-1',
          toolName: 'read_file',
          input: { filePath: 'src/auth.ts' },
        });

        callbacks.onEvent({
          type: 'tool_call_finished',
          sessionId: 'session-123',
          toolCallId: 'tool-1',
          toolName: 'read_file',
          status: 'SUCCESS',
          durationMs: 42,
          output: { content: 'export const auth = () => {}' },
        });

        // 3. File staged
        const staged: AgentStagedFileDto = {
          id: 'staged-1',
          sessionId: 'session-123',
          filePath: 'src/middleware.ts',
          changeType: 'CREATE',
          originalContent: null,
          stagedContent: 'export const middleware = true;',
          originalVersion: 1,
          originalContentHash: 'hash123',
          isApplied: false,
          hasConflict: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        callbacks.onEvent({
          type: 'file_staged',
          sessionId: 'session-123',
          file: staged,
        });

        // 4. Step completes
        callbacks.onEvent({
          type: 'step_completed',
          sessionId: 'session-123',
          stepNumber: 1,
          status: 'COMPLETED',
        });

        // 5. Done
        callbacks.onEvent({
          type: 'done',
          sessionId: 'session-123',
          status: 'AWAITING_REVIEW',
          totalFilesStaged: 1,
        });

        callbacks.onDone?.();
      },
    );

    const { result } = renderHook(
      () => useAgentSession({ projectId: 'proj-1', branchId: 'branch-1' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.startSession('Add middleware');
    });

    expect(createAgentSessionMock).toHaveBeenCalledWith('proj-1', 'branch-1', {
      prompt: 'Add middleware',
      title: undefined,
      model: undefined,
    });

    expect(result.current.activeSession).not.toBeNull();
    expect(result.current.activeSession?.status).toBe('AWAITING_REVIEW');
    expect(result.current.activeSession?.steps[0].status).toBe('COMPLETED');
    expect(result.current.activeSession?.toolCalls).toHaveLength(1);
    expect(result.current.activeSession?.toolCalls[0].status).toBe('SUCCESS');
    expect(result.current.activeSession?.stagedFiles).toHaveLength(1);
    expect(result.current.activeSession?.stagedFiles[0].filePath).toBe('src/middleware.ts');
  });

  it('handles self-healing event loop during execution', async () => {
    const mockSession = createMockSession();
    createAgentSessionMock.mockResolvedValueOnce(mockSession);

    streamAgentSessionMock.mockImplementationOnce(
      async (_projId, _bId, _sId, callbacks) => {
        callbacks.onEvent({
          type: 'self_healing_attempt',
          sessionId: 'session-123',
          attempt: 1,
          maxAttempts: 3,
          errorSummary: 'TS2304: Cannot find name "express"',
        });
      },
    );

    const { result } = renderHook(
      () => useAgentSession({ projectId: 'proj-1', branchId: 'branch-1' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.startSession('Fix bugs');
    });

    expect(result.current.selfHealingCount).toBe(1);
    expect(result.current.activeSession?.status).toBe('SELF_HEALING');
  });

  it('atomically applies staged files and updates cache and local session', async () => {
    const mockSession = createMockSession({
      status: 'AWAITING_REVIEW',
      stagedFiles: [
        {
          id: 'staged-1',
          sessionId: 'session-123',
          filePath: 'src/auth.ts',
          changeType: 'MODIFY',
          originalContent: '// old',
          stagedContent: '// new',
          isApplied: false,
          hasConflict: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });

    applyAgentStagedFilesMock.mockResolvedValueOnce({
      appliedCount: 1,
      sessionStatus: 'COMPLETED',
    });

    const onFilesApplied = vi.fn();
    const { result } = renderHook(
      () =>
        useAgentSession({
          projectId: 'proj-1',
          branchId: 'branch-1',
          onFilesApplied,
        }),
      { wrapper: createWrapper() },
    );

    // Manually set active session for apply test
    act(() => {
      (result.current as unknown as { setActiveSession: (s: AgentSessionDetailDto) => void })
        ;
    });

    // Simulate session started
    createAgentSessionMock.mockResolvedValueOnce(mockSession);
    await act(async () => {
      await result.current.startSession('Update auth');
    });

    await act(async () => {
      await result.current.applyStaged();
    });

    expect(applyAgentStagedFilesMock).toHaveBeenCalledWith('proj-1', 'branch-1', 'session-123', {
      filePaths: undefined,
    });
    expect(result.current.activeSession?.status).toBe('COMPLETED');
    expect(result.current.activeSession?.stagedFiles[0].isApplied).toBe(true);
    expect(onFilesApplied).toHaveBeenCalled();
  });

  it('cancels active session and stops stream', async () => {
    const mockSession = createMockSession({ status: 'EXECUTING' });
    createAgentSessionMock.mockResolvedValueOnce(mockSession);
    cancelAgentSessionMock.mockResolvedValueOnce({
      id: 'session-123',
      projectId: 'proj-1',
      branchId: 'branch-1',
      userId: 'user-1',
      title: 'Test',
      prompt: 'Test',
      status: 'CANCELLED',
      model: 'gemini-1.5-pro',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      selfHealingAttempts: 0,
      maxSelfHealingAttempts: 3,
      totalSteps: 1,
      completedSteps: 0,
      stagedFilesCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const { result } = renderHook(
      () => useAgentSession({ projectId: 'proj-1', branchId: 'branch-1' }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      await result.current.startSession('Long running task');
    });

    await act(async () => {
      await result.current.cancelSession();
    });

    expect(cancelAgentSessionMock).toHaveBeenCalledWith('proj-1', 'branch-1', 'session-123');
    expect(result.current.activeSession?.status).toBe('CANCELLED');
    expect(result.current.isStreaming).toBe(false);
  });
});
