import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  LockOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BranchNameSchema,
  type Project,
  type ProjectBranchDto,
  type ProjectDetailResponse,
  type ProjectFileNodeDto,
  type SupportedLanguage,
} from '@codecollab/shared';
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

const SHORT_LANGUAGE_TAGS: Record<SupportedLanguage, string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'PY',
  cpp: 'C++',
  java: 'JAVA',
};

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
  rightPanelTab: InspectorTab;
  onToggleExplorer: () => void;
  onSelectBranch: (branchId: string) => void;
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
  rightPanelTab,
  onToggleExplorer,
  onSelectBranch,
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

  return (
    <header className="relative z-40 shrink-0 px-3 pt-3">
      <div className="glass-mirror rounded-2xl px-3 py-2 sm:px-4">
        <div className="relative z-20 flex flex-wrap items-center justify-between gap-2">
          {/* Left: Navigation, Brand, Explorer Toggle, Project Title & Branch Popover */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              to="/"
              title="Back to Workspaces"
              className="glass-control inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Workspaces</span>
            </Link>

            <Link
              to="/"
              aria-label="CodeCollab Dashboard"
              className="hidden items-center sm:inline-flex"
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
              className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
            >
              {explorerCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            {/* Project Name + Language & Role Chips */}
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="max-w-[140px] truncate text-sm font-semibold tracking-tight text-foreground sm:max-w-[210px]">
                {project.name}
              </span>
              <span className="glass-control hidden rounded-lg px-2 py-0.5 font-mono text-[10px] font-semibold text-primary sm:inline-block">
                {SHORT_LANGUAGE_TAGS[project.language]}
              </span>
              <span
                title={project.isPublic ? 'Public workspace' : 'Private workspace'}
                className="glass-control hidden h-6 items-center gap-1 rounded-full px-2 font-mono text-[10px] text-muted-foreground md:inline-flex"
              >
                {project.isPublic ? (
                  <Globe className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Lock className="h-3 w-3" aria-hidden="true" />
                )}
              </span>
              <span
                className={cn(
                  'hidden rounded-full px-2 py-0.5 font-mono text-[10px] lg:inline-block',
                  roleBadge === 'owner'
                    ? 'border border-primary/35 bg-primary/15 text-primary'
                    : 'glass-control text-muted-foreground',
                )}
              >
                {roleBadge}
              </span>
            </div>

            {/* Git-style Branch Switcher Dropdown */}
            <div className="relative" ref={branchPopoverRef}>
              <button
                type="button"
                onClick={() => setBranchMenuOpen((prev) => !prev)}
                aria-expanded={branchMenuOpen}
                className={cn(
                  'glass-control inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 font-mono text-xs transition-colors',
                  branchMenuOpen
                    ? 'border-primary/50 text-foreground'
                    : 'text-foreground',
                )}
              >
                <GitBranch
                  className="h-3.5 w-3.5 text-primary"
                  aria-hidden="true"
                />
                <span className="max-w-[110px] truncate">
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
                <div className="glass-mirror absolute left-0 top-10 z-50 w-72 rounded-2xl p-3 shadow-2xl sm:w-80">
                  <div className="relative z-10 space-y-2.5">
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
                            className="glass-control rounded-lg px-2.5 py-1 font-mono text-[10px] text-foreground"
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

                            {isOwner && (
                              <div className="flex shrink-0 items-center gap-1">
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
                              </div>
                            )}
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
                          className="glass-control h-8 min-w-0 flex-1 rounded-xl px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/65 focus:border-primary/60 focus:outline-none"
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
          </div>

          {/* Right: Lock, Save, Sync Badge, Inspector Tabs & Theme */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Active File Checkout Lock Control */}
            {activeFile && activeFile.nodeType === 'file' && (
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
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 font-mono text-[11px] font-medium transition-colors disabled:opacity-55',
                  isLockedByMe
                    ? 'border border-primary/50 bg-primary/15 text-primary'
                    : isLockedByOther && isOwner
                      ? 'border border-amber-500/45 bg-amber-500/[0.12] text-amber-600 dark:text-amber-300'
                      : 'glass-control text-muted-foreground hover:text-foreground',
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
                    ? 'Locked (Unlock)'
                    : isLockedByOther
                      ? isOwner
                        ? `Unlock @${activeFile.lockedByUsername ?? 'user'}`
                        : `@${activeFile.lockedByUsername ?? 'locked'}`
                      : 'Lock'}
                </span>
              </button>
            )}

            {/* Save File Button (CAS Optimistic Save) */}
            {activeFile && activeFile.nodeType === 'file' && (
              <button
                type="button"
                disabled={!isDirtyActiveFile || !canEditActiveFile || isSaving}
                onClick={onSaveActiveFile}
                title="Save changes (Ctrl/Cmd + S)"
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50',
                  isDirtyActiveFile && canEditActiveFile
                    ? 'btn-studio-primary'
                    : 'glass-control font-medium text-muted-foreground',
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
                <kbd className="hidden rounded bg-black/15 px-1 py-0.5 font-mono text-[9px] dark:bg-white/15 xl:inline">
                  ⌘S
                </kbd>
              </button>
            )}

            {/* Monochrome CRDT Day-4 Readiness Pill */}
            <span className="glass-control hidden h-8 items-center gap-1.5 rounded-xl px-2.5 font-mono text-[10px] text-muted-foreground xl:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground shadow-[0_0_6px_rgba(255,255,255,0.65)] dark:bg-white" />
              <span>REST Synced · CRDT Day 4</span>
            </span>

            {/* Inspector Drawer Triggers */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  onSetRightPanelTab(
                    rightPanelTab === 'members' ? 'closed' : 'members',
                  )
                }
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors',
                  rightPanelTab === 'members'
                    ? 'border border-primary/50 bg-primary/15 text-primary'
                    : 'glass-control text-muted-foreground hover:text-foreground',
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
                    'inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors',
                    rightPanelTab === 'access'
                      ? 'border border-primary/50 bg-primary/15 text-primary'
                      : 'glass-control text-muted-foreground hover:text-foreground',
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
                  'inline-flex h-8 w-8 items-center justify-center rounded-xl transition-colors',
                  rightPanelTab === 'settings'
                    ? 'border border-primary/50 bg-primary/15 text-primary'
                    : 'glass-control text-muted-foreground hover:text-foreground',
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>

            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </div>
    </header>
  );
}