import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  FileCode2,
  Folder,
  GitBranch,
  GitMerge,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  BranchMergeFileChangeDto,
  BranchMergeResolution,
  BranchMergeResultResponse,
  Project,
  ProjectBranchDto,
} from '@codecollab/shared';
import { ApiClientError } from '@/lib/api';
import {
  fetchBranchMergePreview,
  mergeBranches,
  queryKeys,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

interface BranchMergeModalProps {
  open: boolean;
  project: Project;
  branches: ProjectBranchDto[];
  activeBranchId: string | null;
  presetSourceBranchId?: string | null;
  presetTargetBranchId?: string | null;
  dirtyCount: number;
  onClose: () => void;
  onMerged: (result: BranchMergeResultResponse) => Promise<void> | void;
}

const STATUS_BADGE: Record<
  BranchMergeFileChangeDto['status'],
  { label: string; className: string }
> = {
  added: {
    label: 'ADD',
    className:
      'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  },
  modified: {
    label: 'MOD',
    className: 'border-primary/40 bg-primary/10 text-primary',
  },
  type_conflict: {
    label: 'CONFLICT',
    className: 'border-destructive/45 bg-destructive/15 text-destructive',
  },
};

/**
 * Crystal `.glass-mirror` dialog for Git-style branch diff preview,
 * per-file conflict resolution (`Use Source`, `Keep Target`, `Edit Merged`),
 * and atomic server-side merging with live Yjs synchronization.
 */
export function BranchMergeModal({
  open,
  project,
  branches,
  activeBranchId,
  presetSourceBranchId,
  presetTargetBranchId,
  dirtyCount,
  onClose,
  onMerged,
}: BranchMergeModalProps) {
  const isOwner = project.currentUserRole === 'owner';

  const [sourceBranchId, setSourceBranchId] = useState<string>('');
  const [targetBranchId, setTargetBranchId] = useState<string>('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, BranchMergeResolution>
  >({});
  const [customContents, setCustomContents] = useState<Record<string, string>>(
    {},
  );
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Initialize sensible default Source -> Target direction when opened
  useEffect(() => {
    if (!open || branches.length < 2) return;

    const defaultMain = branches.find((b) => b.isDefault) ?? branches[0];
    const active =
      branches.find((b) => b.id === activeBranchId) ?? defaultMain;

    let initialTarget =
      presetTargetBranchId &&
      branches.some((b) => b.id === presetTargetBranchId)
        ? presetTargetBranchId
        : defaultMain.id;

    let initialSource =
      presetSourceBranchId &&
      branches.some((b) => b.id === presetSourceBranchId)
        ? presetSourceBranchId
        : active.id !== initialTarget
          ? active.id
          : (branches.find((b) => b.id !== initialTarget)?.id ?? '');

    if (initialSource === initialTarget) {
      const alt = branches.find((b) => b.id !== initialSource);
      if (alt) {
        initialTarget = alt.id;
      }
    }

    setSourceBranchId(initialSource);
    setTargetBranchId(initialTarget);
    setSelectedPath(null);
    setResolutions({});
    setCustomContents({});
    setDeleteSourceBranch(false);
    setMergeError(null);
  }, [
    open,
    branches,
    activeBranchId,
    presetSourceBranchId,
    presetTargetBranchId,
  ]);

  // Close cleanly on Escape key
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const sourceBranch = useMemo(
    () => branches.find((b) => b.id === sourceBranchId) ?? null,
    [branches, sourceBranchId],
  );
  const targetBranch = useMemo(
    () => branches.find((b) => b.id === targetBranchId) ?? null,
    [branches, targetBranchId],
  );

  const sameBranchSelected =
    Boolean(sourceBranchId) && sourceBranchId === targetBranchId;

  const previewQuery = useQuery({
    queryKey: queryKeys.projects.mergePreview(
      project.id,
      targetBranchId || 'none',
      sourceBranchId || 'none',
    ),
    queryFn: () =>
      fetchBranchMergePreview(project.id, targetBranchId, sourceBranchId),
    enabled: Boolean(
      open && sourceBranchId && targetBranchId && !sameBranchSelected,
    ),
    staleTime: 0,
    gcTime: 0,
  });

  const changes = previewQuery.data?.changes ?? [];

  // Select first change automatically when preview loads or branch pair changes
  useEffect(() => {
    if (!previewQuery.data) {
      setSelectedPath(null);
      return;
    }
    if (changes.length === 0) {
      setSelectedPath(null);
      return;
    }
    if (!selectedPath || !changes.some((c) => c.path === selectedPath)) {
      setSelectedPath(changes[0].path);
    }
  }, [previewQuery.data, changes, selectedPath]);

  // Clear deleteSourceBranch toggle if switching to a default source branch
  useEffect(() => {
    if (!isOwner || sourceBranch?.isDefault) {
      setDeleteSourceBranch(false);
    }
  }, [isOwner, sourceBranch?.isDefault]);

  const selectedChange = useMemo(
    () => changes.find((c) => c.path === selectedPath) ?? null,
    [changes, selectedPath],
  );

  // Evaluate live merge blockers considering user's per-file `keep_target` overrides
  const effectiveBlockingReason = useMemo(() => {
    if (sameBranchSelected) {
      return 'Source and target branches must be different';
    }
    const preview = previewQuery.data;
    if (!preview) return null;

    if (preview.targetBranch.isProtected && !isOwner) {
      return 'Target branch is protected; only workspace owners can merge into it';
    }

    if (preview.summary.typeConflicts > 0) {
      return 'Resolve file/folder path type conflicts before merging';
    }

    for (const change of preview.changes) {
      const chosen = resolutions[change.path] ?? 'take_source';
      if (chosen !== 'keep_target' && change.blockedByLockOrAcl) {
        return change.blockedReason ?? `Blocked on "${change.path}"`;
      }
    }

    return null;
  }, [sameBranchSelected, previewQuery.data, isOwner, resolutions]);

  const mergeMutation = useMutation({
    mutationFn: () =>
      mergeBranches(project.id, targetBranchId, {
        sourceBranchId,
        resolutions,
        customContents,
        deleteSourceBranch:
          isOwner && !sourceBranch?.isDefault ? deleteSourceBranch : false,
      }),
    onSuccess: async (result) => {
      setMergeError(null);
      await onMerged(result);
      onClose();
    },
    onError: (err) => {
      setMergeError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to complete branch merge',
      );
    },
  });

  const handleSwapDirections = () => {
    if (!sourceBranchId || !targetBranchId) return;
    setSourceBranchId(targetBranchId);
    setTargetBranchId(sourceBranchId);
    setResolutions({});
    setCustomContents({});
    setMergeError(null);
  };

  const handleSetResolution = (
    change: BranchMergeFileChangeDto,
    next: BranchMergeResolution,
  ) => {
    setResolutions((prev) => ({ ...prev, [change.path]: next }));
    if (next === 'custom' && customContents[change.path] === undefined) {
      setCustomContents((prev) => ({
        ...prev,
        [change.path]: change.sourceContent ?? change.targetContent ?? '',
      }));
    }
    setMergeError(null);
  };

  const selectedResolution: BranchMergeResolution = selectedChange
    ? (resolutions[selectedChange.path] ?? 'take_source')
    : 'take_source';

  const canSubmitMerge =
    Boolean(previewQuery.data) &&
    !previewQuery.isFetching &&
    !sameBranchSelected &&
    effectiveBlockingReason === null &&
    !mergeMutation.isPending &&
    (previewQuery.data?.summary.totalChanges ?? 0) > 0;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="branch-merge-title"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="glass-mirror relative z-10 flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl p-5 sm:p-6"
          >
            {/* Header */}
            <div className="relative z-10 flex shrink-0 items-start justify-between gap-3 border-b border-border/60 pb-4">
              <div>
                <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-primary">
                  <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Branch Merge Workbench</span>
                </span>
                <h2
                  id="branch-merge-title"
                  className="mt-1 text-lg font-semibold tracking-tight text-foreground"
                >
                  Merge Changes Across Branches
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void previewQuery.refetch()}
                  disabled={previewQuery.isFetching || sameBranchSelected}
                  title="Refresh branch diff"
                  className="glass-control inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw
                    className={cn(
                      'h-3.5 w-3.5',
                      previewQuery.isFetching && 'animate-spin',
                    )}
                    aria-hidden="true"
                  />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close branch merge modal"
                  className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Source -> Target Branch Selector Bar */}
            <div className="relative z-10 mt-4 grid shrink-0 grid-cols-1 items-end gap-2.5 sm:grid-cols-[1fr_auto_1fr]">
              <div className="space-y-1">
                <label
                  htmlFor="merge-source-branch"
                  className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                >
                  <GitBranch className="h-3 w-3 text-primary" aria-hidden="true" />
                  <span>Source Branch (from)</span>
                </label>
                <select
                  id="merge-source-branch"
                  value={sourceBranchId}
                  onChange={(e) => {
                    setSourceBranchId(e.target.value);
                    setResolutions({});
                    setCustomContents({});
                    setMergeError(null);
                  }}
                  className="glass-control h-9 w-full rounded-xl px-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                      {branch.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleSwapDirections}
                title="Swap source and target branches"
                aria-label="Swap source and target branches"
                className="glass-control mx-auto inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-primary"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>

              <div className="space-y-1">
                <label
                  htmlFor="merge-target-branch"
                  className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                >
                  <ArrowRight className="h-3 w-3 text-primary" aria-hidden="true" />
                  <span>Target Branch (into)</span>
                  {targetBranch?.isProtected && (
                    <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">
                      <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" />
                      protected
                    </span>
                  )}
                </label>
                <select
                  id="merge-target-branch"
                  value={targetBranchId}
                  onChange={(e) => {
                    setTargetBranchId(e.target.value);
                    setResolutions({});
                    setCustomContents({});
                    setMergeError(null);
                  }}
                  className="glass-control h-9 w-full rounded-xl px-3 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                      {branch.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Warnings & Summary Strip */}
            <div className="relative z-10 mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
              {previewQuery.data ? (
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-600 dark:text-emerald-300">
                    +{previewQuery.data.summary.added} added
                  </span>
                  <span className="rounded-lg border border-primary/35 bg-primary/10 px-2 py-0.5 text-primary">
                    ~{previewQuery.data.summary.modified} modified
                  </span>
                  {previewQuery.data.summary.typeConflicts > 0 && (
                    <span className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive">
                      !{previewQuery.data.summary.typeConflicts} type conflicts
                    </span>
                  )}
                  <span className="rounded-lg border border-border/60 bg-background/40 px-2 py-0.5 text-muted-foreground">
                    ={previewQuery.data.summary.unchanged} unchanged
                  </span>
                </div>
              ) : (
                <div />
              )}

              {dirtyCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 font-mono text-[10.5px] text-amber-600 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>
                    {dirtyCount} unsaved local draft{dirtyCount === 1 ? '' : 's'} — save REST edits before merging
                  </span>
                </span>
              )}
            </div>

            {(mergeError || previewQuery.isError || effectiveBlockingReason) && (
              <div className="relative z-10 mt-3 flex shrink-0 items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {mergeError ??
                    (previewQuery.error instanceof Error
                      ? previewQuery.error.message
                      : null) ??
                    effectiveBlockingReason}
                </span>
              </div>
            )}

            {/* Diff & Resolution Workbench Body */}
            <div className="relative z-10 mt-3 min-h-[260px] flex-1 overflow-hidden rounded-2xl border border-border/60 bg-background/45">
              {sameBranchSelected ? (
                <div className="flex h-full items-center justify-center p-8 text-center font-mono text-xs text-muted-foreground">
                  Select two different branches to compare changes.
                </div>
              ) : previewQuery.isLoading ? (
                <div className="flex h-full items-center justify-center gap-2 p-8 font-mono text-xs text-muted-foreground">
                  <Loader2
                    className="h-4 w-4 animate-spin text-primary"
                    aria-hidden="true"
                  />
                  <span>Computing branch file diff…</span>
                </div>
              ) : changes.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                  <CheckCircle2
                    className="h-7 w-7 text-emerald-500"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-foreground">
                    No differences to merge
                  </p>
                  <p className="max-w-md font-mono text-xs text-muted-foreground">
                    All files in{' '}
                    <span className="text-foreground">
                      {sourceBranch?.name}
                    </span>{' '}
                    already match{' '}
                    <span className="text-foreground">
                      {targetBranch?.name}
                    </span>
                    .
                  </p>
                </div>
              ) : (
                <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[260px_1fr]">
                  {/* Left: Changed File List */}
                  <ul className="max-h-56 space-y-1 overflow-y-auto border-b border-border/60 p-2 md:max-h-full md:border-b-0 md:border-r">
                    {changes.map((change) => {
                      const active = change.path === selectedPath;
                      const badge = STATUS_BADGE[change.status];
                      const chosen = resolutions[change.path] ?? 'take_source';
                      const blocked =
                        chosen !== 'keep_target' && change.blockedByLockOrAcl;

                      return (
                        <li key={change.path}>
                          <button
                            type="button"
                            onClick={() => setSelectedPath(change.path)}
                            className={cn(
                              'flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-colors',
                              active
                                ? 'border border-primary/45 bg-primary/[0.12] text-foreground'
                                : 'hover:bg-foreground/[0.04] text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              {change.nodeType === 'folder' ? (
                                <Folder
                                  className="h-3.5 w-3.5 shrink-0 text-primary"
                                  aria-hidden="true"
                                />
                              ) : (
                                <FileCode2
                                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="truncate font-mono text-[11px]">
                                {change.path}
                              </span>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {blocked && (
                                <Lock
                                  className="h-3 w-3 text-destructive"
                                  aria-label={change.blockedReason ?? 'Blocked'}
                                />
                              )}
                              {chosen === 'keep_target' && (
                                <span className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                                  skip
                                </span>
                              )}
                              {chosen === 'custom' && (
                                <span className="rounded bg-primary/20 px-1 py-0.5 font-mono text-[9px] text-primary">
                                  edit
                                </span>
                              )}
                              <span
                                className={cn(
                                  'rounded border px-1 py-0.5 font-mono text-[9px] font-semibold',
                                  badge.className,
                                )}
                              >
                                {badge.label}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {/* Right: Selected Change Preview & Resolution Controls */}
                  {selectedChange ? (
                    <div className="flex min-h-0 flex-col overflow-y-auto p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs font-semibold text-foreground">
                            {selectedChange.path}
                          </p>
                          <p className="font-mono text-[10.5px] text-muted-foreground">
                            {selectedChange.status === 'added'
                              ? `New ${selectedChange.nodeType} from ${sourceBranch?.name}`
                              : selectedChange.status === 'modified'
                                ? `Modified on ${sourceBranch?.name} vs ${targetBranch?.name}`
                                : selectedChange.blockedReason}
                          </p>
                        </div>

                        {selectedChange.nodeType === 'file' &&
                          selectedChange.status !== 'type_conflict' && (
                            <div className="flex flex-wrap items-center gap-1">
                              <button
                                type="button"
                                disabled={selectedChange.blockedByLockOrAcl}
                                onClick={() =>
                                  handleSetResolution(
                                    selectedChange,
                                    'take_source',
                                  )
                                }
                                className={cn(
                                  'rounded-lg px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                                  selectedResolution === 'take_source'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'glass-control text-muted-foreground hover:text-foreground',
                                )}
                              >
                                Use Source
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetResolution(
                                    selectedChange,
                                    'keep_target',
                                  )
                                }
                                className={cn(
                                  'rounded-lg px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors',
                                  selectedResolution === 'keep_target'
                                    ? 'bg-foreground text-background'
                                    : 'glass-control text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {selectedChange.status === 'added'
                                  ? 'Skip Adding'
                                  : 'Keep Target'}
                              </button>
                              <button
                                type="button"
                                disabled={selectedChange.blockedByLockOrAcl}
                                onClick={() =>
                                  handleSetResolution(selectedChange, 'custom')
                                }
                                className={cn(
                                  'rounded-lg px-2.5 py-1 font-mono text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                                  selectedResolution === 'custom'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'glass-control text-muted-foreground hover:text-foreground',
                                )}
                              >
                                Edit Merged
                              </button>
                            </div>
                          )}
                      </div>

                      {selectedChange.blockedByLockOrAcl && (
                        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-600 dark:text-amber-300">
                          <span>{selectedChange.blockedReason}</span>
                          {selectedChange.status === 'modified' &&
                            selectedResolution !== 'keep_target' && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleSetResolution(
                                    selectedChange,
                                    'keep_target',
                                  )
                                }
                                className="shrink-0 rounded-lg bg-amber-500/20 px-2 py-0.5 font-semibold hover:bg-amber-500/30"
                              >
                                Keep Target Instead
                              </button>
                            )}
                        </div>
                      )}

                      {/* File Content Diff / Custom Merge Editor */}
                      <div className="mt-3 flex-1">
                        {selectedChange.status === 'type_conflict' ? (
                          <div className="rounded-xl border border-destructive/35 bg-destructive/10 p-4 font-mono text-xs text-destructive">
                            {selectedChange.blockedReason}. Rename or delete one
                            side before merging.
                          </div>
                        ) : selectedChange.nodeType === 'folder' ? (
                          <div className="rounded-xl border border-border/60 bg-card/50 p-4 font-mono text-xs text-muted-foreground">
                            Empty folder{' '}
                            <span className="text-foreground">
                              {selectedChange.path}/
                            </span>{' '}
                            will be created inside{' '}
                            <span className="text-foreground">
                              {targetBranch?.name}
                            </span>
                            .
                          </div>
                        ) : selectedResolution === 'custom' ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
                              <span>Custom merged output for {selectedChange.path}</span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCustomContents((prev) => ({
                                      ...prev,
                                      [selectedChange.path]:
                                        selectedChange.sourceContent ?? '',
                                    }))
                                  }
                                  className="hover:text-primary"
                                >
                                  Reset to Source
                                </button>
                                {selectedChange.targetContent !== null && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCustomContents((prev) => ({
                                        ...prev,
                                        [selectedChange.path]:
                                          selectedChange.targetContent ?? '',
                                      }))
                                    }
                                    className="hover:text-primary"
                                  >
                                    Reset to Target
                                  </button>
                                )}
                              </div>
                            </div>
                            <textarea
                              value={
                                customContents[selectedChange.path] ??
                                selectedChange.sourceContent ??
                                ''
                              }
                              onChange={(e) =>
                                setCustomContents((prev) => ({
                                  ...prev,
                                  [selectedChange.path]: e.target.value,
                                }))
                              }
                              rows={11}
                              spellCheck={false}
                              className="w-full rounded-xl border border-primary/40 bg-card/85 p-3 font-mono text-xs leading-relaxed text-foreground focus:border-primary focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div
                            className={cn(
                              'grid gap-2.5',
                              selectedChange.status === 'modified'
                                ? 'grid-cols-1 lg:grid-cols-2'
                                : 'grid-cols-1',
                            )}
                          >
                            <div
                              className={cn(
                                'overflow-hidden rounded-xl border',
                                selectedResolution === 'take_source'
                                  ? 'border-emerald-500/45 bg-emerald-500/[0.04]'
                                  : 'border-border/60 bg-card/40 opacity-65',
                              )}
                            >
                              <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 font-mono text-[10.5px]">
                                <span className="font-semibold text-foreground">
                                  Source · {sourceBranch?.name}
                                </span>
                                {selectedResolution === 'take_source' && (
                                  <span className="text-emerald-600 dark:text-emerald-300">
                                    incoming
                                  </span>
                                )}
                              </div>
                              <pre className="max-h-60 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground">
                                {selectedChange.sourceContent ??
                                  '(Restricted or empty)'}
                              </pre>
                            </div>

                            {selectedChange.status === 'modified' && (
                              <div
                                className={cn(
                                  'overflow-hidden rounded-xl border',
                                  selectedResolution === 'keep_target'
                                    ? 'border-primary/50 bg-primary/[0.06]'
                                    : 'border-border/60 bg-card/40 opacity-75',
                                )}
                              >
                                <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5 font-mono text-[10.5px]">
                                  <span className="font-semibold text-foreground">
                                    Target · {targetBranch?.name}
                                  </span>
                                  {selectedResolution === 'keep_target' && (
                                    <span className="text-primary">kept</span>
                                  )}
                                </div>
                                <pre className="max-h-60 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground">
                                  {selectedChange.targetContent ??
                                    '(Restricted or empty)'}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="relative z-10 mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
              <div>
                {isOwner && sourceBranch && !sourceBranch.isDefault ? (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
                    <input
                      type="checkbox"
                      checked={deleteSourceBranch}
                      onChange={(e) => setDeleteSourceBranch(e.target.checked)}
                      className="h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
                    />
                    <span>
                      Delete source branch{' '}
                      <span className="font-mono text-foreground">
                        {sourceBranch.name}
                      </span>{' '}
                      after merge
                    </span>
                  </label>
                ) : (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Default resolution applies incoming changes from source unless customized.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="glass-control rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canSubmitMerge}
                  onClick={() => mergeMutation.mutate()}
                  className="btn-studio-primary inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mergeMutation.isPending ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>
                    {mergeMutation.isPending
                      ? 'Merging…'
                      : `Merge ${sourceBranch?.name ?? ''} → ${targetBranch?.name ?? ''}`}
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
