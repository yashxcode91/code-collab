import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSessionDetailDto } from '@codecollab/shared';
import { StudioAgentDrawer } from '@/components/studio-ide/StudioAgentDrawer';
import { ThemeProvider } from '@/context/ThemeContext';

afterEach(() => {
  cleanup();
});

// Mock Monaco DiffEditor
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="mock-monaco-diff-editor">Monaco Diff Editor</div>,
}));

// Mock useAgentSession
const mockStartSession = vi.fn();
const mockCancelSession = vi.fn();
const mockApplyStaged = vi.fn();
const mockDiscardStaged = vi.fn();
let mockActiveSession: AgentSessionDetailDto | null = null;
let mockIsStarting = false;
let mockIsStreaming = false;

vi.mock('@/hooks/useAgentSession', () => ({
  useAgentSession: () => ({
    activeSession: mockActiveSession,
    isStarting: mockIsStarting,
    isStreaming: mockIsStreaming,
    isApplying: false,
    isDiscarding: false,
    isCancelling: false,
    error: null,
    selfHealingCount: 0,
    diffModalOpen: false,
    setDiffModalOpen: vi.fn(),
    startSession: mockStartSession,
    cancelSession: mockCancelSession,
    applyStaged: mockApplyStaged,
    discardStaged: mockDiscardStaged,
    clearError: vi.fn(),
  }),
}));

describe('StudioAgentDrawer Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveSession = null;
    mockIsStarting = false;
    mockIsStreaming = false;
    queryClient = new QueryClient();
  });

  function renderDrawer() {
    return render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <StudioAgentDrawer projectId="proj-1" branchId="branch-1" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  it('renders temporarily discontinued notice with developer announcement and status label', () => {
    renderDrawer();

    // 1. Branding preserved
    expect(screen.getByText('Agent Workstation')).toBeDefined();
    expect(screen.getByText('gemini-1.5-pro')).toBeDefined();

    // 2. Status label
    const statusLabels = screen.getAllByText('TEMPORARILY DISABLED');
    expect(statusLabels.length).toBeGreaterThan(0);

    // 3. Exact announcement text
    expect(
      screen.getByText(
        'Due to unexpected financial difficulties faced by our developer Yash, this feature has been temporarily discontinued.'
      )
    ).toBeDefined();
    expect(screen.getByText("Apparently, AI doesn't run on motivation.")).toBeDefined();
    expect(screen.getByText('Premium access coming soon.')).toBeDefined();

    // 4. Input form and Plan & Execute button disabled / not present
    expect(screen.queryByPlaceholderText(/Implement input validation/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Plan & Execute/i })).toBeNull();
  });

  it('prevents starting new agent sessions through discontinued UI', () => {
    renderDrawer();

    expect(screen.queryByRole('button', { name: /Plan & Execute/i })).toBeNull();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('renders active plan steps and quarantined staged files when session is loaded', () => {
    mockActiveSession = {
      id: 'session-1',
      projectId: 'proj-1',
      branchId: 'branch-1',
      userId: 'user-1',
      title: 'Auth Workflow',
      prompt: 'Create login route',
      status: 'AWAITING_REVIEW',
      model: 'gemini-1.5-pro',
      totalInputTokens: 50,
      totalOutputTokens: 100,
      selfHealingAttempts: 0,
      maxSelfHealingAttempts: 3,
      errorMessage: null,
      expiresAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      steps: [
        {
          id: 'step-1',
          sessionId: 'session-1',
          stepNumber: 1,
          title: 'Generate routes',
          description: 'Add auth.ts endpoints',
          status: 'COMPLETED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      toolCalls: [],
      stagedFiles: [
        {
          id: 'staged-1',
          sessionId: 'session-1',
          filePath: 'src/routes/auth.ts',
          changeType: 'CREATE',
          originalContent: null,
          stagedContent: 'export const auth = router;',
          isApplied: false,
          hasConflict: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    renderDrawer();

    expect(screen.getByText('Generate routes')).toBeDefined();
    expect(screen.getByText('src/routes/auth.ts')).toBeDefined();
    expect(screen.getByText('Review Diffs')).toBeDefined();
    expect(screen.getByRole('button', { name: /Accept All/i })).toBeDefined();
  });
});
