import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eraser,
  History,
  Loader2,
  Play,
  Send,
  Sparkles,
  Square,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import type {
  ExecutionRunDto,
  ProjectFileNodeDto,
  SupportedLanguage,
} from '@codecollab/shared';
import type { ConsoleOutputSegment } from '@/hooks/useExecutionConsole';
import { cn } from '@/lib/utils';

type ConsoleTab = 'output' | 'stderr' | 'history';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  javascript: 'JavaScript (Node)',
  typescript: 'TypeScript',
  python: 'Python 3',
  cpp: 'C++ (g++)',
  java: 'Java (JDK)',
};

const formatDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const getStatusBadgeStyle = (status: ExecutionRunDto['status']): string => {
  switch (status) {
    case 'COMPLETED':
      return 'border-emerald-500/35 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300';
    case 'FAILED':
      return 'border-destructive/40 bg-destructive/15 text-destructive';
    case 'TIMEOUT':
      return 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-300';
    case 'CANCELLED':
      return 'border-border bg-muted/60 text-muted-foreground';
    case 'RUNNING':
      return 'border-primary/45 bg-primary/15 text-primary';
    case 'QUEUED':
      return 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-300';
  }
};

interface StudioExecutionConsoleProps {
  open: boolean;
  expanded: boolean;
  language: SupportedLanguage;
  onChangeLanguage: (language: SupportedLanguage) => void;
  activeFile: ProjectFileNodeDto | null;
  activeRun: ExecutionRunDto | null;
  runs: ExecutionRunDto[];
  runsLoading: boolean;
  segments: ConsoleOutputSegment[];
  elapsedMs: number;
  consoleError: string | null;
  canRun: boolean;
  isOwner: boolean;
  currentUserId: string;
  isStarting: boolean;
  isCancelling: boolean;
  hasRunnableSource: boolean;
  onRun: () => void;
  onCancel: () => void;
  onSendStdin: (line: string) => Promise<boolean>;
  onSelectRun: (runId: string) => void;
  onClearOutput: () => void;
  onDismissError: () => void;
  onToggleExpanded: () => void;
  onClose: () => void;
  onDebugWithAi?: (errorText: string, runId?: string) => void;
}

/**
 * Docked bottom Run & Stdin/Output Console inside Studio IDE.
 * Streams live container stdout/stderr over Socket.IO, sends interactive stdin
 * to running containers, displays exit status/timing, and browses branch run history.
 */
