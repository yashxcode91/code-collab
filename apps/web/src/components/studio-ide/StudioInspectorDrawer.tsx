import React, { useEffect, useMemo, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Folder,
  FileCode2,
  Globe,
  History,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AddProjectMemberSchema,
  COLLAB_LIMITS,
  UpdateProjectSchema,
  type BranchSnapshotSummaryDto,
  type ChatFileReferenceDto,
  type ChatMessageDto,
  type FileAccessPermission,
  type Project,
  type ProjectBranchDto,
  type ProjectFileNodeDto,
  type ProjectMemberDto,
  type RestoreSnapshotInput,
} from '@codecollab/shared';
import { StudioChatPanel } from '@/components/studio-ide/StudioChatPanel';
import { StudioHistoryPanel } from '@/components/studio-ide/StudioHistoryPanel';
import { buildNodeBreadcrumb } from '@/components/studio-ide/studioLanguage';
import type { TypingPeer } from '@/hooks/useWorkspaceChat';
import { ApiClientError } from '@/lib/api';
import {
  addProjectMember,
  deleteProject,
  fetchFileAccessRules,
  queryKeys,
  removeFileAccessRule,
  removeProjectMember,
  setFileAccessRule,
  updateProject,
  updateProjectMemberRole,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { InspectorTab } from '@/stores/useStudioStore';

interface StudioInspectorDrawerProps {
  project: Project;
  branch: ProjectBranchDto | null;
  members: ProjectMemberDto[];
  files: ProjectFileNodeDto[];
  activeFileId: string | null;
  aclTargetNodeId: string | null;
  currentUserId: string;
  activeTab: InspectorTab;
  activeFile: ProjectFileNodeDto | null;
  activeCursorLine: number;
  isWorkspaceMember: boolean;
  canSendChat: boolean;
  chatState: {
    messages: ChatMessageDto[];
    nextCursor: string | null;
    isLoadingHistory: boolean;
    isLoadingOlder: boolean;
    isSending: boolean;
    chatJoined: boolean;
    chatError: string | null;
    typingPeers: TypingPeer[];
    onLoadOlder: () => void;
    onSendMessage: (input: {
      content: string;
      branchId?: string | null;
      fileId?: string | null;
      lineNumber?: number | null;
    }) => Promise<boolean>;
    onNotifyTyping: (isTyping: boolean) => void;
    onClearError: () => void;
    onNavigateToFileRef: (fileRef: ChatFileReferenceDto) => void;
  };
  historyState: {
    snapshots: BranchSnapshotSummaryDto[];
    nextCursor: string | null;
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
  };
  onChangeTab: (tab: InspectorTab) => void;
  onSelectAclTarget: (nodeId: string | null) => void;
  onWorkspaceLeftOrDeleted: () => void;
}

/**
 * Collapsible right-hand Studio Inspector panel housing Team Management,
 * Owner-only Per-File/Folder Collaborator ACL Overrides, and Workspace Settings.
 */
export function StudioInspectorDrawer({
  project,
  branch,
  members,
  files,
  activeFileId,
  aclTargetNodeId,
  currentUserId,
  activeTab,
  activeFile,
  activeCursorLine,
  isWorkspaceMember,
  canSendChat,
  chatState,
  historyState,
  onChangeTab,
  onSelectAclTarget,
  onWorkspaceLeftOrDeleted,
}: StudioInspectorDrawerProps) {
  const queryClient = useQueryClient();
  const isOwner = project.currentUserRole === 'owner';
  const resolvedTab: Exclude<InspectorTab, 'closed'> =
    activeTab === 'access' && !isOwner
      ? 'members'
      : activeTab === 'chat' && !isWorkspaceMember
        ? 'members'
        : activeTab === 'closed'
          ? 'members'
          : activeTab;

  // --- Avatar Fallback State ---
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>(
    {},
  );

  // --- Team Tab State ---
  const [inviteIdentifier, setInviteIdentifier] = useState('');
  const [inviteRole, setInviteRole] = useState<'editor' | 'viewer'>('editor');
  const [teamError, setTeamError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // --- ACL Tab State ---
  const [aclError, setAclError] = useState<string | null>(null);

  // --- Settings Tab State ---
  const [nameInput, setNameInput] = useState(project.name);
  const [descInput, setDescInput] = useState(project.description ?? '');
  const [isPublicInput, setIsPublicInput] = useState(project.isPublic);
  const [maxEditorsInput, setMaxEditorsInput] = useState(
    project.maxConcurrentEditors,
  );
  const [sameLineInput, setSameLineInput] = useState(
    project.preventSameLineEdit,
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);

  useEffect(() => {
    setNameInput(project.name);
    setDescInput(project.description ?? '');
    setIsPublicInput(project.isPublic);
    setMaxEditorsInput(project.maxConcurrentEditors);
    setSameLineInput(project.preventSameLineEdit);
  }, [
    project.id,
    project.name,
    project.description,
    project.isPublic,
    project.maxConcurrentEditors,
    project.preventSameLineEdit,
  ]);

  useEffect(() => {
    setSettingsSaved(false);
    setSettingsError(null);
  }, [project.id]);

  const effectiveAclNodeId = useMemo(() => {
    const candidate = aclTargetNodeId ?? activeFileId ?? files[0]?.id ?? null;
    if (!candidate) return null;
    return files.some((f) => f.id === candidate)
      ? candidate
      : (files[0]?.id ?? null);
  }, [aclTargetNodeId, activeFileId, files]);

  const effectiveAclNode = useMemo(
    () => files.find((f) => f.id === effectiveAclNodeId) ?? null,
    [files, effectiveAclNodeId],
  );

  const nonOwnerMembers = useMemo(
    () => members.filter((m) => m.userId !== project.ownerId),
    [members, project.ownerId],
  );

  const nodePathLabels = useMemo(() => {
    return files.map((node) => {
      const chain = buildNodeBreadcrumb(files, node.id);
      const path = chain.map((s) => s.name).join('/');
      return {
        node,
        label: node.nodeType === 'folder' ? `${path}/ (folder)` : path,
      };
    });
  }, [files]);

  // Fetch explicit ACL rules when Owner opens the Access tab for a node
  const accessRulesQuery = useQuery({
    queryKey: queryKeys.projects.fileAccess(
      project.id,
      branch?.id ?? 'none',
      effectiveAclNodeId ?? 'none',
    ),
    queryFn: () =>
      fetchFileAccessRules(
        project.id,
        branch!.id,
        effectiveAclNodeId!,
      ),
    enabled:
      activeTab !== 'closed' &&
      isOwner &&
      resolvedTab === 'access' &&
      Boolean(branch?.id && effectiveAclNodeId),
  });

  const ruleByUserId = useMemo(() => {
    const map = new Map<string, FileAccessPermission>();
    for (const rule of accessRulesQuery.data ?? []) {
      map.set(rule.userId, rule.permission);
    }
    return map;
  }, [accessRulesQuery.data]);

  // --- Team Mutations ---
  const inviteMutation = useMutation({
    mutationFn: (input: { identifier: string; role: 'editor' | 'viewer' }) =>
      addProjectMember(project.id, input),
    onSuccess: async () => {
      setInviteIdentifier('');
      setTeamError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
    onError: (err) => {
      setTeamError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to invite collaborator',
      );
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({
      userId,
      role,
    }: {
      userId: string;
      role: 'editor' | 'viewer';
    }) => updateProjectMemberRole(project.id, userId, { role }),
    onSuccess: async () => {
      setTeamError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
    },
    onError: (err) => {
      setTeamError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to change collaborator role',
      );
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => removeProjectMember(project.id, userId),
    onSuccess: async (_, removedUserId) => {
      setTeamError(null);
      if (removedUserId === currentUserId) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.all,
        });
        onWorkspaceLeftOrDeleted();
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
    onError: (err) => {
      setTeamError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update membership',
      );
    },
  });

  // --- ACL Mutations ---
  const setAclMutation = useMutation({
    mutationFn: ({
      nodeId,
      userId,
      permission,
    }: {
      nodeId: string;
      userId: string;
      permission: FileAccessPermission;
    }) => setFileAccessRule(project.id, branch!.id, nodeId, { userId, permission }),
    onSuccess: async (_, vars) => {
      setAclError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.fileAccess(
          project.id,
          branch!.id,
          vars.nodeId,
        ),
      });
    },
    onError: (err) => {
      setAclError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update file access rule',
      );
    },
  });

  const removeAclMutation = useMutation({
    mutationFn: ({ nodeId, userId }: { nodeId: string; userId: string }) =>
      removeFileAccessRule(project.id, branch!.id, nodeId, userId),
    onSuccess: async (_, vars) => {
      setAclError(null);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.fileAccess(
          project.id,
          branch!.id,
          vars.nodeId,
        ),
      });
    },
    onError: (err) => {
      setAclError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to clear file access override',
      );
    },
  });

  // --- Settings Mutations ---
  const updateProjectMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateProject>[1]) =>
      updateProject(project.id, payload),
    onSuccess: async () => {
      setSettingsError(null);
      setSettingsSaved(true);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
    },
    onError: (err) => {
      setSettingsSaved(false);
      setSettingsError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to update workspace settings',
      );
    },
  });

  const deleteProjectMutation = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: async () => {
      queryClient.removeQueries({
        queryKey: queryKeys.projects.detail(project.id),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all,
      });
      onWorkspaceLeftOrDeleted();
    },
    onError: (err) => {
      setConfirmDeleteProject(false);
      setSettingsError(
        err instanceof ApiClientError
          ? err.message
          : 'Unable to delete workspace',
      );
    },
  });

  if (activeTab === 'closed') {
    return null;
  }

  const handleInviteSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTeamError(null);
    const parsed = AddProjectMemberSchema.safeParse({
      identifier: inviteIdentifier,
      role: inviteRole,
    });
    if (!parsed.success) {
      setTeamError(parsed.error.issues[0]?.message ?? 'Invalid member details');
      return;
    }
    inviteMutation.mutate(parsed.data);
  };

  const handleSettingsSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSettingsError(null);
    setSettingsSaved(false);

    const parsed = UpdateProjectSchema.safeParse({
      name: nameInput,
      description: descInput.trim() ? descInput.trim() : null,
      isPublic: isPublicInput,
      maxConcurrentEditors: maxEditorsInput,
      preventSameLineEdit: sameLineInput,
    });

    if (!parsed.success) {
      setSettingsError(
        parsed.error.issues[0]?.message ?? 'Invalid workspace settings',
      );
      return;
    }

    updateProjectMutation.mutate(parsed.data);
  };

  const isMemberNonOwner =
    project.currentUserRole === 'editor' ||
    project.currentUserRole === 'viewer';

  return (
    <>
      {/* Mobile / Tablet Click-Outside Scrim */}
      <div
        onClick={() => onChangeTab('closed')}
        aria-hidden="true"
        className="fixed inset-0 z-20 bg-black/45 backdrop-blur-[2px] lg:hidden"
      />

      <aside
        aria-label="Studio Inspector"
        className={cn(
          'fixed bottom-3 right-3 top-14 z-30 flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl xl:w-[320px] lg:static lg:inset-auto lg:z-10',
          resolvedTab === 'chat' ? 'glass-mirror' : 'glass-surface',
        )}
      >
        {/* Drawer Header: Single contextual title on desktop (TopBar switches tabs); mobile switcher `<lg` */}
        <div
          className={cn(
            'relative z-10 flex items-center justify-between gap-2 border-b px-3.5 py-2.5',
            resolvedTab === 'chat'
              ? 'border-white/35 bg-white/30 backdrop-blur-md dark:border-white/10 dark:bg-white/[0.03]'
              : 'border-border/60',
          )}
        >
          {/* Desktop Contextual Title (no repetition of TopBar Team/Access/Settings buttons) */}
          <div className="hidden min-w-0 flex-1 items-center justify-between gap-2 lg:flex">
            <div className="flex min-w-0 items-center gap-2">
              {resolvedTab === 'history' && (
                <>
                  <History
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold tracking-tight text-foreground">
                    Version History
                  </span>
                </>
              )}
              {resolvedTab === 'history' && (
              <span className="glass-control shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] text-primary">
                {historyState.snapshots.length} saved
              </span>
            )}
            {resolvedTab === 'chat' && (
                <>
                  <MessageSquare
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold tracking-tight text-foreground">
                    Workspace Chat
                  </span>
                </>
              )}
            {resolvedTab === 'members' && (
                <>
                  <Users
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold tracking-tight text-foreground">
                    Collaborators
                  </span>
                </>
              )}
              {resolvedTab === 'access' && (
                <>
                  <Shield
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold tracking-tight text-foreground">
                    File &amp; Folder ACLs
                  </span>
                </>
              )}
              {resolvedTab === 'settings' && (
                <>
                  <SlidersHorizontal
                    className="h-3.5 w-3.5 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span className="truncate text-xs font-semibold tracking-tight text-foreground">
                    Workspace Settings
                  </span>
                </>
              )}
            </div>

            {resolvedTab === 'history' && (
              <span className="glass-control shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] text-primary">
                {historyState.snapshots.length} saved
              </span>
            )}
            {resolvedTab === 'chat' && (
              <span
                className={cn(
                  'glass-control inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px]',
                  chatState.chatJoined
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    chatState.chatJoined ? 'bg-emerald-500' : 'bg-muted-foreground/60',
                  )}
                />
                <span>{chatState.chatJoined ? 'Live' : 'Sync'}</span>
              </span>
            )}
            {resolvedTab === 'members' && (
              <span
                title={`${members.length} total workspace ${members.length === 1 ? 'member' : 'members'} · Up to ${project.maxConcurrentEditors} simultaneous live ${project.maxConcurrentEditors === 1 ? 'editor' : 'editors'}`}
                className="glass-control shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                {members.length} team · {project.maxConcurrentEditors} live
              </span>
            )}
            {resolvedTab === 'settings' && (
              <span className="glass-control shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] text-primary">
                {project.language}
              </span>
            )}
          </div>

          {/* Mobile / Tablet Compact Switcher (`<lg` overlay where TopBar sits underneath) */}
          <div className="flex items-center gap-1 lg:hidden">
            <button
              type="button"
              onClick={() => onChangeTab('history')}
              className={cn(
                'inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium transition-colors',
                resolvedTab === 'history'
                  ? 'border border-primary/45 bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span>History</span>
            </button>

            {isWorkspaceMember && (
              <button
                type="button"
                onClick={() => onChangeTab('chat')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-medium transition-colors',
                  resolvedTab === 'chat'
                    ? 'border border-primary/45 bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Chat</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onChangeTab('members')}
              className={cn(
                'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-medium transition-colors',
                resolvedTab === 'members'
                  ? 'border border-primary/45 bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Team</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => onChangeTab('access')}
                className={cn(
                  'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-medium transition-colors',
                  resolvedTab === 'access'
                    ? 'border border-primary/45 bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Access</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => onChangeTab('settings')}
              className={cn(
                'inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-medium transition-colors',
                resolvedTab === 'settings'
                  ? 'border border-primary/45 bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onChangeTab('closed')}
            aria-label="Close inspector"
            title="Close inspector"
            className="shrink-0 rounded-lg p-1 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Scrollable Panel Body */}
        <div
          className={cn(
            'relative z-10 min-h-0 flex-1 p-3.5',
            resolvedTab === 'chat' || resolvedTab === 'history'
              ? 'flex flex-col overflow-hidden'
              : 'space-y-4 overflow-y-auto',
          )}
        >
          {/* ==================== -1. VERSION HISTORY TAB ==================== */}
          {resolvedTab === 'history' && (
            <StudioHistoryPanel
              branch={branch}
              snapshots={historyState.snapshots}
              nextCursor={historyState.nextCursor}
              currentUserId={currentUserId}
              isOwner={isOwner}
              canEdit={canSendChat}
              isLoading={historyState.isLoading}
              isLoadingMore={historyState.isLoadingMore}
              isCreating={historyState.isCreating}
              isRestoring={historyState.isRestoring}
              isDeleting={historyState.isDeleting}
              snapshotError={historyState.snapshotError}
              lastRestoreNotice={historyState.lastRestoreNotice}
              onCreateSnapshot={historyState.onCreateSnapshot}
              onRestoreSnapshot={historyState.onRestoreSnapshot}
              onDeleteSnapshot={historyState.onDeleteSnapshot}
              onLoadMore={historyState.onLoadMore}
              onOpenDiffModal={historyState.onOpenDiffModal}
              onClearError={historyState.onClearError}
              onClearRestoreNotice={historyState.onClearRestoreNotice}
            />
          )}

          {/* ==================== 0. WORKSPACE CHAT TAB ==================== */}
          {resolvedTab === 'chat' && (
            <StudioChatPanel
              isMember={isWorkspaceMember}
              canSend={canSendChat}
              currentUserId={currentUserId}
              messages={chatState.messages}
              nextCursor={chatState.nextCursor}
              isLoadingHistory={chatState.isLoadingHistory}
              isLoadingOlder={chatState.isLoadingOlder}
              isSending={chatState.isSending}
              chatError={chatState.chatError}
              typingPeers={chatState.typingPeers}
              activeBranchId={branch?.id ?? null}
              activeFile={activeFile}
              activeCursorLine={activeCursorLine}
              onLoadOlder={chatState.onLoadOlder}
              onSendMessage={chatState.onSendMessage}
              onNotifyTyping={chatState.onNotifyTyping}
              onClearError={chatState.onClearError}
              onNavigateToFileRef={chatState.onNavigateToFileRef}
            />
          )}

          {/* ==================== 1. TEAM TAB ==================== */}
          {resolvedTab === 'members' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between lg:hidden">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Collaborators
                </h2>
                <span
                  title={`${members.length} total workspace ${members.length === 1 ? 'member' : 'members'} · Up to ${project.maxConcurrentEditors} simultaneous live ${project.maxConcurrentEditors === 1 ? 'editor' : 'editors'}`}
                  className="glass-control shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {members.length} team · {project.maxConcurrentEditors} live
                </span>
              </div>

              {teamError && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{teamError}</span>
                </div>
              )}

              {isOwner && (
                <form
                  onSubmit={handleInviteSubmit}
                  className="glass-control space-y-2.5 rounded-2xl p-3"
                >
                  <label
                    htmlFor="invite-identifier"
                    className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    Invite Collaborator
                  </label>
                  <input
                    id="invite-identifier"
                    type="text"
                    value={inviteIdentifier}
                    onChange={(e) => setInviteIdentifier(e.target.value)}
                    placeholder="username or email"
                    className="glass-control h-8 w-full rounded-xl px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none"
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    <select
                      value={inviteRole}
                      onChange={(e) =>
                        setInviteRole(e.target.value as 'editor' | 'viewer')
                      }
                      aria-label="Collaborator role"
                      className="glass-control h-8 min-w-0 flex-1 truncate rounded-xl px-2 font-mono text-[11px] text-foreground focus:outline-none"
                    >
                      <option value="editor">Editor (Write)</option>
                      <option value="viewer">Viewer (Read)</option>
                    </select>
                    <button
                      type="submit"
                      disabled={
                        inviteMutation.isPending || !inviteIdentifier.trim()
                      }
                      className="btn-studio-primary inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold disabled:opacity-50"
                    >
                      {inviteMutation.isPending ? (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Invite</span>
                    </button>
                  </div>
                </form>
              )}

              <ul className="space-y-2">
                {members.map((member) => {
                  const safeUrl =
                    member.user.avatarUrl &&
                    /^https?:\/\//i.test(member.user.avatarUrl) &&
                    !failedAvatars[member.id]
                      ? member.user.avatarUrl
                      : null;

                  const isSelf = member.userId === currentUserId;
                  const canManageRow =
                    isOwner && member.role !== 'owner' && member.userId !== project.ownerId;

                  return (
                    <li
                      key={member.id}
                      className="glass-control flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {safeUrl ? (
                          <img
                            src={safeUrl}
                            alt={`${member.user.username} avatar`}
                            referrerPolicy="no-referrer"
                            onError={() =>
                              setFailedAvatars((prev) => ({
                                ...prev,
                                [member.id]: true,
                              }))
                            }
                            className="h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-border"
                          />
                        ) : (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-foreground">
                            {member.user.username.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <span className="block truncate font-mono font-medium text-foreground">
                            @{member.user.username}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {isSelf ? 'you' : member.role}
                          </span>
                        </div>
                      </div>

                      {canManageRow ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <select
                            value={member.role}
                            disabled={roleMutation.isPending}
                            onChange={(e) =>
                              roleMutation.mutate({
                                userId: member.userId,
                                role: e.target.value as 'editor' | 'viewer',
                              })
                            }
                            aria-label={`Role for ${member.user.username}`}
                            className="glass-control h-7 rounded-lg px-1.5 font-mono text-[10.5px] text-foreground focus:outline-none"
                          >
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>

                          <button
                            type="button"
                            disabled={removeMemberMutation.isPending}
                            onClick={() =>
                              removeMemberMutation.mutate(member.userId)
                            }
                            title={`Remove @${member.user.username}`}
                            aria-label={`Remove ${member.user.username}`}
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                          >
                            <UserMinus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 font-mono text-[10px]',
                            member.role === 'owner'
                              ? 'border border-primary/35 bg-primary/15 text-primary'
                              : 'glass-control text-muted-foreground',
                          )}
                        >
                          {member.role}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>

              {isMemberNonOwner && (
                <div className="glass-control rounded-2xl p-3">
                  {confirmLeave ? (
                    <div className="space-y-2 text-xs">
                      <p className="font-medium text-foreground">
                        Leave this shared workspace?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={removeMemberMutation.isPending}
                          onClick={() =>
                            removeMemberMutation.mutate(currentUserId)
                          }
                          className="rounded-lg bg-destructive px-3 py-1 font-mono text-[11px] font-semibold text-destructive-foreground"
                        >
                          Confirm Leave
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmLeave(false)}
                          className="glass-control rounded-lg px-3 py-1 font-mono text-[11px] text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(true)}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl py-1 font-mono text-[11px] text-destructive hover:opacity-80"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Leave Workspace</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================== 2. ACCESS (ACL) TAB ==================== */}
          {resolvedTab === 'access' && isOwner && (
            <div className="space-y-4">
              <div>
                <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:hidden">
                  Fine-Grained File ACLs
                </h2>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Override workspace permissions per file or folder on{' '}
                  <span className="font-mono text-foreground">
                    {branch?.name ?? 'main'}
                  </span>
                  . Folder{' '}
                  <span className="font-mono text-foreground">read_only</span>{' '}
                  and <span className="font-mono text-foreground">denied</span>{' '}
                  rules cascade to descendants.
                </p>
              </div>

              {aclError && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{aclError}</span>
                </div>
              )}

              {files.length === 0 ? (
                <p className="glass-control rounded-2xl p-3 font-mono text-[11px] text-muted-foreground">
                  Create a file or folder in Explorer first to configure
                  per-node access rules.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label
                      htmlFor="acl-node-select"
                      className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {effectiveAclNode?.nodeType === 'folder' ? (
                        <Folder
                          className="h-3 w-3 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileCode2
                          className="h-3 w-3 text-primary"
                          aria-hidden="true"
                        />
                      )}
                      <span>Target Node</span>
                    </label>
                    <select
                      id="acl-node-select"
                      value={effectiveAclNodeId ?? ''}
                      onChange={(e) =>
                        onSelectAclTarget(e.target.value || null)
                      }
                      className="glass-control h-8 w-full rounded-xl px-2.5 font-mono text-xs text-foreground focus:outline-none"
                    >
                      {nodePathLabels.map(({ node, label }) => (
                        <option key={node.id} value={node.id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {nonOwnerMembers.length === 0 ? (
                    <div className="glass-control space-y-2 rounded-2xl p-3 text-center">
                      <p className="text-xs text-muted-foreground">
                        No collaborators in this workspace yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => onChangeTab('members')}
                        className="btn-studio-primary rounded-xl px-3 py-1.5 text-[11px] font-semibold"
                      >
                        Invite Collaborators
                      </button>
                    </div>
                  ) : accessRulesQuery.isLoading ? (
                    <div className="flex items-center gap-2 py-4 font-mono text-xs text-muted-foreground">
                      <Loader2
                        className="h-3.5 w-3.5 animate-spin text-primary"
                        aria-hidden="true"
                      />
                      <span>Loading ACL overrides…</span>
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {nonOwnerMembers.map((member) => {
                        const currentRule =
                          ruleByUserId.get(member.userId) ?? null;
                        const pendingThisUser =
                          setAclMutation.isPending ||
                          removeAclMutation.isPending;

                        const options: Array<{
                          id: 'inherit' | FileAccessPermission;
                          label: string;
                        }> = [
                          { id: 'inherit', label: 'Default' },
                          { id: 'edit', label: 'Edit' },
                          { id: 'read_only', label: 'Read' },
                          { id: 'denied', label: 'Deny' },
                        ];

                        return (
                          <li
                            key={member.id}
                            className="glass-control space-y-2 rounded-2xl p-3"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-medium text-foreground">
                                @{member.user.username}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                base: {member.role}
                              </span>
                            </div>

                            <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                              {options.map((opt) => {
                                const isActive =
                                  opt.id === 'inherit'
                                    ? currentRule === null
                                    : currentRule === opt.id;

                                return (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    disabled={
                                      pendingThisUser ||
                                      !effectiveAclNodeId ||
                                      (opt.id === 'inherit' && currentRule === null)
                                    }
                                    onClick={() => {
                                      if (!effectiveAclNodeId) return;
                                      if (opt.id === 'inherit') {
                                        removeAclMutation.mutate({
                                          nodeId: effectiveAclNodeId,
                                          userId: member.userId,
                                        });
                                      } else {
                                        setAclMutation.mutate({
                                          nodeId: effectiveAclNodeId,
                                          userId: member.userId,
                                          permission: opt.id,
                                        });
                                      }
                                    }}
                                    className={cn(
                                      'rounded-lg py-1 font-medium transition-colors disabled:opacity-60',
                                      isActive
                                        ? opt.id === 'denied'
                                          ? 'border border-destructive/50 bg-destructive/15 text-destructive'
                                          : 'border border-primary/50 bg-primary/15 text-primary'
                                        : 'bg-background/40 text-muted-foreground hover:text-foreground',
                                    )}
                                  >
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          {/* ==================== 3. SETTINGS TAB ==================== */}
          {resolvedTab === 'settings' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between lg:hidden">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Workspace Settings
                </h2>
                <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-primary">
                  {project.language}
                </span>
              </div>

              {settingsError && (
                <div className="flex items-start gap-2 rounded-xl border border-destructive/35 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  <AlertCircle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{settingsError}</span>
                </div>
              )}

              {settingsSaved && (
                <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-[11px] text-primary">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Workspace settings saved</span>
                </div>
              )}

              {isOwner ? (
                <>
                  <form onSubmit={handleSettingsSubmit} className="space-y-3.5">
                    <div className="space-y-1">
                      <label
                        htmlFor="studio-settings-name"
                        className="block text-xs font-medium text-foreground"
                      >
                        Workspace name
                      </label>
                      <input
                        id="studio-settings-name"
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="glass-control h-8 w-full rounded-xl px-2.5 text-xs text-foreground focus:border-primary/60 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label
                        htmlFor="studio-settings-desc"
                        className="block text-xs font-medium text-foreground"
                      >
                        Description
                      </label>
                      <textarea
                        id="studio-settings-desc"
                        rows={2}
                        value={descInput}
                        onChange={(e) => setDescInput(e.target.value)}
                        className="glass-control w-full resize-none rounded-xl px-2.5 py-2 text-xs text-foreground focus:border-primary/60 focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <span className="block text-xs font-medium text-foreground">
                        Visibility
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setIsPublicInput(false)}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium',
                            !isPublicInput
                              ? 'border border-primary/50 bg-primary/15 text-primary'
                              : 'glass-control text-muted-foreground',
                          )}
                        >
                          <Lock className="h-3 w-3" aria-hidden="true" />
                          Private
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsPublicInput(true)}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium',
                            isPublicInput
                              ? 'border border-primary/50 bg-primary/15 text-primary'
                              : 'glass-control text-muted-foreground',
                          )}
                        >
                          <Globe className="h-3 w-3" aria-hidden="true" />
                          Public
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <label
                          htmlFor="studio-settings-editors"
                          className="font-medium text-foreground"
                        >
                          Max concurrent editors
                        </label>
                        <span className="font-mono font-semibold text-primary">
                          {maxEditorsInput}
                        </span>
                      </div>
                      <input
                        id="studio-settings-editors"
                        type="range"
                        min={COLLAB_LIMITS.MIN_CONCURRENT_EDITORS}
                        max={COLLAB_LIMITS.MAX_CONCURRENT_EDITORS}
                        value={maxEditorsInput}
                        onChange={(e) =>
                          setMaxEditorsInput(Number(e.target.value))
                        }
                        className="h-7 w-full accent-[hsl(var(--primary))]"
                      />
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={sameLineInput}
                      onClick={() => setSameLineInput((prev) => !prev)}
                      className="glass-control flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <ShieldCheck
                          className={cn(
                            'h-4 w-4',
                            sameLineInput
                              ? 'text-primary'
                              : 'text-muted-foreground',
                          )}
                          aria-hidden="true"
                        />
                        <div>
                          <span className="block text-xs font-medium text-foreground">
                            Same-Line Guard
                          </span>
                          <span className="block font-mono text-[10px] text-muted-foreground">
                            Day-4 CRDT line exclusion
                          </span>
                        </div>
                      </div>
                      <span
                        className={cn(
                          'flex h-5 w-9 items-center rounded-full p-0.5 transition-colors',
                          sameLineInput
                            ? 'bg-primary'
                            : 'bg-muted-foreground/30',
                        )}
                      >
                        <span
                          className={cn(
                            'h-4 w-4 rounded-full bg-white shadow transition-transform',
                            sameLineInput ? 'translate-x-4' : 'translate-x-0',
                          )}
                        />
                      </span>
                    </button>

                    <button
                      type="submit"
                      disabled={updateProjectMutation.isPending}
                      className="btn-studio-primary inline-flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      {updateProjectMutation.isPending && (
                        <Loader2
                          className="h-3.5 w-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      )}
                      <span>Save Workspace Settings</span>
                    </button>
                  </form>

                  {/* Owner Danger Zone */}
                  <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] p-3">
                    <span className="block font-mono text-[10px] font-semibold uppercase tracking-wider text-destructive">
                      Danger Zone
                    </span>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Permanently remove all branches, files, and collaborator
                      history.
                    </p>
                    {confirmDeleteProject ? (
                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          disabled={deleteProjectMutation.isPending}
                          onClick={() => deleteProjectMutation.mutate()}
                          className="inline-flex items-center gap-1 rounded-xl bg-destructive px-3 py-1.5 font-mono text-[11px] font-semibold text-destructive-foreground"
                        >
                          {deleteProjectMutation.isPending && (
                            <Loader2
                              className="h-3 w-3 animate-spin"
                              aria-hidden="true"
                            />
                          )}
                          <span>Confirm Delete</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProject(false)}
                          className="glass-control rounded-xl px-3 py-1.5 font-mono text-[11px] text-foreground"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteProject(true)}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 px-3 py-1.5 font-mono text-[11px] font-medium text-destructive hover:bg-destructive/15"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Delete Workspace</span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="glass-control space-y-2.5 rounded-2xl p-3 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Visibility</span>
                    <span className="text-foreground">
                      {project.isPublic ? 'Public' : 'Private'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Your Role</span>
                    <span className="text-foreground">
                      {project.currentUserRole ?? 'viewer'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Editors</span>
                    <span className="text-foreground">
                      {project.maxConcurrentEditors}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Same-Line Guard</span>
                    <span className="text-foreground">
                      {project.preventSameLineEdit ? 'Strict' : 'Free-Flow'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active Branch</span>
                    <span className="text-foreground">
                      {branch?.name ?? 'main'}
                      {branch?.isProtected ? ' (protected)' : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}