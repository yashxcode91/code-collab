import React, { useState } from 'react';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FileDiff,
  GitBranch,
  History,
  Loader2,
  Lock,
  RotateCcw,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import {
  CreateSnapshotSchema,
  SNAPSHOT_LIMITS,
  type BranchSnapshotSummaryDto,
  type ProjectBranchDto,
  type RestoreSnapshotInput,
} from '@codecollab/shared';
import { cn } from '@/lib/utils';

interface StudioHistoryPanelProps {
  branch: ProjectBranchDto | null;
  snapshots: BranchSnapshotSummaryDto[];
  totalCount?: number;
  nextCursor: string | null;
  currentUserId: string;
  isOwner: boolean;
  canEdit: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  isCreating: boolean;
  isRestoring: boolean;
  isDeleting: boolean;
  snapshotError: string | null;
  lastRestoreNotice: string | null;
  onCreateSnapshot: (input: {
    title: string;
    description?: string;
  }) => Promise<BranchSnapshotSummaryDto | null>;
  onRestoreSnapshot: (
    snapshotId: string,
    input?: RestoreSnapshotInput,
  ) => Promise<unknown>;
  onDeleteSnapshot: (snapshotId: string) => Promise<boolean>;
  onLoadMore: () => void;
  onOpenDiffModal: (snapshot: BranchSnapshotSummaryDto) => void;
  onClearError: () => void;
  onClearRestoreNotice: () => void;
}

const formatByteSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const formatRelativeTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/**
 * Right-hand Studio Inspector panel for creating immutable branch savepoints,
 * browsing version history, inspecting tree diffs, and rolling back safely.
 */