export function StudioExecutionConsole({
  open,
  expanded,
  language,
  onChangeLanguage,
  activeFile,
  activeRun,
  runs,
  runsLoading,
  segments,
  elapsedMs,
  consoleError,
  canRun,
  isOwner,
  currentUserId,
  isStarting,
  isCancelling,
  hasRunnableSource,
  onRun,
  onCancel,
  onSendStdin,
  onSelectRun,
  onClearOutput,
  onDismissError,
  onToggleExpanded,
  onClose,
  onDebugWithAi,
}: StudioExecutionConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>('output');
  const [stdinValue, setStdinValue] = useState('');
  const [isSendingStdin, setIsSendingStdin] = useState(false);
  const [copied, setCopied] = useState(false);

  const outputScrollRef = useRef<HTMLDivElement>(null);

  const isRunActive = Boolean(
    activeRun &&
      (activeRun.status === 'QUEUED' || activeRun.status === 'RUNNING'),
  );
  const canCancelActiveRun = Boolean(
    activeRun &&
      isRunActive &&
      (activeRun.userId === currentUserId || isOwner),
  );
  const canSendStdinToActive = Boolean(
    activeRun &&
      activeRun.status === 'RUNNING' &&
      canRun &&
      activeRun.userId === currentUserId,
  );

  // Switch back to Output view automatically whenever a new run starts
  useEffect(() => {
    if (activeRun && (activeRun.status === 'QUEUED' || activeRun.status === 'RUNNING')) {
      setTab('output');
    }
  }, [activeRun?.id, activeRun?.status]);

  // Auto-scroll terminal viewport as new chunks arrive
  useEffect(() => {
    if (tab === 'history') return;
    const container = outputScrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [segments.length, tab, open]);

  const visibleSegments = useMemo(() => {
    if (tab === 'stderr') {
      return segments.filter((seg) => seg.stream === 'stderr');
    }
    return segments;
  }, [segments, tab]);

  const stderrCount = useMemo(
    () => segments.filter((seg) => seg.stream === 'stderr').length,
    [segments],
  );

  if (!open) {
    return null;
  }

  const handleCopyOutput = async () => {
    const plain = visibleSegments.map((s) => s.text).join('');
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable in insecure contexts
    }
  };

  const handleStdinSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSendStdinToActive || isSendingStdin) return;
    if (!stdinValue) return;
    setIsSendingStdin(true);
    const ok = await onSendStdin(stdinValue);
    setIsSendingStdin(false);
    if (ok) {
      setStdinValue('');
    }
  };

  const renderStatusIcon = (status: ExecutionRunDto['status']) => {
    switch (status) {
      case 'QUEUED':
      case 'RUNNING':
        return <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />;
      case 'COMPLETED':
        return <CheckCircle2 className="h-3 w-3" aria-hidden="true" />;
      case 'FAILED':
        return <XCircle className="h-3 w-3" aria-hidden="true" />;
      case 'TIMEOUT':
        return <Clock className="h-3 w-3" aria-hidden="true" />;
      case 'CANCELLED':
        return <Ban className="h-3 w-3" aria-hidden="true" />;
    }
  };

  return (
    <section
      aria-label="Execution Console"
      className={cn(
        'glass-surface flex shrink-0 flex-col overflow-hidden rounded-2xl transition-[height] duration-150 ease-out',
        expanded ? 'h-80 sm:h-96' : 'h-56 sm:h-64',
      )}
    >
      {/* 1. Console Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-[hsl(var(--editor-bar))]/80 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-foreground">
            <Terminal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>Console</span>
          </div>

          <select
            aria-label="Execution runtime language"
            value={language}
            disabled={!canRun || isRunActive || isStarting}
            onChange={(e) => onChangeLanguage(e.target.value as SupportedLanguage)}
            className="glass-control h-7 rounded-lg px-2 font-mono text-[11px] text-foreground focus:border-primary/60 focus:outline-none disabled:opacity-60"
          >
            {(Object.keys(LANGUAGE_LABELS) as SupportedLanguage[]).map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>

          {canRun &&
            (isRunActive ? (
              <button
                type="button"
                disabled={!canCancelActiveRun || isCancelling}
                onClick={onCancel}
                title={
                  canCancelActiveRun
                    ? 'Terminate running container'
                    : 'Only the run creator or workspace owner can stop this run'
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-destructive/45 bg-destructive/15 px-2.5 font-mono text-[11px] font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                )}
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={isStarting || !hasRunnableSource}
                onClick={onRun}
                title={
                  hasRunnableSource
                    ? `Run ${activeFile?.name ?? 'code'} in isolated Docker sandbox`
                    : 'Open a file to execute code'
                }
                className="btn-studio-primary inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isStarting ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                )}
                <span>{isStarting ? 'Starting…' : 'Run'}</span>
              </button>
            ))}

          {activeRun && (
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10.5px]">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold',
                  getStatusBadgeStyle(activeRun.status),
                )}
              >
                {renderStatusIcon(activeRun.status)}
                <span>{activeRun.status}</span>
              </span>

              {activeRun.failureKind && (
                <span className="rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {activeRun.failureKind}
                </span>
              )}

              {activeRun.exitCode !== null && (
                <span className="text-muted-foreground">
                  exit {activeRun.exitCode}
                </span>
              )}

              <span className="text-muted-foreground">
                {formatDuration(
                  isRunActive ? elapsedMs : activeRun.durationMs ?? elapsedMs,
                )}
              </span>

              <span className="hidden text-muted-foreground/80 md:inline">
                · {activeRun.entryFileName}
              </span>
            </div>
          )}
        </div>

        {/* Right Tabs + Utilities */}
        <div className="flex items-center gap-1">
          <div className="glass-control flex items-center rounded-lg p-0.5 font-mono text-[10.5px]">
            <button
              type="button"
              onClick={() => setTab('output')}
              className={cn(
                'rounded-md px-2 py-0.5 transition-colors',
                tab === 'output'
                  ? 'bg-primary/15 font-semibold text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Output
            </button>
            <button
              type="button"
              onClick={() => setTab('stderr')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                tab === 'stderr'
                  ? 'bg-destructive/15 font-semibold text-destructive'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>Stderr</span>
              {stderrCount > 0 && (
                <span className="rounded-full bg-destructive/20 px-1 text-[9px] text-destructive">
                  {stderrCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 transition-colors',
                tab === 'history'
                  ? 'bg-primary/15 font-semibold text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <History className="h-3 w-3" aria-hidden="true" />
              <span>History</span>
              {runs.length > 0 && (
                <span className="text-[9.5px] opacity-75">({runs.length})</span>
              )}
            </button>
          </div>

          {tab !== 'history' && (
            <>
              <button
                type="button"
                onClick={() => void handleCopyOutput()}
                disabled={visibleSegments.length === 0}
                title={copied ? 'Copied!' : 'Copy output'}
                aria-label="Copy console output"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={onClearOutput}
                disabled={segments.length === 0}
                title="Clear console view"
                aria-label="Clear console view"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground disabled:opacity-40"
              >
                <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}

          {onDebugWithAi &&
            (activeRun?.status === 'FAILED' ||
              stderrCount > 0 ||
              consoleError) && (
              <button
                type="button"
                onClick={() => {
                  const errText =
                    activeRun?.errorMessage ||
                    activeRun?.stderr ||
                    consoleError ||
                    visibleSegments
                      .filter((s) => s.stream === 'stderr')
                      .map((s) => s.text)
                      .join('') ||
                    'Execution failed with runtime error';
                  onDebugWithAi(errText, activeRun?.id);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-purple-500/35 bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-500/25 dark:text-purple-300"
                title="Send runtime error to AI Assistant to diagnose and patch"
              >
                <Sparkles className="h-3 w-3 text-purple-500" />
                <span>Debug with AI</span>
              </button>
            )}

          <button
            type="button"
            onClick={onToggleExpanded}
            title={expanded ? 'Restore console height' : 'Expand console height'}
            aria-label={expanded ? 'Restore console height' : 'Expand console height'}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Hide console"
            aria-label="Hide console"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 2. Error / Truncation Notices */}
      {consoleError && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/35 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{consoleError}</span>
          </div>
          <button
            type="button"
            onClick={onDismissError}
            aria-label="Dismiss console error"
            className="hover:opacity-80"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {activeRun &&
        (activeRun.stdoutTruncated || activeRun.stderrTruncated) && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 font-mono text-[10.5px] text-amber-700 dark:text-amber-300">
            Output capped at 64 KB safety limit (
            {[
              activeRun.stdoutTruncated ? 'stdout truncated' : null,
              activeRun.stderrTruncated ? 'stderr truncated' : null,
            ]
              .filter(Boolean)
              .join(', ')}
            ).
          </div>
        )}

      {/* 3. Main Viewport */}
      {tab === 'history' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {runsLoading ? (
            <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span>Loading branch execution history…</span>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
              No execution runs recorded on this branch yet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {runs.map((run) => {
                const isSelected = activeRun?.id === run.id;
                return (
                  <li key={run.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectRun(run.id);
                        setTab('output');
                      }}
                      className={cn(
                        'glass-control flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left font-mono text-[11px] transition-colors',
                        isSelected
                          ? 'border-primary/50 bg-primary/10'
                          : 'hover:border-border',
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                            getStatusBadgeStyle(run.status),
                          )}
                        >
                          {renderStatusIcon(run.status)}
                          <span>{run.status}</span>
                        </span>
                        <span className="truncate font-semibold text-foreground">
                          {run.entryFileName}
                        </span>
                        <span className="text-muted-foreground">
                          ({run.language})
                        </span>
                        <span className="hidden text-muted-foreground sm:inline">
                          by @{run.triggeredBy.username}
                        </span>
                      </div>

                      <div className="flex shrink-0 items-center gap-2.5 text-[10.5px] text-muted-foreground">
                        {run.exitCode !== null && (
                          <span>exit {run.exitCode}</span>
                        )}
                        <span>{formatDuration(run.durationMs)}</span>
                        <span>
                          {new Date(run.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div
          ref={outputScrollRef}
          className="min-h-0 flex-1 overflow-y-auto bg-[hsl(var(--editor))] p-3 font-mono text-xs leading-relaxed"
        >
          {!activeRun ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
              <p className="text-xs">
                {canRun
                  ? 'Click Run to execute the active file inside an isolated Docker sandbox.'
                  : 'Viewers cannot trigger execution. Select a run from History to inspect logs.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1 whitespace-pre-wrap break-words">
              {activeRun.errorMessage && (
                <div className="mb-2 rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                  {activeRun.errorMessage}
                </div>
              )}

              {visibleSegments.length === 0 ? (
                <span className="text-muted-foreground">
                  {activeRun.status === 'QUEUED'
                    ? 'Waiting in execution queue…'
                    : activeRun.status === 'RUNNING'
                      ? 'Container running… (waiting for output)'
                      : '(no output)'}
                </span>
              ) : (
                visibleSegments.map((seg) => (
                  <span
                    key={seg.id}
                    className={cn(
                      seg.stream === 'stderr' && 'text-destructive',
                      seg.stream === 'stdin' &&
                        'block text-amber-600 dark:text-amber-300',
                      seg.stream === 'stdout' && 'text-foreground',
                      seg.stream === 'system' && 'block text-muted-foreground',
                    )}
                  >
                    {seg.stream === 'stdin' ? `> ${seg.text}` : seg.text}
                  </span>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. Interactive Stdin Bar */}
      <form
        onSubmit={(e) => void handleStdinSubmit(e)}
        className="flex items-center gap-2 border-t border-border/60 bg-[hsl(var(--editor-bar))]/80 px-3 py-1.5"
      >
        <span className="font-mono text-[11px] font-semibold text-primary">
          stdin&gt;
        </span>
        <input
          type="text"
          value={stdinValue}
          disabled={!canSendStdinToActive || isSendingStdin}
          onChange={(e) => setStdinValue(e.target.value)}
          placeholder={
            !canRun
              ? 'Read-only viewer role — stdin disabled'
              : !activeRun
                ? 'Start a run to send interactive stdin…'
                : activeRun.status !== 'RUNNING'
                  ? `Container is ${activeRun.status.toLowerCase()} — stdin available only while RUNNING`
                  : activeRun.userId !== currentUserId
                    ? `Only @${activeRun.triggeredBy.username} can send stdin to this run`
                    : 'Type input and press Enter to stream to container stdin…'
          }
          className="h-7 min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
        />
        <button
          type="submit"
          disabled={!canSendStdinToActive || !stdinValue || isSendingStdin}
          className="glass-control inline-flex h-7 items-center gap-1 rounded-lg px-2.5 font-mono text-[11px] font-medium text-foreground transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isSendingStdin ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3 w-3" aria-hidden="true" />
          )}
          <span>Send</span>
        </button>
      </form>
    </section>
  );
}
