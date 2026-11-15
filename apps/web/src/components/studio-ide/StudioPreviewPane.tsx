import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Laptop,
  Maximize2,
  Minimize2,
  Play,
  RotateCw,
  Smartphone,
  Square,
  Tablet,
  Terminal,
  X,
} from 'lucide-react';
import { usePreviewSandbox } from '@/hooks/usePreviewSandbox';

export interface StudioPreviewPaneProps {
  projectId: string;
  branchId?: string;
  onClose?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  className?: string;
}

const PORT_LABELS: Record<number, string> = {
  5173: 'Vite',
  3000: 'Node / Web',
  8000: 'Python API',
  8080: 'Proxy / Java',
};

const DEFAULT_PORTS = [5173, 3000, 8000, 8080];

export const StudioPreviewPane: React.FC<StudioPreviewPaneProps> = ({
  projectId,
  branchId,
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
  className = '',
}) => {
  const {
    sandbox,
    status,
    isStarting,
    isStopping,
    error,
    logs,
    deviceMode,
    iframeKey,
    previewUrl,
    start,
    stop,
    refresh,
    setDeviceMode,
    fetchLogs,
  } = usePreviewSandbox({
    projectId,
    branchId,
    autoStart: false,
  });

  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedPort, setSelectedPort] = useState<number>(sandbox?.primaryPort || 5173);

  // Sync selectedPort when sandbox primaryPort updates
  useEffect(() => {
    if (sandbox?.primaryPort) {
      setSelectedPort((prev) => (prev ? prev : sandbox.primaryPort));
    }
  }, [sandbox?.primaryPort]);

  const availablePorts: number[] = Array.from(
    new Set([
      ...(sandbox?.ports && sandbox.ports.length > 0 ? sandbox.ports : []),
      sandbox?.primaryPort || 5173,
      ...DEFAULT_PORTS,
    ])
  ).sort((a, b) => a - b);

  // Compute dynamic preview URL reflecting selected port
  const effectivePreviewUrl = previewUrl
    ? previewUrl.replace(
        new RegExp(`/preview/${projectId}/(\\d+)`),
        `/preview/${projectId}/${selectedPort}`
      )
    : null;

  const handleCopyUrl = async () => {
    if (!effectivePreviewUrl) return;
    try {
      await navigator.clipboard.writeText(effectivePreviewUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleToggleLogs = () => {
    if (!showLogs) {
      void fetchLogs();
    }
    setShowLogs(!showLogs);
  };

  return (
    <div
      className={`flex flex-col h-full bg-[#090b10] border-l border-zinc-800/80 text-zinc-100 overflow-hidden ${className}`}
      data-testid="studio-preview-pane"
    >
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#0d1117] border-b border-zinc-800/80 gap-1.5 shrink-0 select-none overflow-x-auto">
        {/* Left: Status Pill */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium font-mono border bg-zinc-900 border-zinc-800">
            {status === 'RUNNING' && (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
                <span className="text-emerald-400">Live :{selectedPort}</span>
              </>
            )}
            {status === 'STARTING' && (
              <>
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping" />
                <span className="text-orange-400">Booting...</span>
              </>
            )}
            {status === 'STOPPED' && (
              <>
                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                <span className="text-zinc-400">Offline</span>
              </>
            )}
            {status === 'FAILED' && (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span className="text-rose-400">Failed</span>
              </>
            )}
          </div>
        </div>

        {/* Center: Address Bar with Port Selector */}
        <div className="flex-1 min-w-[90px] max-w-[280px] mx-1 flex items-center bg-[#161b22] border border-zinc-700/60 rounded px-1.5 py-1 text-xs font-mono text-zinc-300 gap-1 overflow-hidden">
          <span className="text-zinc-500 select-none text-[11px] shrink-0 hidden sm:inline">http://</span>
          <span className="truncate flex-1 text-[11px]" title={effectivePreviewUrl ?? ''}>
            {effectivePreviewUrl
              ? `localhost:4000/preview/${projectId.slice(0, 6)}...`
              : 'sandbox:offline'}
          </span>

          {/* Port Selector Dropdown */}
          <select
            aria-label="Select preview port"
            value={selectedPort}
            onChange={(e) => setSelectedPort(Number(e.target.value))}
            className="bg-zinc-800 hover:bg-zinc-750 text-orange-400 font-mono text-[10.5px] font-medium border border-zinc-700/80 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-500 cursor-pointer shrink-0"
            title={`Switch destination port (current: :${selectedPort}${PORT_LABELS[selectedPort] ? ` - ${PORT_LABELS[selectedPort]}` : ''})`}
          >
            {availablePorts.map((p) => (
              <option key={p} value={p}>
                :{p} {PORT_LABELS[p] ? `(${PORT_LABELS[p]})` : ''}
              </option>
            ))}
          </select>

          {effectivePreviewUrl && (
            <button
              onClick={handleCopyUrl}
              title="Copy preview URL"
              className="ml-0.5 text-zinc-400 hover:text-orange-400 transition-colors shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>

        {/* Right: Device Toggles & Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Device Breakpoints */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5 shrink-0">
            <button
              onClick={() => setDeviceMode('desktop')}
              className={`p-1 rounded text-xs transition-colors ${
                deviceMode === 'desktop'
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Desktop viewport"
            >
              <Laptop className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeviceMode('tablet')}
              className={`p-1 rounded text-xs transition-colors ${
                deviceMode === 'tablet'
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Tablet viewport (768px)"
            >
              <Tablet className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeviceMode('mobile')}
              className={`p-1 rounded text-xs transition-colors ${
                deviceMode === 'mobile'
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Mobile viewport (375px)"
            >
              <Smartphone className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={status !== 'RUNNING' && status !== 'STARTING'}
            className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors shrink-0"
            title="Reload preview"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-orange-400' : ''}`} />
          </button>

          {/* External Tab Popout */}
          {effectivePreviewUrl && (
            <a
              href={effectivePreviewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="p-1 text-zinc-400 hover:text-orange-400 transition-colors shrink-0"
              title="Open preview in new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          {/* Full Screen Preview Toggle */}
          {onToggleFullscreen && (
            <button
              onClick={onToggleFullscreen}
              className={`p-1 rounded transition-colors shrink-0 ${
                isFullscreen
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              }`}
              title={isFullscreen ? 'Exit full screen preview (Esc)' : 'Full screen preview'}
              aria-label={isFullscreen ? 'Exit full screen preview' : 'Full screen preview'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          )}

          {/* Logs Drawer Toggle */}
          <button
            onClick={handleToggleLogs}
            className={`p-1 rounded transition-colors shrink-0 ${
              showLogs ? 'bg-zinc-800 text-orange-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            title="Toggle container logs"
          >
            <Terminal className="w-3.5 h-3.5" />
          </button>

          {/* Start / Stop Action Button */}
          {status === 'RUNNING' || status === 'STARTING' ? (
            <button
              onClick={() => void stop()}
              disabled={isStopping}
              className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
              title="Stop container"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => void start()}
              disabled={isStarting}
              className="flex items-center gap-1 px-2 py-1 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium transition-colors disabled:opacity-50 shadow-sm shrink-0"
              title="Start preview sandbox"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>{isStarting ? 'Starting...' : 'Start'}</span>
            </button>
          )}

          {/* Close Panel Button */}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors ml-0.5 shrink-0"
              title="Close preview pane"
              aria-label="Close preview pane"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Main Stage Viewport Area */}
      <div className="flex-1 relative bg-[#06080c] flex items-center justify-center p-3 overflow-hidden">
        {/* Offline / Stopped State Canvas */}
        {status === 'STOPPED' && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm p-6 bg-[#0d1117] border border-zinc-800/80 rounded-xl shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-orange-400 mb-4">
              <Laptop className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-zinc-100 mb-1.5">
              Live Preview Offline
            </h3>
            <p className="text-xs text-zinc-400 mb-5 leading-relaxed">
              Launch an isolated Docker sandbox container to run your code, preview responsive layouts, and test live web applications.
            </p>
            <button
              onClick={() => void start()}
              disabled={isStarting}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-xs transition-colors shadow-md shadow-orange-500/20 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isStarting ? 'Spawning Sandbox Container...' : 'Start Cloud Preview'}</span>
            </button>
            {error && (
              <p className="mt-3 text-[11px] text-rose-400 font-mono">
                Error: {error}
              </p>
            )}
          </div>
        )}

        {/* Booting Progress Indicator State */}
        {status === 'STARTING' && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm p-8 bg-[#0d1117] border border-orange-500/30 rounded-xl shadow-2xl">
            <div className="w-10 h-10 border-2 border-orange-500/20 border-t-orange-400 rounded-full animate-spin mb-4" />
            <h3 className="text-sm font-semibold text-zinc-100 mb-1">
              Booting Sandbox Runtime
            </h3>
            <p className="text-xs text-zinc-400 mb-3">
              Allocating private bridge network &bull; Mounting files &bull; Starting server
            </p>
            <div className="w-full bg-zinc-800/80 h-1.5 rounded-full overflow-hidden">
              <div className="bg-orange-500 h-full w-2/3 rounded-full animate-pulse" />
            </div>
          </div>
        )}

        {/* Failed State */}
        {status === 'FAILED' && (
          <div className="flex flex-col items-center justify-center text-center max-w-sm p-6 bg-[#0d1117] border border-rose-500/40 rounded-xl shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mb-3">
              <X className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-semibold text-rose-400 mb-1">
              Sandbox Startup Failed
            </h3>
            <p className="text-xs text-zinc-400 mb-4">
              {error || sandbox?.errorMessage || 'Container failed to initialize.'}
            </p>
            <button
              onClick={() => void start()}
              className="py-1.5 px-3 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-zinc-200 transition-colors"
            >
              Retry Boot
            </button>
          </div>
        )}

        {/* Running Live Preview Iframe with Device Framing */}
        {(status === 'RUNNING' || (status === 'STARTING' && effectivePreviewUrl)) && (
          <div
            className={`h-full transition-all duration-300 ease-out flex flex-col bg-white rounded-lg shadow-2xl overflow-hidden ${
              deviceMode === 'desktop'
                ? 'w-full'
                : deviceMode === 'tablet'
                ? 'w-[768px] border-4 border-zinc-700/80 rounded-2xl'
                : 'w-[375px] border-8 border-zinc-800 rounded-3xl'
            }`}
          >
            {/* Device mock header notch for mobile */}
            {deviceMode === 'mobile' && (
              <div className="w-full bg-zinc-800 py-1 flex justify-center items-center shrink-0">
                <div className="w-20 h-3 bg-zinc-900 rounded-full" />
              </div>
            )}

            <iframe
              key={iframeKey}
              src={effectivePreviewUrl || 'about:blank'}
              title="Devnolith Sandbox Preview"
              className="w-full h-full border-none bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          </div>
        )}
      </div>

      {/* 3. Collapsible Container Logs Terminal */}
      {showLogs && (
        <div className="h-44 bg-[#0a0d14] border-t border-zinc-800/80 flex flex-col shrink-0 font-mono text-xs">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f131c] border-b border-zinc-800/60 select-none">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-orange-400" />
              <span>Container Logs (stdout/stderr)</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void fetchLogs()}
                className="text-zinc-400 hover:text-zinc-200 text-[11px]"
              >
                Refresh
              </button>
              <button
                onClick={() => setShowLogs(false)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 p-3 overflow-y-auto space-y-1 text-zinc-300">
            {logs.length === 0 ? (
              <p className="text-zinc-600 italic">No output logged yet.</p>
            ) : (
              logs.map((line, idx) => (
                <div key={idx} className="whitespace-pre-wrap leading-relaxed text-[11px]">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
