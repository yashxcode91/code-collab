import { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  EyeOff,
  FileCode2,
  Folder,
  History,
  Loader2,
  Lock,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  BranchSnapshotSummaryDto,
  ProjectBranchDto,
  RestoreSnapshotInput,
  SnapshotFileDiffDto,
} from '@codecollab/shared';
import {
  ensureMonacoConfigured,
  STUDIO_DARK_THEME,
  STUDIO_LIGHT_THEME,
} from '@/components/studio-ide/monacoWorkerSetup';
import { resolveMonacoLanguage } from '@/components/studio-ide/studioLanguage';
import { useTheme } from '@/context/ThemeContext';
import { fetchBranchSnapshotDiff, queryKeys } from '@/lib/queries';
import { cn } from '@/lib/utils';

interface StudioSnapshotDiffModalProps {
  open: boolean;
  projectId: string;
  branch: ProjectBranchDto | null;
  baseSnapshot: BranchSnapshotSummaryDto | null;
  allSnapshots: BranchSnapshotSummaryDto[];
  canRestore: boolean;
  isRestoring: boolean;
  onClose: () => void;
  onRestore: (
    snapshotId: string,
    input?: RestoreSnapshotInput,
  ) => Promise<unknown>;
}

const DIFF_BADGE: Record<
  SnapshotFileDiffDto['status'],
  { label: string; className: string }
