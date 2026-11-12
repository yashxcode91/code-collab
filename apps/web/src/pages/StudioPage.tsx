import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  ProjectFileDetailDto,
  ProjectFileNodeDto,
} from '@codecollab/shared';
import { BrandLogo } from '@/components/BrandLogo';
import { FileExplorerPane } from '@/components/studio-ide/FileExplorerPane';
import { disposeStudioModels } from '@/components/studio-ide/monacoWorkerSetup';
import { StudioEditorPane } from '@/components/studio-ide/StudioEditorPane';
import { StudioInspectorDrawer } from '@/components/studio-ide/StudioInspectorDrawer';
import {
  collectSubtreeIds,
  pickDefaultEntryFile,
} from '@/components/studio-ide/studioLanguage';
import { StudioTopBar } from '@/components/studio-ide/StudioTopBar';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { useRealtimeCollab } from '@/hooks/useRealtimeCollab';
import { ApiClientError } from '@/lib/api';
import {
  fetchBranchFiles,
  fetchFileDetail,
  fetchProjectDetail,
  lockFileNode,
  queryKeys,
  unlockFileNode,
  updateFileNode,
} from '@/lib/queries';
import {
  type FileVersionConflict,
  useStudioStore,
} from '@/stores/useStudioStore';
import { cn } from '@/lib/utils';

/**
 * Full Split-Pane Monaco Studio IDE (`/studio/:projectId`):
 * - Syncs server state (workspace detail, branches, branch tree, file content) via TanStack React Query
 * - Syncs ephemeral session state (open tabs, dirty draft buffers, cursor telemetry, drawers) via Zustand
 * - Lazy-loaded via `React.lazy` in `App.tsx` so `monaco-editor` & workers stay out of entry bundles
 */
