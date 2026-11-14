import { useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import type { AgentFileChangeTypeDto, AgentStagedFileDto } from '@codecollab/shared';
import {
  ensureMonacoConfigured,
  STUDIO_DARK_THEME,
  STUDIO_LIGHT_THEME,
} from '@/components/studio-ide/monacoWorkerSetup';
import { resolveMonacoLanguage } from '@/components/studio-ide/studioLanguage';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

export interface StudioMultiFileDiffModalProps {
  open: boolean;
  stagedFiles: AgentStagedFileDto[];
  isApplying: boolean;
  isDiscarding: boolean;
  onClose: () => void;
  onApply: (filePaths?: string[]) => Promise<void> | void;
  onDiscard: (filePaths?: string[]) => Promise<void> | void;
}

const CHANGE_TYPE_BADGES: Record<
  AgentFileChangeTypeDto,
  { label: string; className: string }
> = {
  CREATE: {
    label: 'NEW',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  },
  MODIFY: {
    label: 'MOD',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-500',
  },
  DELETE: {
    label: 'DEL',
    className: 'border-red-500/40 bg-red-500/10 text-red-500',
  },
};

export function StudioMultiFileDiffModal({
  open,
  stagedFiles,
  isApplying,
  isDiscarding,
  onClose,
  onApply,
  onDiscard,
}: StudioMultiFileDiffModalProps) {
  const { theme } = useTheme();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const activeStagedFile = useMemo(() => {
    if (!stagedFiles.length) return null;
    if (selectedPath) {
      const match = stagedFiles.find((f) => f.filePath === selectedPath);
      if (match) return match;
    }
    return stagedFiles[0] ?? null;
  }, [stagedFiles, selectedPath]);

  const hasAnyConflict = useMemo(() => {
    return stagedFiles.some((f) => f.hasConflict && !f.isApplied);
  }, [stagedFiles]);

  if (!open) return null;

  const currentLanguage = activeStagedFile
    ? resolveMonacoLanguage(activeStagedFile.filePath, 'typescript')
    : 'plaintext';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="diff-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex h-[90vh] w-[95vw] max-w-7xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background/95 shadow-2xl backdrop-blur-xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileCode2 className="h-5 w-5" />
            </div>
            <div>
              <h2 id="diff-modal-title" className="text-base font-semibold tracking-tight text-foreground">
                Quarantined Multi-File Staging Review
              </h2>
              <p className="text-xs text-muted-foreground">
                Inspect AI-generated diffs before applying atomically to the active branch.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close diff modal"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="grid flex-1 grid-cols-12 overflow-hidden">
          {/* Left: Staged Files Sidebar */}
          <div className="col-span-4 flex flex-col border-r border-border/60 bg-muted/20">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Staged Files ({stagedFiles.length})
              </span>
              {hasAnyConflict && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Conflicts Detected
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {stagedFiles.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  No staged files in quarantine.
                </div>
              ) : (
                stagedFiles.map((file) => {
                  const isSelected = activeStagedFile?.filePath === file.filePath;
                  const badge = CHANGE_TYPE_BADGES[file.changeType] ?? CHANGE_TYPE_BADGES.MODIFY;

                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setSelectedPath(file.filePath)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition',
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground/80 hover:bg-muted/50',
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileCode2 className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="truncate font-mono">{file.filePath}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {file.hasConflict && (
                          <span
                            title="File modified concurrently by collaborator"
                            className="flex items-center text-amber-500"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {file.isApplied ? (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                            APPLIED
                          </span>
                        ) : (
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 text-[10px] font-semibold border',
                              badge.className,
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Monaco Diff Editor Pane */}
          <div className="col-span-8 flex flex-col overflow-hidden bg-background">
            {activeStagedFile ? (
              <>
                {/* File Header / Conflict Notice */}
                <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 text-xs bg-muted/10">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-foreground">
                      {activeStagedFile.filePath}
                    </span>
                    <span className="text-muted-foreground">
                      ({activeStagedFile.changeType.toLowerCase()})
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-red-500/80" /> Original
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500/80" /> Proposed
                    </span>
                  </div>
                </div>

                {activeStagedFile.hasConflict && (
                  <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      <strong>Concurrency Conflict:</strong> This file has drifted in the repository since the agent started. Applying directly will be rejected to protect your recent edits.
                    </span>
                  </div>
                )}

                <div className="flex-1 overflow-hidden">
                  <DiffEditor
                    original={activeStagedFile.originalContent ?? ''}
                    modified={activeStagedFile.stagedContent}
                    language={currentLanguage}
                    theme={theme === 'dark' ? STUDIO_DARK_THEME : STUDIO_LIGHT_THEME}
                    beforeMount={ensureMonacoConfigured}
                    options={{
                      readOnly: true,
                      renderSideBySide: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      fontSize: 12,
                      automaticLayout: true,
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Select a staged file from the left to inspect its diff.
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/10 px-6 py-3.5">
          <button
            type="button"
            onClick={() => onDiscard()}
            disabled={isDiscarding || isApplying || stagedFiles.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-50"
          >
            {isDiscarding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Discard All Changes
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border/60 px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onApply()}
              disabled={isApplying || isDiscarding || stagedFiles.length === 0 || hasAnyConflict}
              title={hasAnyConflict ? 'Cannot apply while conflicts exist' : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isApplying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              Accept & Apply All Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
