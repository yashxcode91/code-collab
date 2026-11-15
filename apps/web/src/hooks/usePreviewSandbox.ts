import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewSandboxDTO, SandboxStatus } from '@codecollab/shared';
import {
  getSandboxLogs,
  getSandboxStatus,
  startSandbox,
  stopSandbox,
} from '@/api/sandbox';

export type DeviceMode = 'desktop' | 'tablet' | 'mobile';

export interface UsePreviewSandboxOptions {
  projectId: string;
  branchId?: string;
  autoStart?: boolean;
}

export interface UsePreviewSandboxReturn {
  sandbox: PreviewSandboxDTO | null;
  status: SandboxStatus;
  isLoading: boolean;
  isStarting: boolean;
  isStopping: boolean;
  error: string | null;
  logs: string[];
  deviceMode: DeviceMode;
  iframeKey: number;
  previewUrl: string | null;
  start: (primaryPort?: number) => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  refresh: () => void;
  setDeviceMode: (mode: DeviceMode) => void;
  fetchLogs: () => Promise<void>;
}

export function usePreviewSandbox({
  projectId,
  branchId,
  autoStart = false,
}: UsePreviewSandboxOptions): UsePreviewSandboxReturn {
  const [sandbox, setSandbox] = useState<PreviewSandboxDTO | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [isStopping, setIsStopping] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>('desktop');
  const [iframeKey, setIframeKey] = useState<number>(1);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  const clearPollTimer = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Poll status helper
  const pollStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getSandboxStatus(projectId, branchId);
      if (!isMountedRef.current) return;
      setSandbox(data);
      setError(null);

      // If still starting, continue polling every 1.5s
      if (data && data.status === 'STARTING') {
        clearPollTimer();
        pollTimerRef.current = setTimeout(pollStatus, 1500);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      setError(err.message || 'Failed to poll sandbox status');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [projectId, branchId]);

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    setIsLoading(true);
    pollStatus();

    return () => {
      isMountedRef.current = false;
      clearPollTimer();
    };
  }, [pollStatus]);

  // Auto start if enabled and stopped
  useEffect(() => {
    if (autoStart && sandbox && sandbox.status === 'STOPPED' && !isStarting) {
      void start();
    }
  }, [autoStart, sandbox, isStarting]);

  const start = useCallback(
    async (primaryPort = 5173) => {
      setIsStarting(true);
      setError(null);
      try {
        const data = await startSandbox(projectId, {
          branchId,
          primaryPort,
        });
        if (isMountedRef.current) {
          setSandbox(data);
          setIframeKey((k) => k + 1);
          if (data.status === 'STARTING') {
            clearPollTimer();
            pollTimerRef.current = setTimeout(pollStatus, 1500);
          }
        }
      } catch (err: any) {
        if (isMountedRef.current) {
          setError(err.message || 'Failed to start sandbox');
        }
      } finally {
        if (isMountedRef.current) {
          setIsStarting(false);
        }
      }
    },
    [projectId, branchId, pollStatus]
  );

  const stop = useCallback(async () => {
    setIsStopping(true);
    setError(null);
    clearPollTimer();
    try {
      const data = await stopSandbox(projectId, { branchId });
      if (isMountedRef.current) {
        setSandbox(data);
      }
    } catch (err: any) {
      if (isMountedRef.current) {
        setError(err.message || 'Failed to stop sandbox');
      }
    } finally {
      if (isMountedRef.current) {
        setIsStopping(false);
      }
    }
  }, [projectId, branchId]);

  const restart = useCallback(async () => {
    await stop();
    await start();
  }, [stop, start]);

  const refresh = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!projectId) return;
    try {
      const logLines = await getSandboxLogs(projectId, branchId);
      if (isMountedRef.current) {
        setLogs(logLines);
      }
    } catch (err: any) {
      console.warn('Failed to fetch sandbox logs:', err);
    }
  }, [projectId, branchId]);

  const status: SandboxStatus = sandbox?.status ?? 'STOPPED';

  // Build clean preview URL pointing to backend gateway
  const backendBaseUrl =
    (import.meta as any).env?.VITE_SERVER_URL ||
    (typeof window !== 'undefined'
      ? (window.location.port === '5173'
          ? `${window.location.protocol}//${window.location.hostname}:4000`
          : window.location.origin)
      : 'http://localhost:4000');

  const previewUrl = sandbox
    ? `${backendBaseUrl}/preview/${projectId}/${sandbox.primaryPort}/?token=${encodeURIComponent(
        sandbox.previewToken || ''
      )}`
    : null;

  return {
    sandbox,
    status,
    isLoading,
    isStarting,
    isStopping,
    error,
    logs,
    deviceMode,
    iframeKey,
    previewUrl,
    start,
    stop,
    restart,
    refresh,
    setDeviceMode,
    fetchLogs,
  };
}
