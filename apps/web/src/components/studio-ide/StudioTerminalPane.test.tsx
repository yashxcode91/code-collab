import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewSandboxDTO } from '@codecollab/shared';
import { StudioTerminalPane } from './StudioTerminalPane';

afterEach(() => {
  cleanup();
});

const mockStart = vi.fn();
let mockStatus: 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED' = 'STOPPED';
let mockSandbox: PreviewSandboxDTO | null = null;

vi.mock('@/hooks/usePreviewSandbox', () => ({
  usePreviewSandbox: () => ({
    sandbox: mockSandbox,
    status: mockStatus,
    isLoading: false,
    isStarting: false,
    isStopping: false,
    error: null,
    logs: [],
    deviceMode: 'desktop',
    iframeKey: 1,
    previewUrl: null,
    start: mockStart,
    stop: vi.fn(),
    restart: vi.fn(),
    refresh: vi.fn(),
    setDeviceMode: vi.fn(),
    fetchLogs: vi.fn(),
  }),
}));

// Mock @xterm/xterm and @xterm/addon-fit for headless DOM testing
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    cols = 80;
    rows = 24;
    open = vi.fn();
    loadAddon = vi.fn();
    write = vi.fn();
    clear = vi.fn();
    reset = vi.fn();
    focus = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
  class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
  }
  return { FitAddon: MockFitAddon };
});

describe('StudioTerminalPane Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = 'STOPPED';
    mockSandbox = null;
  });

  it('renders offline container message and Start Sandbox button when sandbox is STOPPED', () => {
    render(<StudioTerminalPane projectId="test-p1" />);

    expect(screen.getByText('Sandbox Container Offline')).toBeDefined();
    const startBtn = screen.getByText('Start Sandbox');
    expect(startBtn).toBeDefined();

    fireEvent.click(startBtn);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('renders terminal container and toolbar when sandbox is RUNNING', () => {
    mockStatus = 'RUNNING';
    mockSandbox = {
      id: 'sbx-1',
      projectId: 'test-p1',
      branchId: 'main-1',
      containerId: 'c1',
      containerName: 'sbx-test',
      internalIp: '172.28.0.2',
      status: 'RUNNING',
      ports: [5173],
      primaryPort: 5173,
      memoryLimitMb: 512,
      cpuLimit: 1.0,
      previewToken: 'test-token',
      previewUrl: '/preview/test-p1/5173/',
      errorMessage: null,
      lastPingAt: null,
      startedAt: null,
      stoppedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<StudioTerminalPane projectId="test-p1" />);

    expect(screen.getByTestId('terminal-container')).toBeDefined();
    expect(screen.getByText('Terminal')).toBeDefined();
    expect(screen.getByText('CONNECTING...')).toBeDefined();
  });

  it('invokes onClose callback when clicking the close button', () => {
    const handleClose = vi.fn();
    render(<StudioTerminalPane projectId="test-p1" onClose={handleClose} />);

    const closeBtn = screen.getByTitle('Close Terminal');
    expect(closeBtn).toBeDefined();

    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