> = {
  added: {
    label: 'ADDED',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  modified: {
    label: 'MOD',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  deleted: {
    label: 'DEL',
    className: 'border-destructive/45 bg-destructive/15 text-destructive',
  },
  type_conflict: {
    label: 'CONFLICT',
    className: 'border-amber-500/45 bg-amber-500/15 text-amber-600 dark:text-amber-300',
  },
};

/**
 * Full-screen `.glass-mirror` modal pairing a tree diff change browser with
 * Monaco's built-in side-by-side `<DiffEditor />` and guarded Restore action.
 */
export function StudioSnapshotDiffModal({
  open,
  projectId,
  branch,
  baseSnapshot,
  allSnapshots,
  canRestore,
  isRestoring,
  onClose,
  onRestore,
}: StudioSnapshotDiffModalProps) {
  const { theme } = useTheme();
  const [targetSnapshotId, setTargetSnapshotId] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [createSafetySnapshot, setCreateSafetySnapshot] = useState(true);

  useEffect(() => {
    if (!open) return;
    setTargetSnapshotId('');
    setSelectedPath(null);
    setCreateSafetySnapshot(true);
  }, [open, baseSnapshot?.id]);

  const branchId = branch?.id ?? '';
  const snapshotId = baseSnapshot?.id ?? '';
  const normalizedTargetId =
    targetSnapshotId.trim().length > 0 ? targetSnapshotId : null;

  const diffQuery = useQuery({
    queryKey: queryKeys.projects.snapshotDiff(
      projectId,
      branchId || 'none',
      snapshotId || 'none',
      normalizedTargetId,
    ),
    queryFn: () =>
      fetchBranchSnapshotDiff(
        projectId,
        branchId,
        snapshotId,
        normalizedTargetId,
      ),
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: Boolean(open && projectId && branchId && snapshotId),
  });

  const changes = diffQuery.data?.changes ?? [];
  const activeChange = useMemo(
    () => changes.find((c) => c.path === selectedPath) ?? changes[0] ?? null,
    [changes, selectedPath],
  );

  useEffect(() => {
    if (changes.length > 0 && !changes.some((c) => c.path === selectedPath)) {
      setSelectedPath(changes[0].path);
    }
  }, [changes, selectedPath]);

  const comparableTargets = useMemo(
    () => allSnapshots.filter((s) => s.id !== snapshotId),
    [allSnapshots, snapshotId],
  );

  const hasRestoreBlocker = useMemo(
    () =>
      !normalizedTargetId &&
      changes.some((change) => change.blockedByLockOrAcl),
    [changes, normalizedTargetId],
  );

  if (!open || !baseSnapshot) {
    return null;
  }

  const handleBeforeMount = () => {
    ensureMonacoConfigured();
  };

  const activeFileName = activeChange?.path.split('/').pop() ?? 'file.txt';
  const monacoLanguage = resolveMonacoLanguage(activeFileName, 'typescript');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-md sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Snapshot Diff Inspector"
    >
      <div className="glass-mirror relative flex h-[min(86vh,760px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl">
        {/* Modal Header */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <History className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">
                Snapshot Diff: {baseSnapshot.title}
              </h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                Branch {branch?.name} ·{' '}
                {normalizedTargetId ? 'Snapshot vs Snapshot' : 'Snapshot vs Live Workspace'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <span>Compare with:</span>
              <select
                value={targetSnapshotId}
                onChange={(e) => setTargetSnapshotId(e.target.value)}
                className="glass-control rounded-xl px-2.5 py-1 text-xs text-foreground focus:outline-none"
              >
                <option value="">Live branch ({branch?.name})</option>
                {comparableTargets.map((snap) => (
                  <option key={snap.id} value={snap.id}>
                    {snap.title}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close diff modal"
              className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Summary Bar */}
        {diffQuery.data && (
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-card/30 px-5 py-2">
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-emerald-600 dark:text-emerald-300">
                +{diffQuery.data.summary.added} added
              </span>
              <span className="rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 text-primary">
                ~{diffQuery.data.summary.modified} modified
              </span>
              <span className="rounded-full border border-destructive/35 bg-destructive/10 px-2.5 py-0.5 text-destructive">
                -{diffQuery.data.summary.deleted} deleted
              </span>
              {diffQuery.data.summary.redactedCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-amber-700 dark:text-amber-300">
                  <EyeOff className="h-3 w-3" aria-hidden="true" />
                  {diffQuery.data.summary.redactedCount} ACL-restricted hidden
                </span>
              )}
            </div>

            {!normalizedTargetId && canRestore && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={createSafetySnapshot}
                    onChange={(e) => setCreateSafetySnapshot(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>Safety backup first</span>
                </label>

                <button
                  type="button"
                  disabled={isRestoring || hasRestoreBlocker}
                  title={
                    hasRestoreBlocker
                      ? 'One or more changed files are locked or read-only'
                      : 'Restore branch to this snapshot'
                  }
                  onClick={async () => {
                    const res = await onRestore(snapshotId, {
                      createSafetySnapshot,
                    });
                    if (res) onClose();
                  }}
                  className="btn-studio-primary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-45"
                >
                  {isRestoring ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {isRestoring ? 'Restoring…' : 'Restore Snapshot'}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Modal Body: Change List + Monaco Side-by-Side DiffEditor */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col sm:flex-row">
          {diffQuery.isLoading ? (
            <div className="flex flex-1 items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Computing branch tree diff…</span>
            </div>
          ) : diffQuery.isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <AlertCircle className="h-6 w-6 text-destructive" />
              <p className="text-xs font-medium text-destructive">
                {diffQuery.error instanceof Error
                  ? diffQuery.error.message
                  : 'Unable to load snapshot diff'}
              </p>
            </div>
          ) : changes.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileCode2 className="h-7 w-7 text-muted-foreground/70" />
              <p className="text-sm font-semibold text-foreground">
                No differences detected
              </p>
              <p className="text-xs text-muted-foreground">
                The selected snapshot matches{' '}
                {normalizedTargetId ? 'the comparison snapshot' : 'the live branch'} identically.
              </p>
            </div>
          ) : (
            <>
              {/* Changed Paths Sidebar */}
              <aside className="w-full shrink-0 space-y-1 overflow-y-auto border-b border-border/60 p-3 sm:w-64 sm:border-b-0 sm:border-r">
                {changes.map((change) => {
                  const badge = DIFF_BADGE[change.status];
                  const isActive = activeChange?.path === change.path;
                  return (
                    <button
                      key={change.path}
                      type="button"
                      onClick={() => setSelectedPath(change.path)}
                      className={cn(
                        'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors',
                        isActive
                          ? 'border border-primary/45 bg-primary/15 text-foreground'
                          : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {change.nodeType === 'folder' ? (
                          <Folder className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <FileCode2 className="h-3.5 w-3.5 shrink-0" />
                        )}
                        <span className="truncate font-mono text-[11px]">
                          {change.path}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {change.blockedByLockOrAcl && (
                          <Lock
                            className="h-3 w-3 text-amber-500"
                            aria-label="Restore blocked by lock or ACL"
                          />
                        )}
                        <span
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold',
                            badge.className,
                          )}
                        >
                          {badge.label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </aside>

              {/* Right Monaco Diff Pane */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {activeChange?.blockedByLockOrAcl && activeChange.blockedReason && (
                  <div className="flex items-center gap-2 border-b border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{activeChange.blockedReason}</span>
                  </div>
                )}

                {activeChange?.nodeType === 'folder' ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                    <Folder className="h-8 w-8 text-primary/70" />
                    <p className="font-mono text-xs font-semibold text-foreground">
                      {activeChange.path}/
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Folder node ({activeChange.status})
                    </p>
                  </div>
                ) : (
                  <div className="min-h-0 flex-1">
                    <DiffEditor
                      height="100%"
                      width="100%"
                      language={monacoLanguage}
                      original={activeChange?.baseContent ?? ''}
                      modified={activeChange?.targetContent ?? ''}
                      theme={
                        theme === 'dark'
                          ? STUDIO_DARK_THEME
                          : STUDIO_LIGHT_THEME
                      }
                      beforeMount={handleBeforeMount}
                      options={{
                        readOnly: true,
                        renderSideBySide: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 12.5,
                        automaticLayout: true,
                      }}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
