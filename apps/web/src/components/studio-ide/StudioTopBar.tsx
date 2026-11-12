import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  GitBranch,
  GitMerge,
  History,
  Loader2,
  Lock,
  LockOpen,
  Maximize2,
  MessageSquare,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BranchNameSchema,
  COLLAB_LIMITS,
  type Project,
  type ProjectBranchDto,
  type ProjectDetailResponse,
  type ProjectFileNodeDto,
  type RealtimePresenceUser,
} from '@codecollab/shared';
import type {
  RealtimeConnectionStatus,
  RealtimeSyncStatus,
} from '@/hooks/useRealtimeCollab';
import { BrandMark } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ApiClientError } from '@/lib/api';
import {
  createBranch,
  deleteBranch,
  queryKeys,
  updateBranch,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { InspectorTab } from '@/stores/useStudioStore';

interface StudioTopBarProps {
  project: Project;
  branches: ProjectBranchDto[];
  activeBranch: ProjectBranchDto | null;
  activeFile: ProjectFileNodeDto | null;
  canEditActiveFile: boolean;
  isDirtyActiveFile: boolean;
  dirtyCount: number;
  isSaving: boolean;
  isLockPending: boolean;
  currentUserId: string;
  explorerCollapsed: boolean;
  isWindowExpanded: boolean;
  rightPanelTab: InspectorTab;
  collabConnectionStatus: RealtimeConnectionStatus;
  collabSyncStatus: RealtimeSyncStatus;
  collabRoomReady: boolean;
  presenceUsers: RealtimePresenceUser[];
  consoleOpen: boolean;
  canRunCode: boolean;
  hasRunnableSource: boolean;
  isExecutionActive: boolean;
  isExecutionStarting: boolean;
  canCancelExecution: boolean;
  isWorkspaceMember: boolean;
  chatUnreadCount: number;
  onRunCode: () => void;
  onCancelExecution: () => void;
  onToggleConsole: () => void;
  onJumpToCollaboratorLine: (lineNumber: number) => void;
  onToggleExplorer: () => void;
  onToggleWindowExpanded: () => void;
  onSelectBranch: (branchId: string) => void;
  onOpenMergeModal: (preset?: {
    sourceBranchId?: string;
    targetBranchId?: string;
  }) => void;
  onSaveActiveFile: () => void;
  onToggleLockActiveFile: () => void;
  onSetRightPanelTab: (tab: InspectorTab) => void;
}

/**
 * Crystal mirror top Studio bar housing workspace identity, Git-style branch
 * switching/cloning/protection controls, checkout locks, manual CAS save,
 * and right-side Inspector drawer toggles (`Team`, `Access`, `Settings`).
 */
export function StudioTopBar({
  project,
  branches,
  activeBranch,
  activeFile,
  canEditActiveFile,
  isDirtyActiveFile,
  dirtyCount,
  isSaving,
  isLockPending,
  currentUserId,
  explorerCollapsed,
  isWindowExpanded,
  rightPanelTab,
  collabConnectionStatus,
  collabSyncStatus,
  collabRoomReady,
  presenceUsers,
  consoleOpen,
  canRunCode,
  hasRunnableSource,
  isExecutionActive,
  isExecutionStarting,
  canCancelExecution,
  isWorkspaceMember,
  chatUnreadCount,
  onRunCode,
  onCancelExecution,
  onToggleConsole,
  onJumpToCollaboratorLine,
  onToggleExplorer,
  onToggleWindowExpanded,
  onSelectBranch,
  onOpenMergeModal,
  onSaveActiveFile,
  onToggleLockActiveFile,
  onSetRightPanelTab,
}: StudioTopBarProps) {
  const queryClient = useQueryClient();
  const isOwner = project.currentUserRole === 'owner';
  const canCreateBranch =
    isOwner || project.currentUserRole === 'editor';

  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [branchError, setBranchError] = useState<string | null>(null);
  const [pendingSwitchBranch, setPendingSwitchBranch] =
    useState<ProjectBranchDto | null>(null);
  const [confirmDeleteBranchId, setConfirmDeleteBranchId] = useState<
    string | null
  >(null);

  const branchPopoverRef = useRef<HTMLDivElement>(null);

  // Close branch menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!branchMenuOpen) {
      setPendingSwitchBranch(null);
      setConfirmDeleteBranchId(null);
      setBranchError(null);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        branchPopoverRef.current &&
        !branchPopoverRef.current.contains(event.target as Node)
      ) {
        setBranchMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBranchMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [branchMenuOpen]);

  const createBranchMutation = useMutation({
    mutationFn: (name: string) =>
      createBranch(project.id, {
        name,
        sourceBranchId: activeBranch?.id,
      }),
    onSuccess: async (created) => {
      setNewBranchName('');
      setBranchError(null);
      setBranchMenuOpen(false);
      queryClient.setQueryData<ProjectDetailResponse>(
        queryKeys.projects.detail(project.id),
        (prev) =>
          prev
            ? {
                ...prev,
                branches: prev.branches.some((b) => b.id === created.id)
                  ? prev.branches
                  : [...prev.branches, created],
              }
            : prev,
      );
      onSelectBranch(created.id);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
    onError: (err) => {
      setBranchError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to create branch',
      );
    },
  });

  const protectBranchMutation = useMutation({
    mutationFn: ({
      branchId,
      isProtected,
    }: {
      branchId: string;
      isProtected: boolean;
    }) => updateBranch(project.id, branchId, { isProtected }),
    onSuccess: async () => {
      setBranchError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      if (activeBranch) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(project.id, activeBranch.id),
        });
      }
    },
    onError: (err) => {
      setBranchError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update branch protection',
      );
    },
  });

  const deleteBranchMutation = useMutation({
    mutationFn: (branchId: string) => deleteBranch(project.id, branchId),
    onSuccess: async (_, deletedBranchId) => {
      setConfirmDeleteBranchId(null);
      setBranchError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
      if (activeBranch?.id === deletedBranchId) {
        const fallback =
          branches.find((b) => b.isDefault && b.id !== deletedBranchId) ??
          branches.find((b) => b.id !== deletedBranchId);
        if (fallback) {
          onSelectBranch(fallback.id);
        }
      }
    },
    onError: (err) => {
      setBranchError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to delete branch',
      );
    },
  });

  const handleRequestSwitchBranch = (branch: ProjectBranchDto) => {
    if (branch.id === activeBranch?.id) {
      setBranchMenuOpen(false);
      return;
    }
    if (dirtyCount > 0) {
      setPendingSwitchBranch(branch);
      return;
    }
    onSelectBranch(branch.id);
    setBranchMenuOpen(false);
  };

  const handleCreateBranch = (event: React.FormEvent) => {
    event.preventDefault();
    setBranchError(null);

    const parsed = BranchNameSchema.safeParse(newBranchName);
    if (!parsed.success) {
      setBranchError(parsed.error.issues[0]?.message ?? 'Invalid branch name');
      return;
    }

    if (dirtyCount > 0) {
      setBranchError(
        'Save or discard modified files before cloning & switching branches',
      );
      return;
    }

    createBranchMutation.mutate(parsed.data);
  };

  const isLockedByMe = Boolean(
    activeFile?.lockedById && activeFile.lockedById === currentUserId,
  );
  const isLockedByOther = Boolean(
    activeFile?.lockedById && activeFile.lockedById !== currentUserId,
  );

  const canInteractLockButton = Boolean(
    activeFile &&
      activeFile.nodeType === 'file' &&
      !isLockPending &&
      (isLockedByMe ||
        (isLockedByOther && isOwner) ||
        (!activeFile.lockedById && canEditActiveFile)),
  );

  const roleBadge = project.currentUserRole ?? 'viewer';
  const remotePeers = presenceUsers.filter((u) => u.userId !== currentUserId);
  const visibleHeaderPeers = remotePeers.slice(
    0,
    COLLAB_LIMITS.MAX_HEADER_AVATARS,
  );
  const overflowPeerCount = Math.max(
    0,
    remotePeers.length - visibleHeaderPeers.length,
  );

  const syncLabel = !activeFile
    ? collabConnectionStatus === 'connected'
      ? 'Ready'
      : collabConnectionStatus === 'connecting'
        ? 'Connecting…'
        : 'Offline'
    : collabRoomReady
      ? collabSyncStatus === 'syncing'
        ? 'Syncing…'
        : 'CRDT Live'
      : collabConnectionStatus === 'connecting'
        ? 'Joining…'
        : 'REST Mode';

  const syncDotClass =
    collabRoomReady && collabSyncStatus === 'synced'
      ? 'bg-emerald-500'
      : collabSyncStatus === 'syncing' || collabConnectionStatus === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : collabConnectionStatus === 'connected'
          ? 'bg-emerald-500/80'
          : 'bg-muted-foreground/50';

  return (
    <header className="glass-surface relative z-40 w-full shrink-0 rounded-none border-x-0 border-t-0">
      <div className="px-3 py-1.5 sm:px-5">
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-2">
          {/* Group 1 (Left): Navigation, Brand, Explorer Toggle, Workspace Title & Branch Switcher */}
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              to="/"
              title="Back to Workspaces"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Workspaces</span>
            </Link>

            <span
              aria-hidden="true"
              className="hidden h-4 w-px bg-border/60 sm:inline-block"
            />

            <Link
              to="/"
              aria-label="CodeCollab Dashboard"
              className="hidden items-center px-1 sm:inline-flex"
            >
              <BrandMark size="sm" />
            </Link>

            <button
              type="button"
              onClick={onToggleExplorer}
              title={
                explorerCollapsed ? 'Show File Explorer' : 'Hide File Explorer'
              }
              aria-label={
                explorerCollapsed ? 'Show File Explorer' : 'Hide File Explorer'
              }
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                explorerCollapsed
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              {explorerCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            <span
              title={`${project.name} · ${project.language} · ${project.isPublic ? 'Public' : 'Private'} · ${roleBadge}`}
              className="max-w-[140px] truncate px-1 text-[13px] font-semibold tracking-tight text-foreground sm:max-w-[200px]"
            >
              {project.name}
            </span>

            <span
              aria-hidden="true"
              className="hidden font-mono text-xs text-muted-foreground/45 sm:inline"
            >
              /
            </span>

            {/* Git-style Branch Switcher Dropdown */}
            <div className="relative" ref={branchPopoverRef}>
              <button
                type="button"
                onClick={() => setBranchMenuOpen((prev) => !prev)}
                aria-expanded={branchMenuOpen}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 font-mono text-xs transition-colors',
                  branchMenuOpen
                    ? 'bg-foreground/[0.08] text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                )}
              >
                <GitBranch
                  className="h-3.5 w-3.5 text-primary"
                  aria-hidden="true"
                />
                <span className="max-w-[110px] truncate text-foreground">
                  {activeBranch?.name ?? 'main'}
                </span>
                {activeBranch?.isProtected && (
                  <ShieldCheck
                    className="h-3 w-3 text-muted-foreground"
                    aria-label="Protected branch"
                  />
                )}
                <ChevronDown
                  className={cn(
                    'h-3 w-3 text-muted-foreground transition-transform',
                    branchMenuOpen && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </button>

              {branchMenuOpen && (
                <div className="absolute left-0 top-10 z-50 w-72 rounded-2xl border border-border bg-card p-3 text-card-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10 sm:w-80">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between border-b border-border/60 pb-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Workspace Branches ({branches.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setBranchMenuOpen(false)}
                        aria-label="Close branch menu"
                        className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>

                    {branchError && (
                      <div className="rounded-xl border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                        {branchError}
                      </div>
                    )}

                    {/* Inline Unsaved Changes Warning Before Branch Switch */}
                    {pendingSwitchBranch && (
                      <div className="rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-[11px]">
                        <p className="font-medium text-foreground">
                          Discard {dirtyCount} unsaved{' '}
                          {dirtyCount === 1 ? 'file' : 'files'}?
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          Switching to{' '}
                          <span className="font-mono text-foreground">
                            {pendingSwitchBranch.name}
                          </span>{' '}
                          will clear unsaved local drafts.
                        </p>
                        <div className="mt-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectBranch(pendingSwitchBranch.id);
                              setPendingSwitchBranch(null);
                              setBranchMenuOpen(false);
                            }}
                            className="rounded-lg bg-destructive px-2.5 py-1 font-mono text-[10px] font-semibold text-destructive-foreground hover:opacity-90"
                          >
                            Discard & Switch
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingSwitchBranch(null)}
                            className="rounded-lg border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-foreground hover:bg-muted"
                          >
                            Stay
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Branch List */}
                    <ul className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
                      {branches.map((branch) => {
                        const isCurrent = branch.id === activeBranch?.id;
                        const isConfirmDelete =
                          confirmDeleteBranchId === branch.id;

                        return (
                          <li
                            key={branch.id}
                            className={cn(
                              'flex items-center justify-between gap-1.5 rounded-xl px-2 py-1.5 font-mono text-xs transition-colors',
                              isCurrent
                                ? 'border border-primary/45 bg-primary/[0.12] text-foreground'
                                : 'hover:bg-foreground/[0.04] text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => handleRequestSwitchBranch(branch)}
                              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            >
                              <Check
                                className={cn(
                                  'h-3 w-3 shrink-0 text-primary',
                                  isCurrent ? 'opacity-100' : 'opacity-0',
                                )}
                                aria-hidden="true"
                              />
                              <span className="truncate font-medium">
                                {branch.name}
                              </span>
                              {branch.isDefault && (
                                <span className="shrink-0 rounded px-1 py-0.5 text-[9px] text-muted-foreground ring-1 ring-border">
                                  default
                                </span>
                              )}
                            </button>

                            <div className="flex shrink-0 items-center gap-1">
                              {canCreateBranch && !isCurrent && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBranchMenuOpen(false);
                                    onOpenMergeModal({
                                      sourceBranchId: branch.id,
                                      targetBranchId: activeBranch?.id,
                                    });
                                  }}
                                  title={`Merge ${branch.name} into ${activeBranch?.name ?? 'current branch'}`}
                                  aria-label={`Merge ${branch.name} into ${activeBranch?.name ?? 'current branch'}`}
                                  className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
                                >
                                  <GitMerge
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                </button>
                              )}

                              {isOwner && (
                                <>
                                  <button
                                    type="button"
                                    disabled={protectBranchMutation.isPending}
                                    onClick={() =>
                                      protectBranchMutation.mutate({
                                        branchId: branch.id,
                                        isProtected: !branch.isProtected,
                                      })
                                    }
                                    title={
                                      branch.isProtected
                                        ? 'Unprotect branch (allow editors)'
                                        : 'Protect branch (owner-only writes)'
                                    }
                                    className={cn(
                                      'rounded-lg p-1 transition-colors',
                                      branch.isProtected
                                        ? 'text-primary hover:bg-primary/15'
                                        : 'text-muted-foreground hover:text-foreground',
                                    )}
                                  >
                                    <ShieldCheck
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    />
                                  </button>

                                  {!branch.isDefault &&
                                    (isConfirmDelete ? (
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          disabled={deleteBranchMutation.isPending}
                                          onClick={() =>
                                            deleteBranchMutation.mutate(branch.id)
                                          }
                                          className="rounded bg-destructive px-1.5 py-0.5 text-[9px] font-semibold text-destructive-foreground"
                                        >
                                          Del
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmDeleteBranchId(null)
                                          }
                                          className="rounded px-1 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                                        >
                                          No
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteBranchId(branch.id)
                                        }
                                        title={`Delete branch ${branch.name}`}
                                        className="rounded-lg p-1 text-muted-foreground hover:text-destructive"
                                      >
                                        <Trash2
                                          className="h-3.5 w-3.5"
                                          aria-hidden="true"
                                        />
                                      </button>
                                    ))}
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {/* Create Branch Form (Editor & Owner) */}
                    {canCreateBranch && (
                      <form
                        onSubmit={handleCreateBranch}
                        className="flex items-center gap-1.5 border-t border-border/60 pt-2.5"
                      >
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={(e) => setNewBranchName(e.target.value)}
                          placeholder={`Branch from ${activeBranch?.name ?? 'main'}…`}
                          className="h-8 min-w-0 flex-1 rounded-xl border border-input bg-background px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={
                            createBranchMutation.isPending ||
                            !newBranchName.trim()
                          }
                          title="Clone current branch"
                          className="btn-studio-primary inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold disabled:opacity-50"
                        >
                          {createBranchMutation.isPending ? (
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Plus className="h-3 w-3" aria-hidden="true" />
                          )}
                          <span>Create</span>
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              )}
            </div>

            {branches.length > 1 && canCreateBranch && (
              <button
                type="button"
                onClick={() => onOpenMergeModal()}
                title="Merge changes between branches"
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-primary"
              >
                <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Merge</span>
              </button>
            )}
          </div>

          {/* Group 2 (Center): Run, Console, Active File Lock & Save Actions */}
          <div className="flex items-center gap-1">
            {canRunCode &&
              (isExecutionActive ? (
                <button
                  type="button"
                  disabled={!canCancelExecution}
                  onClick={onCancelExecution}
                  title="Stop running execution"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-destructive/15 px-2.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/25 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!hasRunnableSource || isExecutionStarting}
                  onClick={onRunCode}
                  title={
                    hasRunnableSource
                      ? `Run ${activeFile?.name ?? 'file'} in Docker sandbox`
                      : 'Open a file to run'
                  }
                  className="btn-studio-primary inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isExecutionStarting ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Play className="h-3 w-3 fill-current" aria-hidden="true" />
                  )}
                  <span>{isExecutionStarting ? 'Running…' : 'Run'}</span>
                </button>
              ))}

            <button
              type="button"
              onClick={onToggleConsole}
              title={consoleOpen ? 'Hide execution console' : 'Open execution console'}
              aria-label={
                consoleOpen ? 'Hide execution console' : 'Open execution console'
              }
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors',
                consoleOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden xl:inline">Console</span>
            </button>

            {activeFile && activeFile.nodeType === 'file' && (
              <>
                <button
                  type="button"
                  disabled={!canInteractLockButton}
                  onClick={onToggleLockActiveFile}
                  title={
                    isLockedByMe
                      ? 'You hold the checkout lock · Click to unlock'
                      : isLockedByOther
                        ? isOwner
                          ? `Locked by @${activeFile.lockedByUsername ?? 'user'} · Click to rescue unlock`
                          : `Locked by @${activeFile.lockedByUsername ?? 'user'}`
                        : canEditActiveFile
                          ? 'Acquire exclusive checkout lock'
                          : 'Read-only access'
                  }
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-mono text-[11px] font-medium transition-colors disabled:opacity-45',
                    isLockedByMe
                      ? 'bg-primary/15 text-primary hover:bg-primary/20'
                      : isLockedByOther && isOwner
                        ? 'bg-amber-500/[0.14] text-amber-600 hover:bg-amber-500/20 dark:text-amber-300'
                        : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                  )}
                >
                  {isLockPending ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : isLockedByMe ? (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : isLockedByOther ? (
                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span className="hidden md:inline">
                    {isLockedByMe
                      ? 'Unlock'
                      : isLockedByOther
                        ? isOwner
                          ? `Unlock @${activeFile.lockedByUsername ?? 'user'}`
                          : `@${activeFile.lockedByUsername ?? 'locked'}`
                        : 'Lock'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={!isDirtyActiveFile || !canEditActiveFile || isSaving}
                  onClick={onSaveActiveFile}
                  title="Save changes (Ctrl/Cmd + S)"
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45',
                    isDirtyActiveFile && canEditActiveFile
                      ? 'btn-studio-primary font-semibold'
                      : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                  )}
                >
                  {isSaving ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{isSaving ? 'Saving…' : 'Save'}</span>
                  <kbd className="hidden rounded bg-black/10 px-1 py-0.5 font-mono text-[9px] dark:bg-white/10 xl:inline">
                    ⌘S
                  </kbd>
                </button>

                <span
                  aria-hidden="true"
                  className="mx-0.5 hidden h-4 w-px bg-border/60 md:inline-block"
                />

                {/* Live CRDT Sync Pill + Up to 4 Colored Presence Avatars */}
                <div className="hidden items-center gap-2 md:flex">
                  <span
                    title={`Real-time status: ${syncLabel}`}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 font-mono text-[10.5px] text-muted-foreground"
                  >
                    <span
                      className={cn('h-2 w-2 rounded-full', syncDotClass)}
                      aria-hidden="true"
                    />
                    <span>{syncLabel}</span>
                  </span>

                  {visibleHeaderPeers.length > 0 && (
                    <div
                      className="flex items-center -space-x-1.5 pr-1"
                      aria-label="Active file collaborators"
                    >
                      {visibleHeaderPeers.map((peer) => {
                        const initial =
                          peer.username.slice(0, 1).toUpperCase() || '?';
                        const jumpLine =
                          peer.focusLine ?? peer.cursor?.headLine ?? null;
                        return (
                          <div key={peer.userId} className="group/peer relative">
                            <button
                              type="button"
                              onClick={() => {
                                if (jumpLine !== null) {
                                  onJumpToCollaboratorLine(jumpLine);
                                }
                              }}
                              aria-label={`@${peer.username} (${peer.permission === 'edit' ? 'editor' : 'viewer'})${jumpLine ? `, Line ${jumpLine}` : ''}`}
                              style={{
                                borderColor: peer.color,
                                backgroundColor: `${peer.color}24`,
                                color: peer.color,
                              }}
                              className={cn(
                                'relative inline-flex h-6 w-6 items-center justify-center rounded-full border-2 bg-card font-mono text-[10px] font-bold shadow-sm transition-transform hover:z-20 hover:scale-110 focus:z-20 focus:outline-none',
                                peer.isTyping && 'ring-2 ring-offset-1 ring-offset-card',
                              )}
                            >
                              {peer.avatarUrl ? (
                                <img
                                  src={peer.avatarUrl}
                                  alt={peer.username}
                                  className="h-full w-full rounded-full object-cover"
                                />
                              ) : (
                                <span>{initial}</span>
                              )}
                              {peer.isTyping && (
                                <span
                                  style={{ backgroundColor: peer.color }}
                                  className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-card animate-pulse"
                                />
                              )}
                            </button>

                            {/* Floating frosted glass hover bubble matching live editor cursors */}
                            <div
                              role="tooltip"
                              style={{
                                borderColor: `${peer.color}88`,
                                boxShadow: `0 12px 26px -8px rgba(0,0,0,0.45), 0 0 14px -4px ${peer.color}55`,
                              }}
                              className="glass-surface pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-medium text-foreground group-hover/peer:flex group-focus-within/peer:flex"
                            >
                              <span
                                style={{
                                  backgroundColor: peer.color,
                                  boxShadow: `0 0 8px ${peer.color}`,
                                }}
                                className={cn(
                                  'h-2 w-2 shrink-0 rounded-full',
                                  peer.isTyping && 'animate-pulse',
                                )}
                              />
                              <span className="font-semibold">
                                @{peer.username}
                              </span>
                              <span className="text-[9.5px] text-muted-foreground">
                                {peer.permission === 'edit' ? 'editor' : 'viewer'}
                                {jumpLine !== null ? ` · Ln ${jumpLine}` : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {overflowPeerCount > 0 && (
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-card px-1 font-mono text-[10px] font-semibold text-muted-foreground">
                          +{overflowPeerCount}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Group 3 (Right): Inspector Tabs, Window Expand & Theme */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                onSetRightPanelTab(
                  rightPanelTab === 'history' ? 'closed' : 'history',
                )
              }
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                rightPanelTab === 'history'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
              title="Branch Snapshots & Version History"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">History</span>
            </button>

            {isWorkspaceMember && (
              <button
                type="button"
                onClick={() =>
                  onSetRightPanelTab(
                    rightPanelTab === 'chat' ? 'closed' : 'chat',
                  )
                }
                className={cn(
                  'relative inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                  rightPanelTab === 'chat'
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                )}
                title="Workspace Chat"
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Chat</span>
                {chatUnreadCount > 0 && rightPanelTab !== 'chat' && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9.5px] font-bold text-primary-foreground">
                    {chatUnreadCount}
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                onSetRightPanelTab(
                  rightPanelTab === 'members' ? 'closed' : 'members',
                )
              }
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                rightPanelTab === 'members'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
              title="Team & Collaborators"
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Team</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() =>
                  onSetRightPanelTab(
                    rightPanelTab === 'access' ? 'closed' : 'access',
                  )
                }
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                  rightPanelTab === 'access'
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
                )}
                title="Per-File & Folder ACLs"
              >
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Access</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                onSetRightPanelTab(
                  rightPanelTab === 'settings' ? 'closed' : 'settings',
                )
              }
              aria-label="Workspace Settings"
              title="Workspace Settings"
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                rightPanelTab === 'settings'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden lg:inline">Settings</span>
            </button>

            <span
              aria-hidden="true"
              className="mx-0.5 hidden h-4 w-px bg-border/60 sm:inline-block"
            />

            <button
              type="button"
              onClick={onToggleWindowExpanded}
              title={
                isWindowExpanded ? 'Restore framed window' : 'Expand fullscreen'
              }
              aria-label={
                isWindowExpanded ? 'Restore framed window' : 'Expand fullscreen'
              }
              className={cn(
                'hidden h-8 w-8 items-center justify-center rounded-lg transition-colors sm:inline-flex',
                isWindowExpanded
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground',
              )}
            >
              {isWindowExpanded ? (
                <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <ThemeToggle variant="ghost" />
          </div>
        </div>
      </div>
    </header>
  );
}