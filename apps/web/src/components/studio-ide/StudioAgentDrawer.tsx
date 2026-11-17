import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Construction,
  FileCode2,
  Loader2,
  RotateCw,
  Sparkles,
  StopCircle,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { AgentSessionStatusDto } from '@codecollab/shared';
import { StudioMultiFileDiffModal } from '@/components/studio-ide/StudioMultiFileDiffModal';
import { useAgentSession } from '@/hooks/useAgentSession';
import { cn } from '@/lib/utils';

export interface StudioAgentDrawerProps {
  projectId: string;
  branchId: string;
  onFilesApplied?: () => void;
}

/**
 * Feature flag: Temporarily discontinue Agent Workstation submissions
 * Set to `false` to reactivate the interactive goal prompt and execution runner.
 */
export const IS_AGENT_WORKSTATION_DISCONTINUED = true;

const STATUS_CONFIG: Record<
  AgentSessionStatusDto,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  PLANNING: {
    label: 'Planning',
    className: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
    icon: Clock,
  },
  EXECUTING: {
    label: 'Executing Tools',
    className: 'bg-blue-500/10 text-blue-500 border-blue-500/30',
    icon: RotateCw,
  },
  VERIFYING: {
    label: 'Verifying Diagnostics',
    className: 'bg-purple-500/10 text-purple-500 border-purple-500/30',
    icon: Terminal,
  },
  SELF_HEALING: {
    label: 'Self-Healing Loop',
    className: 'bg-orange-500/10 text-orange-500 border-orange-500/30 animate-pulse',
    icon: Wrench,
  },
  AWAITING_REVIEW: {
    label: 'Awaiting Review',
    className: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
    icon: FileCode2,
  },
  COMPLETED: {
    label: 'Applied & Completed',
    className: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40',
    icon: CheckCircle2,
  },
  FAILED: {
    label: 'Failed',
    className: 'bg-destructive/10 text-destructive border-destructive/30',
    icon: AlertCircle,
  },
  CANCELLED: {
    label: 'Cancelled',
    className: 'bg-muted text-muted-foreground border-border',
    icon: StopCircle,
  },
};

