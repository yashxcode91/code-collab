import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewSandboxDTO } from '@codecollab/shared';
import { StudioPreviewPane } from './StudioPreviewPane';

afterEach(() => {
  cleanup();
});

const mockStart = vi.fn();
const mockStop = vi.fn();
const mockRefresh = vi.fn();
const mockSetDeviceMode = vi.fn();
const mockFetchLogs = vi.fn();

let mockSandbox: PreviewSandboxDTO | null = null;
let mockStatus: 'STARTING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'FAILED' = 'STOPPED';
let mockDeviceMode: 'desktop' | 'tablet' | 'mobile' = 'desktop';
let mockPreviewUrl: string | null = null;
let mockLogs: string[] = [];

vi.mock('@/hooks/usePreviewSandbox', () => ({
  usePreviewSandbox: () => ({
    sandbox: mockSandbox,
    status: mockStatus,
    isLoading: false,
    isStarting: false,
    isStopping: false,
    error: null,
    logs: mockLogs,
    deviceMode: mockDeviceMode,
    iframeKey: 1,
    previewUrl: mockPreviewUrl,
    start: mockStart,
    stop: mockStop,
    restart: vi.fn(),
    refresh: mockRefresh,
    setDeviceMode: mockSetDeviceMode,
    fetchLogs: mockFetchLogs,
  }),
}));

describe('StudioPreviewPane Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSandbox = null;
    mockStatus = 'STOPPED';
    mockDeviceMode = 'desktop';
    mockPreviewUrl = null;
    mockLogs = [];
  });

  it('renders offline state with Launch button when sandbox is STOPPED', () => {
    render(<StudioPreviewPane projectId="test-proj-id" />);

    expect(screen.getByText('Live Preview Offline')).toBeDefined();
    const startBtn = screen.getByText('Start Cloud Preview');
    expect(startBtn).toBeDefined();

    fireEvent.click(startBtn);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('renders iframe and device viewport buttons when sandbox is RUNNING', () => {
    mockStatus = 'RUNNING';
    mockPreviewUrl = 'http://localhost:4000/preview/test-proj-id/5173/?token=abc';
    mockSandbox = {
      id: 'sbx-1',
      projectId: 'test-proj-id',
      branchId: 'branch-1',
      containerId: 'c123',
      containerName: 'cc-sbx-test',
      internalIp: '172.28.0.2',
      status: 'RUNNING',
      ports: [5173],
      primaryPort: 5173,
      memoryLimitMb: 512,
      cpuLimit: 1.0,
      previewToken: 'abc',
      previewUrl: '/preview/test-proj-id/5173/',
      errorMessage: null,
      lastPingAt: null,
      startedAt: null,
      stoppedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<StudioPreviewPane projectId="test-proj-id" />);

    expect(screen.getByText('Live :5173')).toBeDefined();
    const iframe = screen.getByTitle('CodeCollab Sandbox Preview');
    expect(iframe).toBeDefined();
    expect(iframe.getAttribute('src')).toBe(mockPreviewUrl);
  });

  it('toggles container logs terminal when clicking terminal button', () => {
    mockStatus = 'RUNNING';
    mockLogs = ['[vite] ready in 250ms', '[vite] page reload'];

    render(<StudioPreviewPane projectId="test-proj-id" />);

    const logsBtn = screen.getByTitle('Toggle container logs');
    fireEvent.click(logsBtn);

    expect(mockFetchLogs).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Container Logs (stdout/stderr)')).toBeDefined();
    expect(screen.getByText('[vite] ready in 250ms')).toBeDefined();
  });

  it('changes device breakpoint mode when clicking tablet or mobile buttons', () => {
    mockStatus = 'RUNNING';
    render(<StudioPreviewPane projectId="test-proj-id" />);

    const tabletBtn = screen.getByTitle('Tablet viewport (768px)');
    fireEvent.click(tabletBtn);
    expect(mockSetDeviceMode).toHaveBeenCalledWith('tablet');

    const mobileBtn = screen.getByTitle('Mobile viewport (375px)');
    fireEvent.click(mobileBtn);
    expect(mockSetDeviceMode).toHaveBeenCalledWith('mobile');
  });
});
