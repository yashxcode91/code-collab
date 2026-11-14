import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  Play,
  RotateCcw,
  Terminal as TerminalIcon,
  Trash2,
  X,
  AlertCircle,
} from 'lucide-react';
import type {
  TerminalClientMessage,
  TerminalServerMessage,
} from '@codecollab/shared';
import { usePreviewSandbox } from '@/hooks/usePreviewSandbox';

export interface StudioTerminalPaneProps {
  projectId: string;
  branchId?: string;
  onClose?: () => void;
  className?: string;
}

export type TerminalStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export const StudioTerminalPane: React.FC<StudioTerminalPaneProps> = ({
  projectId,
  branchId,
  onClose,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState<TerminalStatus>('CONNECTING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    status: sandboxStatus,
    start: startSandbox,
    isStarting: isStartingSandbox,
    sandbox,
  } = usePreviewSandbox({
    projectId,
    branchId,
    autoStart: false,
  });

  const isSandboxRunning = sandboxStatus === 'RUNNING';

  const connectTerminal = useCallback(() => {
    if (!containerRef.current || !isSandboxRunning) {
      if (!isSandboxRunning) {
        setStatus('DISCONNECTED');
      }
      return;
    }

    // Clean up existing WebSocket if any
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    // Initialize or re-use Terminal instance
    if (!terminalRef.current) {
      const term = new Terminal({
        theme: {
          background: '#020617', // slate-950
          foreground: '#f8fafc',
          cursor: '#38bdf8', // sky-400
          selectionBackground: '#1e293b',
          black: '#0f172a',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f1f5f9',
          brightBlack: '#475569',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#ffffff',
        },
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.35,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 2000,
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
    }

    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;

    setStatus('CONNECTING');
    setErrorMessage(null);

    // Build WebSocket URL
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const host =
      (import.meta as any).env?.VITE_WS_HOST ||
      (typeof window !== 'undefined'
        ? `${window.location.hostname}:4000`
        : 'localhost:4000');

    const tokenQuery = sandbox?.previewToken
      ? `?token=${encodeURIComponent(sandbox.previewToken)}`
      : '';
    const wsUrl = `${wsProtocol}//${host}/terminal/${encodeURIComponent(projectId)}${tokenQuery}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('CONNECTED');
      if (fitAddon && term) {
        fitAddon.fit();
        const resizeMsg: TerminalClientMessage = {
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        };
        ws.send(JSON.stringify(resizeMsg));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as TerminalServerMessage;
        switch (msg.type) {
          case 'output':
            term.write(msg.data);
            break;
          case 'exit':
            term.write(`\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`);
            setStatus('DISCONNECTED');
            break;
          case 'error':
            term.write(`\r\n\x1b[31m[Error: ${msg.message}]\x1b[0m\r\n`);
            setErrorMessage(msg.message);
            setStatus('ERROR');
            break;
          case 'pong':
            break;
        }
      } catch {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setStatus('DISCONNECTED');
    };

    ws.onerror = () => {
      setStatus('ERROR');
      setErrorMessage('WebSocket connection failed');
    };

    // Forward user keystrokes to backend
    const onDataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const inputMsg: TerminalClientMessage = {
          type: 'input',
          data,
        };
        ws.send(JSON.stringify(inputMsg));
      }
    });

    return () => {
      onDataDisposable.dispose();
    };
  }, [isSandboxRunning, projectId, sandbox?.previewToken]);

  // Connect when sandbox becomes ready
  useEffect(() => {
    const cleanup = connectTerminal();
    return () => {
      if (cleanup) cleanup();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
    };
  }, [connectTerminal]);

  // Handle container resizing
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const resizeMsg: TerminalClientMessage = {
            type: 'resize',
            cols: terminalRef.current.cols,
            rows: terminalRef.current.rows,
          };
          wsRef.current.send(JSON.stringify(resizeMsg));
        }
      }
    };

    window.addEventListener('resize', handleResize);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, []);

  const handleClear = () => {
    if (terminalRef.current) {
      terminalRef.current.clear();
    }
  };

  const handleRestart = () => {
    if (terminalRef.current) {
      terminalRef.current.reset();
    }
    connectTerminal();
  };

  return (
    <div
      className={`flex flex-col h-full bg-slate-950 border-t border-slate-800 text-slate-100 ${className}`}
      data-testid="studio-terminal-pane"
    >
      {/* Terminal Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-slate-200">Terminal</span>

          {/* Status Indicator */}
          <div className="flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-[10px] font-mono">
            {status === 'CONNECTED' && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400">CONNECTED</span>
              </>
            )}
            {status === 'CONNECTING' && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400">CONNECTING...</span>
              </>
            )}
            {status === 'DISCONNECTED' && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                <span className="text-slate-400">DISCONNECTED</span>
              </>
            )}
            {status === 'ERROR' && (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span className="text-rose-400" title={errorMessage || 'Error'}>
                  {errorMessage ? `ERROR: ${errorMessage.slice(0, 30)}` : 'ERROR'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            title="Clear Terminal (Ctrl+L)"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRestart}
            title="Restart Terminal Session"
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Terminal"
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors ml-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Terminal Viewport / Offline Guard */}
      <div className="relative flex-1 min-h-0 w-full overflow-hidden p-2">
        {!isSandboxRunning ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6 text-slate-400">
            <AlertCircle className="w-8 h-8 text-amber-400 mb-2 opacity-80" />
            <h4 className="text-sm font-semibold text-slate-200 mb-1">
              Sandbox Container Offline
            </h4>
            <p className="text-xs max-w-sm mb-4 text-slate-400">
              The interactive terminal runs inside your isolated project sandbox. Start
              the sandbox to open your bash terminal.
            </p>
            <button
              onClick={() => void startSandbox()}
              disabled={isStartingSandbox}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 shadow-sm"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {isStartingSandbox ? 'Spinning up container...' : 'Start Sandbox'}
            </button>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="w-full h-full"
            data-testid="terminal-container"
          />
        )}
      </div>
    </div>
  );
};