export function StudioPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [saveError, setSaveError] = useState<string | null>(null);
  const [scrollToLineRequest, setScrollToLineRequest] = useState<{
    line: number;
    seq: number;
  } | null>(null);
  const autoOpenedBranchRef = useRef<string | null>(null);

  // Ephemeral Zustand IDE state
  const storeProjectId = useStudioStore((s) => s.projectId);
  const storeBranchId = useStudioStore((s) => s.activeBranchId);
  const openTabIds = useStudioStore((s) => s.openTabIds);
  const activeFileId = useStudioStore((s) => s.activeFileId);
  const aclTargetNodeId = useStudioStore((s) => s.aclTargetNodeId);
  const expandedFolderIds = useStudioStore((s) => s.expandedFolderIds);
  const buffers = useStudioStore((s) => s.buffers);
  const conflicts = useStudioStore((s) => s.conflicts);
  const rightPanelTab = useStudioStore((s) => s.rightPanelTab);
  const explorerCollapsed = useStudioStore((s) => s.explorerCollapsed);
  const isWindowExpanded = useStudioStore((s) => s.isWindowExpanded);
  const focusModeEnabled = useStudioStore((s) => s.focusModeEnabled);

  const initProjectSession = useStudioStore((s) => s.initProjectSession);
  const selectBranch = useStudioStore((s) => s.selectBranch);
  const openFileTab = useStudioStore((s) => s.openFileTab);
  const closeFileTab = useStudioStore((s) => s.closeFileTab);
  const setAclTargetNodeId = useStudioStore((s) => s.setAclTargetNodeId);
  const toggleFolder = useStudioStore((s) => s.toggleFolder);
  const setFolderExpanded = useStudioStore((s) => s.setFolderExpanded);
  const hydrateFileBuffer = useStudioStore((s) => s.hydrateFileBuffer);
  const updateDraftContent = useStudioStore((s) => s.updateDraftContent);
  const syncCollabBuffer = useStudioStore((s) => s.syncCollabBuffer);
  const markFileSaved = useStudioStore((s) => s.markFileSaved);
  const discardFileDraft = useStudioStore((s) => s.discardFileDraft);
  const setCursorPosition = useStudioStore((s) => s.setCursorPosition);
  const setFileConflict = useStudioStore((s) => s.setFileConflict);
  const removeDeletedNode = useStudioStore((s) => s.removeDeletedNode);
  const setRightPanelTab = useStudioStore((s) => s.setRightPanelTab);
  const toggleExplorer = useStudioStore((s) => s.toggleExplorer);
  const toggleWindowExpanded = useStudioStore((s) => s.toggleWindowExpanded);
  const toggleFocusMode = useStudioStore((s) => s.toggleFocusMode);
  const resetStudio = useStudioStore((s) => s.resetStudio);

  // Reset ephemeral IDE store and dispose stale Monaco models when switching/leaving Studio
  useEffect(() => {
    return () => {
      disposeStudioModels('inmemory://studio/');
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      resetStudio();
    };
  }, [resetStudio]);

  // 1. Fetch Workspace Detail, Branches & Members
  const detailQuery = useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => fetchProjectDetail(projectId),
    enabled: Boolean(projectId),
  });

  const project = detailQuery.data?.project ?? null;
  const branches = useMemo(
    () => detailQuery.data?.branches ?? [],
    [detailQuery.data?.branches],
  );
  const members = useMemo(
    () => detailQuery.data?.members ?? [],
    [detailQuery.data?.members],
  );

  const defaultBranch = useMemo(
    () => branches.find((b) => b.isDefault) ?? branches[0] ?? null,
    [branches],
  );

  const activeBranch = useMemo(() => {
    if (branches.length === 0) return null;
    return branches.find((b) => b.id === storeBranchId) ?? defaultBranch;
  }, [branches, storeBranchId, defaultBranch]);

  // Synchronize Zustand session with resolved project & branch
  useEffect(() => {
    if (!project) return;
    initProjectSession(project.id, defaultBranch?.id ?? null);
  }, [project, defaultBranch?.id, initProjectSession]);

  useEffect(() => {
    if (
      project &&
      storeProjectId === project.id &&
      activeBranch &&
      storeBranchId &&
      storeBranchId !== activeBranch.id
    ) {
      selectBranch(activeBranch.id);
    }
  }, [project, storeProjectId, activeBranch, storeBranchId, selectBranch]);

  // 2. Fetch Active Branch File/Folder Tree
  const branchFilesQuery = useQuery({
    queryKey: queryKeys.projects.files(projectId, activeBranch?.id ?? 'none'),
    queryFn: () => fetchBranchFiles(projectId, activeBranch!.id),
    enabled: Boolean(projectId && activeBranch?.id),
  });

  const files = useMemo(
    () => branchFilesQuery.data ?? [],
    [branchFilesQuery.data],
  );

  const activeFile = useMemo(
    () =>
      files.find((f) => f.id === activeFileId && f.nodeType === 'file') ??
      null,
    [files, activeFileId],
  );

  // Auto-open workspace entry file once per branch session
  useEffect(() => {
    if (
      !project ||
      !activeBranch ||
      !branchFilesQuery.isSuccess ||
      branchFilesQuery.isFetching
    ) {
      return;
    }

    const sessionBranchKey = `${project.id}:${activeBranch.id}`;

    // Prune open tabs that were deleted remotely or hidden by ACL
    const existingFileIds = new Set(
      files.filter((f) => f.nodeType === 'file').map((f) => f.id),
    );
    const staleTabIds = openTabIds.filter((id) => !existingFileIds.has(id));
    if (staleTabIds.length > 0) {
      removeDeletedNode(staleTabIds);
    }

    if (
      autoOpenedBranchRef.current !== sessionBranchKey &&
      openTabIds.length === 0
    ) {
      autoOpenedBranchRef.current = sessionBranchKey;
      const entry = pickDefaultEntryFile(files, project.language);
      if (entry) {
        openFileTab(entry.id);
      }
    } else if (autoOpenedBranchRef.current !== sessionBranchKey) {
      autoOpenedBranchRef.current = sessionBranchKey;
    }
  }, [
    project,
    activeBranch,
    branchFilesQuery.isSuccess,
    branchFilesQuery.isFetching,
    files,
    openTabIds,
    openFileTab,
    removeDeletedNode,
  ]);

  // 3. Fetch Active File Content & Version
  const activeFileDetailQuery = useQuery({
    queryKey: queryKeys.projects.fileDetail(
      projectId,
      activeBranch?.id ?? 'none',
      activeFile?.id ?? 'none',
    ),
    queryFn: () =>
      fetchFileDetail(projectId, activeBranch!.id, activeFile!.id),
    enabled: Boolean(
      projectId && activeBranch?.id && activeFile && activeFile.nodeType === 'file',
    ),
  });

  // 3b. Real-Time Socket.IO + Yjs CRDT Room Session
  const handleCollabPermissionChanged = useCallback(
    (payload: { branchId: string; fileId: string }) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.files(projectId, payload.branchId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.fileDetail(
          projectId,
          payload.branchId,
          payload.fileId,
        ),
      });
    },
    [projectId, queryClient],
  );

  const collab = useRealtimeCollab({
    projectId: project?.id ?? '',
    branchId: activeBranch?.id ?? null,
    fileId: activeFile?.id ?? null,
    enabled: Boolean(project && user),
    onContentSynced: syncCollabBuffer,
    onPermissionChanged: handleCollabPermissionChanged,
  });

  useEffect(() => {
    if (
      activeFileDetailQuery.data &&
      activeFileDetailQuery.data.id === activeFile?.id &&
      !collab.roomReady
    ) {
      hydrateFileBuffer(activeFileDetailQuery.data);
    }
  }, [activeFileDetailQuery.data, activeFile?.id, collab.roomReady, hydrateFileBuffer]);

  // Clear save banner when switching active file
  useEffect(() => {
    setSaveError(null);
  }, [activeFileId, activeBranch?.id]);

  // 4. Optimistic CAS Save Mutation
  const saveFileMutation = useMutation({
    mutationFn: ({
      branchId,
      fileId,
      content,
      expectedVersion,
    }: {
      branchId: string;
      fileId: string;
      content: string;
      expectedVersion: number;
    }) =>
      updateFileNode(projectId, branchId, fileId, {
        content,
        expectedVersion,
      }),
  });

  const handleSaveFile = useCallback(
    async (explicitFileId?: string): Promise<boolean> => {
      const targetId = explicitFileId ?? activeFileId;
      if (!targetId || !activeBranch?.id) return false;

      const draft = useStudioStore.getState().buffers[targetId];
      if (!draft) return false;

      // When live CRDT is active and synced cleanly, avoid stale REST `expectedVersion` collisions
      if (collab.roomReady && targetId === activeFileId && !draft.isDirty) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.fileDetail(
            projectId,
            activeBranch.id,
            targetId,
          ),
        });
        return true;
      }

      setSaveError(null);

      try {
        const updated = await saveFileMutation.mutateAsync({
          branchId: activeBranch.id,
          fileId: targetId,
          content: draft.content,
          expectedVersion: draft.savedVersion,
        });

        markFileSaved(updated);

        // Update detail & tree caches immediately so version badge stays exact
        queryClient.setQueryData(
          queryKeys.projects.fileDetail(projectId, activeBranch.id, targetId),
          updated,
        );
        queryClient.setQueryData<ProjectFileNodeDto[]>(
          queryKeys.projects.files(projectId, activeBranch.id),
          (prev) =>
            prev
              ? prev.map((node) =>
                  node.id === updated.id
                    ? {
                        ...node,
                        version: updated.version,
                        updatedAt: updated.updatedAt,
                        lockedById: updated.lockedById,
                        lockedByUsername: updated.lockedByUsername,
                        lockedAt: updated.lockedAt,
                        effectivePermission: updated.effectivePermission,
                      }
                    : node,
                )
              : prev,
        );
        return true;
      } catch (err) {
        if (err instanceof ApiClientError && err.code === 'FILE_VERSION_CONFLICT') {
          const details =
            err.details && typeof err.details === 'object'
              ? (err.details as {
                  version?: unknown;
                  content?: unknown;
                  updatedAt?: unknown;
                })
              : null;

          if (details && typeof details.version === 'number') {
            setFileConflict(targetId, {
              fileId: targetId,
              message: err.message,
              serverVersion: details.version,
              serverContent:
                typeof details.content === 'string' ? details.content : '',
              serverUpdatedAt:
                typeof details.updatedAt === 'string' ? details.updatedAt : '',
            });
            return false;
          }
        }

        setSaveError(
          err instanceof Error ? err.message : 'Unable to save file changes',
        );
        return false;
      }
    },
    [
      activeFileId,
      activeBranch?.id,
      collab.roomReady,
      projectId,
      saveFileMutation,
      markFileSaved,
      queryClient,
      setFileConflict,
    ],
  );

  // Conflict Resolution: overwrite with server snapshot OR force overwrite with bumped expectedVersion
  const handleResolveConflictReload = useCallback(
    (fileId: string, conflict: FileVersionConflict) => {
      if (!activeBranch?.id) return;
      const baseNode = files.find((f) => f.id === fileId);
      if (!baseNode) return;

      const resolvedDetail: ProjectFileDetailDto = {
        ...baseNode,
        content: conflict.serverContent,
        version: conflict.serverVersion,
        updatedAt: conflict.serverUpdatedAt || baseNode.updatedAt,
      };

      hydrateFileBuffer(resolvedDetail, { forceOverwrite: true });
      queryClient.setQueryData(
        queryKeys.projects.fileDetail(projectId, activeBranch.id, fileId),
        resolvedDetail,
      );
      queryClient.setQueryData<ProjectFileNodeDto[]>(
        queryKeys.projects.files(projectId, activeBranch.id),
        (prev) =>
          prev
            ? prev.map((n) =>
                n.id === fileId
                  ? {
                      ...n,
                      version: conflict.serverVersion,
                      updatedAt: resolvedDetail.updatedAt,
                    }
                  : n,
              )
            : prev,
      );
      setSaveError(null);
    },
    [activeBranch?.id, files, hydrateFileBuffer, projectId, queryClient],
  );

  const handleResolveConflictOverwrite = useCallback(
    async (fileId: string, serverVersion: number) => {
      if (!activeBranch?.id) return;
      const draft = useStudioStore.getState().buffers[fileId];
      if (!draft) return;

      setSaveError(null);
      try {
        const updated = await saveFileMutation.mutateAsync({
          branchId: activeBranch.id,
          fileId,
          content: draft.content,
          expectedVersion: serverVersion,
        });
        markFileSaved(updated);
        queryClient.setQueryData(
          queryKeys.projects.fileDetail(projectId, activeBranch.id, fileId),
          updated,
        );
        await queryClient.invalidateQueries({
          queryKey: queryKeys.projects.files(projectId, activeBranch.id),
        });
      } catch (err) {
        setSaveError(
          err instanceof Error
            ? err.message
            : 'Unable to overwrite conflicting file version',
        );
      }
    },
    [
      activeBranch?.id,
      markFileSaved,
      projectId,
      queryClient,
      saveFileMutation,
    ],
  );

  // 5. Checkout Lock / Unlock Mutation
  const lockMutation = useMutation({
    mutationFn: ({
      branchId,
      fileId,
      shouldLock,
    }: {
      branchId: string;
      fileId: string;
      shouldLock: boolean;
    }) =>
      shouldLock
        ? lockFileNode(projectId, branchId, fileId)
        : unlockFileNode(projectId, branchId, fileId),
    onSuccess: async (updatedNode, vars) => {
      setSaveError(null);
      queryClient.setQueryData<ProjectFileNodeDto[]>(
        queryKeys.projects.files(projectId, vars.branchId),
        (prev) =>
          prev
            ? prev.map((n) => (n.id === updatedNode.id ? updatedNode : n))
            : prev,
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.fileDetail(
          projectId,
          vars.branchId,
          vars.fileId,
        ),
      });
    },
    onError: (err) => {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'Unable to update file checkout lock',
      );
    },
  });

  const handleToggleLockActiveFile = useCallback(() => {
    if (!activeFile || activeFile.nodeType !== 'file' || !activeBranch?.id) {
      return;
    }
    lockMutation.mutate({
      branchId: activeBranch.id,
      fileId: activeFile.id,
      shouldLock: !activeFile.lockedById,
    });
  }, [activeBranch?.id, activeFile, lockMutation]);

  // Branch switch handler with Monaco model cleanup
  const handleSelectBranch = useCallback(
    (nextBranchId: string) => {
      if (activeBranch?.id && activeBranch.id !== nextBranchId) {
        disposeStudioModels(`inmemory://studio/${activeBranch.id}/`);
      }
      autoOpenedBranchRef.current = null;
      selectBranch(nextBranchId);
    },
    [activeBranch?.id, selectBranch],
  );

  // Rename / Delete model & tab cleanup handlers
  const handleNodeRenamed = useCallback(
    (updated: ProjectFileDetailDto) => {
      if (!activeBranch?.id) return;
      disposeStudioModels(`inmemory://studio/${activeBranch.id}/${updated.id}/`);
      if (
        updated.nodeType === 'file' &&
        !useStudioStore.getState().buffers[updated.id]?.isDirty
      ) {
        hydrateFileBuffer(updated, { forceOverwrite: true });
      }
    },
    [activeBranch?.id, hydrateFileBuffer],
  );

  const handleNodeDeleted = useCallback(
    (deletedRootId: string) => {
      const deletedIds = collectSubtreeIds(files, deletedRootId);
      if (activeBranch?.id) {
        for (const id of deletedIds) {
          disposeStudioModels(`inmemory://studio/${activeBranch.id}/${id}/`);
        }
      }
      removeDeletedNode(deletedIds);
    },
    [activeBranch?.id, files, removeDeletedNode],
  );

  // Global Ctrl/Cmd + S save handler + beforeunload guard for dirty buffers
  const handleSaveRef = useRef(handleSaveFile);
  handleSaveRef.current = handleSaveFile;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault();
        void handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const dirtyCount = useMemo(
    () => Object.values(buffers).filter((b) => b.isDirty).length,
    [buffers],
  );

  useEffect(() => {
    if (dirtyCount === 0) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirtyCount]);

  // --- Loading State ---
  if (detailQuery.isLoading) {
    return (
      <div className="relative min-h-dvh bg-background text-foreground">
        <StudioBackdrop />
        <header className="sticky top-4 z-30 mx-auto max-w-6xl px-4 sm:px-6">
          <div className="glass-mirror flex items-center justify-between rounded-2xl px-4 py-2.5">
            <div className="relative z-10 flex items-center gap-3">
              <BrandLogo size="sm" />
              <Link
                to="/"
                className="glass-control inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Workspaces</span>
              </Link>
            </div>
            <div className="relative z-10">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto flex max-w-4xl items-center justify-center px-4 pt-20">
          <div className="glass-mirror flex items-center gap-3 rounded-3xl px-7 py-5 font-mono text-xs text-muted-foreground">
            <Loader2
              className="h-4 w-4 animate-spin text-primary"
              aria-hidden="true"
            />
            <span>Provisioning Studio IDE workspace…</span>
          </div>
        </main>
      </div>
    );
  }

  // --- Error / Unauthorized State ---
  if (detailQuery.isError || !project) {
    return (
      <div className="relative min-h-dvh bg-background text-foreground">
        <StudioBackdrop />
        <header className="sticky top-4 z-30 mx-auto max-w-6xl px-4 sm:px-6">
          <div className="glass-mirror flex items-center justify-between rounded-2xl px-4 py-2.5">
            <div className="relative z-10 flex items-center gap-3">
              <BrandLogo size="sm" />
              <Link
                to="/"
                className="glass-control inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Workspaces</span>
              </Link>
            </div>
            <div className="relative z-10">
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main className="relative z-10 mx-auto max-w-2xl px-4 pt-16">
          <section className="glass-mirror rounded-3xl p-8">
            <div className="relative z-10 space-y-4">
              <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] text-destructive">
                Workspace Unavailable
              </span>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Unable to open Studio workspace
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'This project may have been removed or you no longer have access to it.'}
              </p>
              <Link
                to="/"
                className="btn-studio-primary inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Return to Dashboard</span>
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const currentUserId = user?.id ?? '';
  const isEditorOrOwner =
    project.currentUserRole === 'owner' || project.currentUserRole === 'editor';
  const activeDraft = activeFile ? (buffers[activeFile.id] ?? null) : null;
  const activeConflict = activeFile ? (conflicts[activeFile.id] ?? null) : null;
  const effectiveActivePermission =
    collab.roomReady && collab.serverPermission
      ? collab.serverPermission
      : activeFile?.effectivePermission;
  const canEditActiveFile = Boolean(
    activeFile &&
      activeFile.nodeType === 'file' &&
      isEditorOrOwner &&
      effectiveActivePermission === 'edit',
  );
  const resolvedPreventSameLineEdit =
    collab.preventSameLineEdit ?? project.preventSameLineEdit;

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <StudioBackdrop />

      {/* Top IDE Bar attached flush to top viewport edge */}
      <StudioTopBar
        project={project}
        branches={branches}
        activeBranch={activeBranch}
        activeFile={activeFile}
        canEditActiveFile={canEditActiveFile}
        isDirtyActiveFile={Boolean(activeDraft?.isDirty)}
        dirtyCount={dirtyCount}
        isSaving={saveFileMutation.isPending}
        isLockPending={lockMutation.isPending}
        currentUserId={currentUserId}
        explorerCollapsed={explorerCollapsed}
        isWindowExpanded={isWindowExpanded}
        rightPanelTab={rightPanelTab}
        collabConnectionStatus={collab.connectionStatus}
        collabSyncStatus={collab.syncStatus}
        collabRoomReady={collab.roomReady}
        presenceUsers={collab.presenceUsers}
        onJumpToCollaboratorLine={(line) =>
          setScrollToLineRequest((prev) => ({ line, seq: (prev?.seq ?? 0) + 1 }))
        }
        onToggleExplorer={toggleExplorer}
        onToggleWindowExpanded={toggleWindowExpanded}
        onSelectBranch={handleSelectBranch}
        onSaveActiveFile={() => void handleSaveFile()}
        onToggleLockActiveFile={handleToggleLockActiveFile}
        onSetRightPanelTab={setRightPanelTab}
      />

      {/* Split-Pane Studio Body with balanced framing below attached top bar */}
      <div
        className={cn(
          'relative z-10 flex min-h-0 flex-1 justify-center',
          isWindowExpanded ? 'p-2.5 sm:p-3' : 'p-3 sm:p-4',
        )}
      >
        <main
          className={cn(
            'flex min-h-0 w-full flex-1 gap-3.5 transition-[max-width] duration-200 ease-out',
            isWindowExpanded ? 'max-w-none' : 'sm:max-w-[min(95vw,1600px)]',
          )}
        >
          <FileExplorerPane
            projectId={project.id}
            branch={activeBranch}
            files={files}
            isLoading={branchFilesQuery.isLoading}
            isRefreshing={branchFilesQuery.isFetching}
            userRole={project.currentUserRole}
            currentUserId={currentUserId}
            activeFileId={activeFileId}
            expandedFolderIds={expandedFolderIds}
            buffers={buffers}
            collapsed={explorerCollapsed}
            onCollapseMobile={toggleExplorer}
            onRefresh={() =>
              activeBranch?.id &&
              void queryClient.invalidateQueries({
                queryKey: queryKeys.projects.files(project.id, activeBranch.id),
              })
            }
            onOpenFile={openFileTab}
            onToggleFolder={toggleFolder}
            onSetFolderExpanded={setFolderExpanded}
            onNodeRenamed={handleNodeRenamed}
            onNodeDeleted={handleNodeDeleted}
            onOpenAcl={(nodeId) => {
              setAclTargetNodeId(nodeId);
              setRightPanelTab('access');
            }}
          />

          <StudioEditorPane
            project={project}
            branch={activeBranch}
            files={files}
            openTabIds={openTabIds}
            activeFile={activeFile}
            activeDraft={activeDraft}
            activeConflict={activeConflict}
            isFileLoading={activeFileDetailQuery.isLoading}
            fileLoadError={
              activeFileDetailQuery.isError
                ? activeFileDetailQuery.error instanceof Error
                  ? activeFileDetailQuery.error.message
                  : 'Unable to fetch file content'
                : null
            }
            saveError={saveError}
            isSaving={saveFileMutation.isPending}
            canEditActiveFile={canEditActiveFile}
            buffers={buffers}
            currentUserId={currentUserId}
            collabConnectionStatus={collab.connectionStatus}
            collabSyncStatus={collab.syncStatus}
            collabRoomReady={collab.roomReady}
            collabActiveRoomKey={collab.activeRoomKey}
            collabYText={collab.ytext}
            presenceUsers={collab.presenceUsers}
            preventSameLineEdit={resolvedPreventSameLineEdit}
            realtimeError={collab.realtimeError}
            focusModeEnabled={focusModeEnabled}
            scrollToLineRequest={scrollToLineRequest}
            onSelectTab={openFileTab}
            onCloseTab={closeFileTab}
            onChangeContent={updateDraftContent}
            onChangeCursor={setCursorPosition}
            onSaveFile={handleSaveFile}
            onDiscardDraft={discardFileDraft}
            onResolveConflictReload={handleResolveConflictReload}
            onResolveConflictOverwrite={handleResolveConflictOverwrite}
            onDismissSaveError={() => setSaveError(null)}
            onDismissRealtimeError={collab.clearRealtimeError}
            onToggleFocusMode={toggleFocusMode}
            onPublishAwareness={collab.publishAwareness}
            onRetryFileLoad={() => void activeFileDetailQuery.refetch()}
          />

          <StudioInspectorDrawer
            project={project}
            branch={activeBranch}
            members={members}
            files={files}
            activeFileId={activeFileId}
            aclTargetNodeId={aclTargetNodeId}
            currentUserId={currentUserId}
            activeTab={rightPanelTab}
            onChangeTab={setRightPanelTab}
            onSelectAclTarget={setAclTargetNodeId}
            onWorkspaceLeftOrDeleted={() => navigate('/', { replace: true })}
          />
        </main>
      </div>
    </div>
  );
}

export default StudioPage;