export function StudioHistoryPanel({
  branch,
  snapshots,
  totalCount,
  nextCursor,
  currentUserId,
  isOwner,
  canEdit,
  isLoading,
  isLoadingMore,
  isCreating,
  isRestoring,
  isDeleting,
  snapshotError,
  lastRestoreNotice,
  onCreateSnapshot,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onLoadMore,
  onOpenDiffModal,
  onClearError,
  onClearRestoreNotice,
}: StudioHistoryPanelProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [showDescription, setShowDescription] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);
  const [createSafetySnapshot, setCreateSafetySnapshot] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const canRestoreBranch = Boolean(
    branch && canEdit && (!branch.isProtected || isOwner),
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    const parsed = CreateSnapshotSchema.safeParse({
      title,
      ...(description.trim().length > 0 ? { description } : {}),
    });

    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Invalid snapshot input');
      return;
    }

    const created = await onCreateSnapshot(parsed.data);
    if (created) {
      setTitle('');
      setDescription('');
      setShowDescription(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Branch context summary */}
      <div className="glass-control flex items-center justify-between gap-2 rounded-xl px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch
            className="h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="truncate font-mono text-[11px] font-semibold text-foreground">
            {branch?.name ?? 'No active branch'}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {totalCount ?? snapshots.length}/{SNAPSHOT_LIMITS.MAX_SNAPSHOTS_PER_BRANCH}
        </span>
      </div>

      {/* Live remote restore banner */}
      {lastRestoreNotice && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
          <div className="flex items-start gap-2">
            <CheckCircle2
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{lastRestoreNotice}</span>
          </div>
          <button
            type="button"
            onClick={onClearRestoreNotice}
            aria-label="Dismiss restore notice"
            className="shrink-0 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* API / validation error */}
      {(snapshotError || formError) && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
          <div className="flex items-start gap-2">
            <AlertCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            <span>{formError ?? snapshotError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              onClearError();
            }}
            aria-label="Dismiss snapshot error"
            className="shrink-0 opacity-75 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Capture snapshot form (Editors & Owners) */}
      {canEdit ? (
        <form
          onSubmit={handleSubmit}
          className="glass-control space-y-2 rounded-2xl p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="snapshot-title-input"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground"
            >
              <Camera className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>Create Savepoint</span>
            </label>
            <button
              type="button"
              onClick={() => setShowDescription((prev) => !prev)}
              className="font-mono text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {showDescription ? 'Hide notes' : '+ Add notes'}
            </button>
          </div>

          <input
            id="snapshot-title-input"
            type="text"
            value={title}
            maxLength={SNAPSHOT_LIMITS.MAX_TITLE_CHARS}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Before auth refactor"
            disabled={!branch || isCreating}
            className="w-full rounded-xl border border-border/70 bg-background/70 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
          />

          {showDescription && (
            <textarea
              value={description}
              rows={2}
              maxLength={SNAPSHOT_LIMITS.MAX_DESCRIPTION_CHARS}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional summary of changes in this snapshot…"
              disabled={!branch || isCreating}
              className="w-full resize-none rounded-xl border border-border/70 bg-background/70 px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            />
          )}

          <button
            type="submit"
            disabled={!branch || isCreating || title.trim().length === 0}
            className="btn-studio-primary inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          >
            {isCreating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isCreating ? 'Capturing Yjs & Tree…' : 'Save Snapshot'}</span>
          </button>
        </form>
      ) : (
        <div className="glass-control flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Read-only access: viewers can inspect history and diffs.</span>
        </div>
      )}

      {branch?.isProtected && !isOwner && canEdit && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <ShieldAlert
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>
            Protected branch: you can capture snapshots, but only the workspace
            owner can restore or delete them.
          </span>
        </div>
      )}

      {/* Snapshot timeline */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 font-mono text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>Loading version history…</span>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="glass-control flex flex-col items-center justify-center gap-2 rounded-2xl px-4 py-8 text-center">
            <History
              className="h-6 w-6 text-muted-foreground/70"
              aria-hidden="true"
            />
            <p className="text-xs font-medium text-foreground">
              No snapshots on this branch yet
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Savepoints freeze the entire branch tree so you can inspect diffs
              or roll back anytime.
            </p>
          </div>
        ) : (
          snapshots.map((snap) => {
            const isCreator = snap.createdBy?.id === currentUserId;
            const canDeleteThis = Boolean(
              canEdit &&
                (!branch?.isProtected || isOwner) &&
                (isOwner || isCreator),
            );
            const isConfirmingRestore = confirmRestoreId === snap.id;
            const isConfirmingDelete = confirmDeleteId === snap.id;

            return (
              <div
                key={snap.id}
                className="glass-control space-y-2 rounded-2xl p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-xs font-semibold text-foreground">
                        {snap.title}
                      </span>
                      {snap.restoredFromSnapshotId && (
                        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-amber-700 dark:text-amber-300">
                          Safety Backup
                        </span>
                      )}
                    </div>
                    {snap.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                        {snap.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {formatRelativeTime(snap.createdAt)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>
                    by{' '}
                    <strong className="font-medium text-foreground/90">
                      @{snap.createdBy?.username ?? 'deleted-user'}
                    </strong>
                  </span>
                  <span>
                    {snap.fileCount} {snap.fileCount === 1 ? 'node' : 'nodes'} ·{' '}
                    {formatByteSize(snap.totalBytes)}
                  </span>
                </div>

                {/* Primary row actions */}
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onOpenDiffModal(snap)}
                    className="glass-control inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:border-primary/50 hover:text-primary"
                  >
                    <FileDiff className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Diff</span>
                  </button>

                  {canEdit && (
                    <button
                      type="button"
                      disabled={!canRestoreBranch || isRestoring}
                      title={
                        !canRestoreBranch
                          ? 'Only workspace owner can restore protected branches'
                          : 'Restore branch to this snapshot'
                      }
                      onClick={() => {
                        setConfirmDeleteId(null);
                        setConfirmRestoreId(
                          isConfirmingRestore ? null : snap.id,
                        );
                      }}
                      className={cn(
                        'inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-45',
                        isConfirmingRestore
                          ? 'border-primary/55 bg-primary/15 text-primary'
                          : 'glass-control text-foreground hover:border-primary/50 hover:text-primary',
                      )}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Restore</span>
                    </button>
                  )}

                  {canDeleteThis && (
                    <button
                      type="button"
                      disabled={isDeleting}
                      title="Delete snapshot"
                      aria-label={`Delete snapshot ${snap.title}`}
                      onClick={() => {
                        setConfirmRestoreId(null);
                        setConfirmDeleteId(
                          isConfirmingDelete ? null : snap.id,
                        );
                      }}
                      className={cn(
                        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition-colors',
                        isConfirmingDelete
                          ? 'border-destructive/50 bg-destructive/15 text-destructive'
                          : 'glass-control text-muted-foreground hover:border-destructive/40 hover:text-destructive',
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                {/* Inline Restore Confirmation */}
                {isConfirmingRestore && (
                  <div className="space-y-2 rounded-xl border border-primary/35 bg-primary/5 p-2.5">
                    <p className="text-[11px] leading-relaxed text-foreground">
                      Roll back <strong>{branch?.name}</strong> to{' '}
                      <strong>&ldquo;{snap.title}&rdquo;</strong>?
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={createSafetySnapshot}
                        onChange={(e) =>
                          setCreateSafetySnapshot(e.target.checked)
                        }
                        className="rounded border-border text-primary focus:ring-primary"
                      />
                      <span>Create safety backup before restoring</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isRestoring}
                        onClick={async () => {
                          const res = await onRestoreSnapshot(snap.id, {
                            createSafetySnapshot,
                          });
                          if (res) setConfirmRestoreId(null);
                        }}
                        className="btn-studio-primary inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold"
                      >
                        {isRestoring ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        <span>
                          {isRestoring ? 'Restoring…' : 'Confirm Restore'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreId(null)}
                        className="glass-control rounded-lg px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Delete Confirmation */}
                {isConfirmingDelete && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-2">
                    <span className="text-[11px] text-destructive">
                      Delete snapshot permanently?
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={async () => {
                          const ok = await onDeleteSnapshot(snap.id);
                          if (ok) setConfirmDeleteId(null);
                        }}
                        className="rounded-lg bg-destructive px-2 py-1 text-[11px] font-semibold text-destructive-foreground hover:opacity-90"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="glass-control rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {nextCursor && (
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={onLoadMore}
            className="glass-control flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {isLoadingMore && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            )}
            <span>
              {isLoadingMore ? 'Loading older snapshots…' : 'Load older history'}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