export function StudioAgentDrawer({
  projectId,
  branchId,
  onFilesApplied,
}: StudioAgentDrawerProps) {
  const [promptInput, setPromptInput] = useState('');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const {
    activeSession,
    isStarting,
    isStreaming,
    isApplying,
    isDiscarding,
    isCancelling,
    error,
    selfHealingCount,
    diffModalOpen,
    setDiffModalOpen,
    startSession,
    cancelSession,
    applyStaged,
    discardStaged,
    clearError,
  } = useAgentSession({
    projectId,
    branchId,
    onFilesApplied,
  });

  const isRunning = isStarting || isStreaming;
  const statusCfg = activeSession
    ? STATUS_CONFIG[activeSession.status]
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promptInput.trim() || isRunning) return;
    startSession(promptInput.trim());
  };

  const toggleToolExpanded = (id: string) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const stagedFiles = activeSession?.stagedFiles ?? [];
  const unappliedStaged = stagedFiles.filter((f) => !f.isApplied);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border/60 px-4 py-3 bg-muted/20 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Bot className="h-4 w-4" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <span className="text-xs font-semibold tracking-tight whitespace-nowrap">Agent Workstation</span>
              <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary whitespace-nowrap">
                gemini-1.5-pro
              </span>
            </div>
          </div>

          {IS_AGENT_WORKSTATION_DISCONTINUED ? (
            <span
              data-testid="agent-status-label"
              className="inline-flex items-center gap-1 shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9.5px] font-mono font-medium text-amber-500 dark:text-amber-400 select-none shadow-sm whitespace-nowrap"
            >
              <Construction className="h-3 w-3 shrink-0" />
              <span>DISABLED</span>
            </span>
          ) : statusCfg ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
                statusCfg.className,
              )}
            >
              <statusCfg.icon className={cn('h-3 w-3', isRunning && 'animate-spin')} />
              {statusCfg.label}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground truncate pl-9">Autonomous Multi-File Workflows</p>
      </div>

      {/* Main Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error Alert */}
        {error && (
          <div className="flex items-start justify-between rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="text-destructive/70 hover:text-destructive text-[11px] underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Temporarily Discontinued Announcement Card OR Interactive Prompt Form */}
        {IS_AGENT_WORKSTATION_DISCONTINUED ? (
          <div
            data-testid="agent-discontinued-notice"
            className="relative overflow-hidden rounded-2xl border border-amber-500/25 bg-gradient-to-b from-amber-500/10 via-card/60 to-background/90 p-4 backdrop-blur-md shadow-xl transition-all"
          >
            {/* Maintenance Header */}
            <div className="flex items-center justify-between gap-2 pb-2.5 mb-3 border-b border-border/40">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 dark:text-amber-400">
                  <Construction className="h-3.5 w-3.5" />
                </div>
                <span className="text-[11px] font-mono uppercase tracking-wider font-semibold text-amber-500 dark:text-amber-400 whitespace-nowrap">
                  Dev Notice
                </span>
              </div>
              <span className="inline-flex items-center shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-mono font-bold tracking-tight text-amber-500 dark:text-amber-400 whitespace-nowrap">
                TEMPORARILY DISABLED
              </span>
            </div>

            {/* Exact Announcement Text (Tasteful developer sarcasm & Solar Tangerine highlight) */}
            <div className="space-y-3 text-xs leading-relaxed">
              <p className="font-medium text-slate-800 dark:text-zinc-200">
                Due to unexpected financial difficulties faced by our developer Yash, this feature has been temporarily discontinued.
              </p>

              <div className="rounded-lg border-l-2 border-amber-500/50 bg-amber-500/10 dark:bg-muted/40 px-3 py-2 font-mono text-[11px] italic text-slate-700 dark:text-zinc-300 leading-normal">
                Apparently, AI doesn't run on motivation.
              </div>

              <div className="pt-0.5 flex items-center gap-1.5 font-mono text-xs font-semibold text-orange-600 dark:text-primary">
                <Sparkles className="h-3.5 w-3.5 text-orange-600 dark:text-primary shrink-0 animate-pulse" />
                <span className="tracking-wide">Premium access coming soon.</span>
              </div>
            </div>
          </div>
        ) : (
          /* Prompt Input Form */
          <form onSubmit={handleSubmit} className="space-y-2">
            <label htmlFor="agent-prompt" className="text-xs font-medium text-foreground/80">
              Autonomous Goal or Refactoring Task:
            </label>
            <textarea
              id="agent-prompt"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              disabled={isRunning}
              placeholder="e.g. Implement input validation middleware and apply it to auth routes with tests..."
              className="w-full resize-none rounded-xl border border-border/80 bg-background/50 px-3 py-2 text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
              rows={3}
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Quarantines modifications to in-memory staging buffer.
              </span>
              {isRunning ? (
                <button
                  type="button"
                  onClick={cancelSession}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
                >
                  {isCancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <StopCircle className="h-3.5 w-3.5" />
                  )}
                  Stop Agent
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!promptInput.trim() || isStarting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground shadow transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {isStarting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Plan & Execute
                </button>
              )}
            </div>
          </form>
        )}

        {/* Self-Healing Banner */}
        {activeSession?.status === 'SELF_HEALING' && (
          <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-600 dark:text-orange-400">
            <div className="flex items-center gap-2 font-medium">
              <Wrench className="h-4 w-4 animate-spin shrink-0" />
              <span>Self-Healing Loop Active (Attempt {selfHealingCount || 1}/3)</span>
            </div>
            <p className="mt-1 text-[11px] opacity-90">
              TypeScript compiler diagnostics failed. The agent is analyzing compiler errors and staging targeted fixes.
            </p>
          </div>
        )}

        {/* Active Plan Steps */}
        {activeSession && activeSession.steps.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Execution Plan ({activeSession.steps.filter((s) => s.status === 'COMPLETED').length}/
              {activeSession.steps.length})
            </span>
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
              {activeSession.steps.map((step) => {
                const isStepRunning = step.status === 'RUNNING';
                const isStepCompleted = step.status === 'COMPLETED';
                const isStepFailed = step.status === 'FAILED';

                return (
                  <div key={step.id} className="flex items-start gap-2.5 text-xs">
                    <div className="mt-0.5 shrink-0">
                      {isStepCompleted && (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}
                      {isStepRunning && (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                      )}
                      {isStepFailed && (
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      )}
                      {step.status === 'PENDING' && (
                        <div className="flex h-4 w-4 items-center justify-center rounded-full border border-muted-foreground/40 font-mono text-[9px] text-muted-foreground">
                          {step.stepNumber}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            'font-medium truncate',
                            isStepCompleted && 'text-muted-foreground line-through',
                            isStepRunning && 'text-primary font-semibold',
                          )}
                        >
                          {step.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          #{step.stepNumber}
                        </span>
                      </div>
                      {step.description && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {step.description}
                        </p>
                      )}
                      {step.errorMessage && (
                        <p className="mt-1 text-[11px] text-destructive">
                          {step.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quarantined Staged Files Card */}
        {stagedFiles.length > 0 && (
          <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <FileCode2 className="h-4 w-4 text-primary" />
                <span className="text-xs font-semibold">
                  Quarantined Files ({unappliedStaged.length} pending review)
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDiffModalOpen(true)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Review Diffs
              </button>
            </div>

            <div className="space-y-1">
              {stagedFiles.map((sf) => (
                <div
                  key={sf.id}
                  className="flex items-center justify-between rounded-lg bg-background/60 px-2.5 py-1.5 text-xs font-mono border border-border/40"
                >
                  <span className="truncate">{sf.filePath}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {sf.hasConflict && (
                      <span className="text-amber-500" title="Concurrency Conflict">
                        <AlertTriangle className="h-3 w-3" />
                      </span>
                    )}
                    {sf.isApplied ? (
                      <span className="text-[10px] font-semibold text-emerald-500">
                        APPLIED
                      </span>
                    ) : (
                      <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold text-primary">
                        {sf.changeType}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {unappliedStaged.length > 0 && (
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => discardStaged()}
                  disabled={isDiscarding || isApplying}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => applyStaged()}
                  disabled={isApplying || isDiscarding}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50"
                >
                  {isApplying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  Accept All
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tool Execution Audit Log */}
        {activeSession && activeSession.toolCalls.length > 0 && (
          <div className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tool Audit Log ({activeSession.toolCalls.length})
            </span>
            <div className="space-y-1.5">
              {activeSession.toolCalls.map((tc) => {
                const isExpanded = expandedTools[tc.id] ?? false;
                const isToolRunning = tc.status === 'RUNNING';
                const isToolSuccess = tc.status === 'SUCCESS';

                return (
                  <div
                    key={tc.id}
                    className="rounded-lg border border-border/50 bg-background/50 text-xs overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleToolExpanded(tc.id)}
                      className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-muted/40 transition"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <Terminal className="h-3 w-3 shrink-0 text-primary opacity-80" />
                        <span className="font-mono font-medium truncate">{tc.toolName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {tc.durationMs != null && (
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {tc.durationMs}ms
                          </span>
                        )}
                        {isToolRunning && (
                          <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                        )}
                        {isToolSuccess && (
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                        )}
                        {tc.status === 'ERROR' && (
                          <AlertCircle className="h-3 w-3 text-destructive" />
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border/40 p-2 bg-muted/10 font-mono text-[11px] space-y-1 overflow-x-auto">
                        <div>
                          <span className="text-muted-foreground">Input: </span>
                          <pre className="whitespace-pre-wrap break-all text-foreground/80">
                            {JSON.stringify(tc.inputPayload, null, 2)}
                          </pre>
                        </div>
                        {tc.outputPayload && (
                          <div>
                            <span className="text-muted-foreground">Output: </span>
                            <pre className="whitespace-pre-wrap break-all text-emerald-600 dark:text-emerald-400">
                              {JSON.stringify(tc.outputPayload, null, 2)}
                            </pre>
                          </div>
                        )}
                        {tc.errorMessage && (
                          <div className="text-destructive">
                            <span className="font-semibold">Error: </span>
                            {tc.errorMessage}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Multi-File Monaco Diff Modal */}
      <StudioMultiFileDiffModal
        open={diffModalOpen}
        stagedFiles={stagedFiles}
        isApplying={isApplying}
        isDiscarding={isDiscarding}
        onClose={() => setDiffModalOpen(false)}
        onApply={applyStaged}
        onDiscard={discardStaged}
      />
    </div>
  );
}
