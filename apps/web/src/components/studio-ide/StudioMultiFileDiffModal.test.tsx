import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentStagedFileDto } from '@codecollab/shared';
import { StudioMultiFileDiffModal } from '@/components/studio-ide/StudioMultiFileDiffModal';
import { ThemeProvider } from '@/context/ThemeContext';

afterEach(() => {
  cleanup();
});

// Mock Monaco DiffEditor
vi.mock('@monaco-editor/react', () => ({
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="mock-diff-editor">
      <div data-testid="original-content">{original}</div>
      <div data-testid="modified-content">{modified}</div>
    </div>
  ),
}));

describe('StudioMultiFileDiffModal Component', () => {
  const stagedFiles: AgentStagedFileDto[] = [
    {
      id: 'staged-1',
      sessionId: 'session-1',
      filePath: 'src/utils/math.ts',
      changeType: 'MODIFY',
      originalContent: 'export const add = (a, b) => a + b;',
      stagedContent: 'export const add = (a: number, b: number): number => a + b;',
      isApplied: false,
      hasConflict: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'staged-2',
      sessionId: 'session-1',
      filePath: 'src/config.ts',
      changeType: 'CREATE',
      originalContent: null,
      stagedContent: 'export const config = { port: 3000 };',
      isApplied: false,
      hasConflict: true, // Concurrency conflict!
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  it('renders modal with list of staged files and conflict warnings', () => {
    const onApply = vi.fn();
    const onDiscard = vi.fn();
    const onClose = vi.fn();

    render(
      <ThemeProvider>
        <StudioMultiFileDiffModal
          open={true}
          stagedFiles={stagedFiles}
          isApplying={false}
          isDiscarding={false}
          onClose={onClose}
          onApply={onApply}
          onDiscard={onDiscard}
        />
      </ThemeProvider>,
    );

    expect(screen.getByText('Quarantined Multi-File Staging Review')).toBeDefined();
    expect(screen.getAllByText('src/utils/math.ts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('src/config.ts').length).toBeGreaterThan(0);
    expect(screen.getByText('Conflicts Detected')).toBeDefined();

    // The "Accept & Apply All Changes" button should be disabled because of conflicts
    const applyButton = screen.getByRole('button', { name: /Accept & Apply All Changes/i });
    expect(applyButton.hasAttribute('disabled')).toBe(true);
  });

  it('switches active file when clicked in the sidebar', () => {
    render(
      <ThemeProvider>
        <StudioMultiFileDiffModal
          open={true}
          stagedFiles={stagedFiles}
          isApplying={false}
          isDiscarding={false}
          onClose={vi.fn()}
          onApply={vi.fn()}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>,
    );

    // Click on the second file in the sidebar list
    const file2Buttons = screen.getAllByText('src/config.ts');
    fireEvent.click(file2Buttons[0]);

    // Check that conflict warning appears in the main editor area
    expect(screen.getByText(/Concurrency Conflict:/i)).toBeDefined();
    expect(screen.getByTestId('modified-content').textContent).toContain('port: 3000');
  });
});
