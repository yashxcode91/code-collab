import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronRight,
  Eye,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Shield,
  Trash2,
  X,
} from 'lucide-react';
import {
  SafeNodeNameSchema,
  type FileNodeType,
  type ProjectBranchDto,
  type ProjectFileDetailDto,
  type ProjectFileNodeDto,
  type ProjectRole,
} from '@codecollab/shared';
import {
  buildFileTree,
  collectSubtreeIds,
  resolveFileExtensionTag,
  type FileTreeBranch,
} from '@/components/studio-ide/studioLanguage';
import { ApiClientError } from '@/lib/api';
import {
  createFileNode,
  deleteFileNode,
  queryKeys,
  updateFileNode,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { FileDraftBuffer } from '@/stores/useStudioStore';

interface CreateDraftState {
  nodeType: FileNodeType;
  parentId: string | null;
}

interface RenameDraftState {
  nodeId: string;
  value: string;
}

interface MoveDraftState {
  nodeId: string;
  targetParentId: string; // '' maps to null (root)
}

interface FileExplorerPaneProps {
  projectId: string;
  branch: ProjectBranchDto | null;
  files: ProjectFileNodeDto[];
  isLoading: boolean;
  isRefreshing: boolean;
  userRole: ProjectRole | null | undefined;
  currentUserId: string;
  activeFileId: string | null;
  expandedFolderIds: Record<string, boolean>;
  buffers: Record<string, FileDraftBuffer>;
  collapsed: boolean;
  onCollapseMobile: () => void;
  onRefresh: () => void;
  onOpenFile: (fileId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSetFolderExpanded: (folderId: string, expanded: boolean) => void;
  onNodeRenamed: (updated: ProjectFileDetailDto) => void;
  onNodeDeleted: (deletedNodeId: string) => void;
  onOpenAcl: (nodeId: string) => void;
}

/**
 * Left Studio Explorer Sidebar rendering the live PostgreSQL folder/file tree,
 * dirty/lock/permission indicators, and full CRUD actions (`+ File`, `+ Folder`,
 * Rename, Move, Delete, and Owner Per-Node ACL trigger).
 */
export function FileExplorerPane({
  projectId,
  branch,
  files,
  isLoading,
  isRefreshing,
  userRole,
  currentUserId,
  activeFileId,
  expandedFolderIds,
  buffers,
  collapsed,
  onCollapseMobile,
  onRefresh,
  onOpenFile,
  onToggleFolder,
  onSetFolderExpanded,
  onNodeRenamed,
  onNodeDeleted,
  onOpenAcl,
}: FileExplorerPaneProps) {
  const queryClient = useQueryClient();
  const branchId = branch?.id ?? '';
  const isOwner = userRole === 'owner';
  const canWriteBranch =
    isOwner || (userRole === 'editor' && !branch?.isProtected);

  const [createDraft, setCreateDraft] = useState<CreateDraftState | null>(null);
  const [createName, setCreateName] = useState('');
  const [renameDraft, setRenameDraft] = useState<RenameDraftState | null>(null);
  const [moveDraft, setMoveDraft] = useState<MoveDraftState | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [explorerError, setExplorerError] = useState<string | null>(null);

  const tree = useMemo(() => buildFileTree(files), [files]);

  const folders = useMemo(
    () =>
      files
        .filter((f) => f.nodeType === 'folder')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  const invalidateTree = async () => {
    if (!branchId) return;
    await queryClient.invalidateQueries({
      queryKey: queryKeys.projects.files(projectId, branchId),
    });
  };

  const createMutation = useMutation({
    mutationFn: (payload: {
      name: string;
      nodeType: FileNodeType;
      parentId: string | null;
    }) => createFileNode(projectId, branchId, payload),
    onSuccess: async (created) => {
      setCreateDraft(null);
      setCreateName('');
      setExplorerError(null);
      await invalidateTree();
      if (created.parentId) {
        onSetFolderExpanded(created.parentId, true);
      }
      if (created.nodeType === 'folder') {
        onSetFolderExpanded(created.id, true);
      } else {
        onOpenFile(created.id);
      }
    },
    onError: (err) => {
      setExplorerError(
        err instanceof ApiClientError ? err.message : 'Unable to create node',
      );
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ nodeId, name }: { nodeId: string; name: string }) =>
      updateFileNode(projectId, branchId, nodeId, { name }),
    onSuccess: async (updated) => {
      setRenameDraft(null);
      setExplorerError(null);
      onNodeRenamed(updated);
      await invalidateTree();
    },
    onError: (err) => {
      setExplorerError(
        err instanceof ApiClientError ? err.message : 'Unable to rename node',
      );
    },
  });

  const moveMutation = useMutation({
    mutationFn: ({
      nodeId,
      parentId,
    }: {
      nodeId: string;
      parentId: string | null;
    }) => updateFileNode(projectId, branchId, nodeId, { parentId }),
    onSuccess: async (_, variables) => {
      setMoveDraft(null);
      setExplorerError(null);
      if (variables.parentId) {
        onSetFolderExpanded(variables.parentId, true);
      }
      await invalidateTree();
    },
    onError: (err) => {
      setExplorerError(
        err instanceof ApiClientError ? err.message : 'Unable to move node',
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: string) => deleteFileNode(projectId, branchId, nodeId),
    onSuccess: async (_, deletedId) => {
      setConfirmDeleteId(null);
      setExplorerError(null);
      onNodeDeleted(deletedId);
      await invalidateTree();
    },
    onError: (err) => {
      setConfirmDeleteId(null);
      setExplorerError(
        err instanceof ApiClientError ? err.message : 'Unable to delete node',
      );
    },
  });

  const startCreate = (nodeType: FileNodeType, parentId: string | null) => {
    setExplorerError(null);
    setRenameDraft(null);
    setMoveDraft(null);
    setConfirmDeleteId(null);
    if (parentId) {
      onSetFolderExpanded(parentId, true);
    }
    setCreateDraft({ nodeType, parentId });
    setCreateName('');
  };

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!createDraft || !branchId) return;
    setExplorerError(null);

    const parsed = SafeNodeNameSchema.safeParse(createName);
    if (!parsed.success) {
      setExplorerError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }

    createMutation.mutate({
      name: parsed.data,
      nodeType: createDraft.nodeType,
      parentId: createDraft.parentId,
    });
  };

  const submitRename = (event: React.FormEvent) => {
    event.preventDefault();
    if (!renameDraft || !branchId) return;
    setExplorerError(null);

    const original = files.find((f) => f.id === renameDraft.nodeId);
    const parsed = SafeNodeNameSchema.safeParse(renameDraft.value);
    if (!parsed.success) {
      setExplorerError(parsed.error.issues[0]?.message ?? 'Invalid name');
      return;
    }
    if (original && parsed.data === original.name) {
      setRenameDraft(null);
      return;
    }

    renameMutation.mutate({
      nodeId: renameDraft.nodeId,
      name: parsed.data,
    });
  };

  const submitMove = (event: React.FormEvent, node: ProjectFileNodeDto) => {
    event.preventDefault();
    if (!moveDraft || !branchId) return;
    const nextParent =
      moveDraft.targetParentId === '' ? null : moveDraft.targetParentId;
    if (nextParent === (node.parentId ?? null)) {
      setMoveDraft(null);
      return;
    }
    moveMutation.mutate({ nodeId: node.id, parentId: nextParent });
  };

  if (collapsed) {
    return null;
  }

  const renderCreateForm = (depth: number) => {
    if (!createDraft) return null;
    return (
      <form
        onSubmit={submitCreate}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        className="flex items-center gap-1.5 py-1 pr-2"
      >
        {createDraft.nodeType === 'folder' ? (
          <FolderPlus
            className="h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        ) : (
          <FilePlus
            className="h-3.5 w-3.5 shrink-0 text-primary"
            aria-hidden="true"
          />
        )}
        <input
          type="text"
          autoFocus
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setCreateDraft(null);
              setCreateName('');
            }
          }}
          placeholder={
            createDraft.nodeType === 'folder' ? 'folder-name' : 'filename.ts'
          }
          className="glass-control h-7 min-w-0 flex-1 rounded-lg px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="btn-studio-primary h-7 shrink-0 rounded-lg px-2 font-mono text-[10px] font-semibold"
        >
          {createMutation.isPending ? '…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={() => setCreateDraft(null)}
          aria-label="Cancel create"
          className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" aria-hidden="true" />
        </button>
      </form>
    );
  };

  const renderBranchNode = (item: FileTreeBranch): React.ReactNode => {
    const { node, children, depth } = item;
    const isFolder = node.nodeType === 'folder';
    const isExpanded = expandedFolderIds[node.id] ?? true;
    const isSelected = activeFileId === node.id;
    const isRenaming = renameDraft?.nodeId === node.id;
    const isMoving = moveDraft?.nodeId === node.id;
    const isConfirmDelete = confirmDeleteId === node.id;
    const isDirty = Boolean(buffers[node.id]?.isDirty);

    const isLockedByMe = node.lockedById === currentUserId;
    const isLockedByOther = Boolean(
      node.lockedById && node.lockedById !== currentUserId,
    );
    const isReadOnly = node.effectivePermission === 'read_only';

    // Backend requires edit access on node & no active foreign checkout lock for rename/move/delete
    const canModifyNode =
      canWriteBranch &&
      !isLockedByOther &&
      (isOwner || node.effectivePermission === 'edit');

    const canCreateInsideFolder =
      isFolder &&
      canWriteBranch &&
      !isLockedByOther &&
      (isOwner || node.effectivePermission === 'edit');

    const excludedMoveIds =
      isFolder && isMoving ? new Set(collectSubtreeIds(files, node.id)) : null;

    return (
      <div key={node.id}>
        {isRenaming ? (
          <form
            onSubmit={submitRename}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className="flex items-center gap-1 py-1 pr-2"
          >
            <input
              type="text"
              autoFocus
              value={renameDraft.value}
              onChange={(e) =>
                setRenameDraft({ nodeId: node.id, value: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape') setRenameDraft(null);
              }}
              className="glass-control h-7 min-w-0 flex-1 rounded-lg px-2 font-mono text-[11px] text-foreground focus:border-primary/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={renameMutation.isPending}
              className="btn-studio-primary h-7 rounded-lg px-2 font-mono text-[10px] font-semibold"
            >
              OK
            </button>
            <button
              type="button"
              onClick={() => setRenameDraft(null)}
              aria-label="Cancel rename"
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </form>
        ) : (
          <div
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            className={cn(
              'group flex h-8 items-center justify-between gap-1 rounded-xl pr-1.5 text-xs transition-colors',
              isSelected
                ? 'border border-primary/45 bg-primary/[0.14] text-foreground'
                : 'border border-transparent text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
            )}
          >
            <button
              type="button"
              onClick={() => {
                if (isFolder) {
                  onToggleFolder(node.id);
                } else {
                  onOpenFile(node.id);
                }
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
            >
              {isFolder ? (
                <>
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150',
                      isExpanded && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                  {isExpanded ? (
                    <FolderOpen
                      className="h-3.5 w-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  ) : (
                    <Folder
                      className="h-3.5 w-3.5 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </>
              ) : (
                <span className="inline-flex h-4 w-7 shrink-0 items-center justify-center rounded bg-foreground/[0.06] font-mono text-[8.5px] font-semibold tracking-tight text-muted-foreground dark:bg-white/[0.08]">
                  {resolveFileExtensionTag(node.name)}
                </span>
              )}

              <span
                className={cn(
                  'truncate font-mono text-[11.5px]',
                  isSelected && 'font-medium text-foreground',
                )}
              >
                {node.name}
              </span>
            </button>

            {/* Right Status Badges & Quick Hover Actions */}
            <div className="flex shrink-0 items-center gap-0.5">
              {isDirty && (
                <span
                  title="Unsaved changes"
                  className="mr-1 h-2 w-2 rounded-full bg-primary"
                />
              )}

              {isLockedByMe && (
                <Lock
                  className="mr-0.5 h-3 w-3 text-primary"
                  aria-label="Locked by you"
                />
              )}

              {isLockedByOther && (
                <Lock
                  className="mr-0.5 h-3 w-3 text-amber-500"
                  aria-label={`Locked by @${node.lockedByUsername ?? 'user'}`}
                />
              )}

              {!isLockedByOther && isReadOnly && !isFolder && (
                <Eye
                  className="mr-0.5 h-3 w-3 text-muted-foreground/75"
                  aria-label="Read-only access"
                />
              )}

              {/* Hover Action Icons */}
              {isConfirmDelete ? (
                <div className="flex items-center gap-1 pl-1 font-mono text-[9.5px]">
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(node.id)}
                    className="rounded bg-destructive px-1.5 py-0.5 font-semibold text-destructive-foreground"
                  >
                    {deleteMutation.isPending ? '…' : 'Del'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground"
                  >
                    No
                  </button>
                </div>
              ) : (
                <div className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
                  {canCreateInsideFolder && (
                    <>
                      <button
                        type="button"
                        onClick={() => startCreate('file', node.id)}
                        title="New File inside folder"
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <FilePlus className="h-3 w-3" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startCreate('folder', node.id)}
                        title="New Folder inside folder"
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <FolderPlus className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </>
                  )}

                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => onOpenAcl(node.id)}
                      title="Per-user file/folder permissions"
                      className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-primary"
                    >
                      <Shield className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )}

                  {canModifyNode && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setMoveDraft(null);
                          setCreateDraft(null);
                          setRenameDraft({
                            nodeId: node.id,
                            value: node.name,
                          });
                        }}
                        title="Rename"
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          setRenameDraft(null);
                          setCreateDraft(null);
                          setMoveDraft({
                            nodeId: node.id,
                            targetParentId: node.parentId ?? '',
                          });
                        }}
                        title="Move to folder"
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <FolderInput className="h-3 w-3" aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRenameDraft(null);
                          setMoveDraft(null);
                          setCreateDraft(null);
                          setConfirmDeleteId(node.id);
                        }}
                        title="Delete"
                        className="rounded p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Inline Move Node Picker */}
        {isMoving && (
          <form
            onSubmit={(e) => submitMove(e, node)}
            style={{ paddingLeft: `${depth * 14 + 12}px` }}
            className="flex items-center gap-1 py-1 pr-2"
          >
            <select
              value={moveDraft.targetParentId}
              onChange={(e) =>
                setMoveDraft({
                  nodeId: node.id,
                  targetParentId: e.target.value,
                })
              }
              className="glass-control h-7 min-w-0 flex-1 rounded-lg px-2 font-mono text-[10.5px] text-foreground focus:outline-none"
            >
              <option value="">/ (branch root)</option>
              {folders
                .filter((f) => !excludedMoveIds?.has(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    /{f.name}
                  </option>
                ))}
            </select>
            <button
              type="submit"
              disabled={moveMutation.isPending}
              className="btn-studio-primary h-7 rounded-lg px-2 font-mono text-[10px] font-semibold"
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => setMoveDraft(null)}
              aria-label="Cancel move"
              className="rounded-lg p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </form>
        )}

        {/* Nested Children + Inline Create Row Under This Folder */}
        {isFolder && isExpanded && (
          <div>
            {createDraft?.parentId === node.id && renderCreateForm(depth + 1)}
            {children.map((child) => renderBranchNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Click-Outside Scrim */}
      <div
        onClick={onCollapseMobile}
        aria-hidden="true"
        className="fixed inset-0 z-20 bg-black/45 backdrop-blur-[2px] md:hidden"
      />

      <aside
        aria-label="File Explorer"
        className="glass-surface fixed bottom-3 left-3 top-14 z-30 flex w-60 shrink-0 flex-col overflow-hidden rounded-2xl md:static md:inset-auto md:z-10 md:w-60 lg:w-[252px]"
      >
        {/* Explorer Header Toolbar */}
        <div className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5">
          <div className="min-w-0">
            <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Explorer
            </span>
            <span className="block truncate font-mono text-[11px] text-foreground">
              {branch?.name ?? 'main'} · {files.length}{' '}
              {files.length === 1 ? 'node' : 'nodes'}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {canWriteBranch && (
              <>
                <button
                  type="button"
                  onClick={() => startCreate('file', null)}
                  title="New root file"
                  aria-label="New file"
                  className="glass-control inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <FilePlus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => startCreate('folder', null)}
                  title="New root folder"
                  aria-label="New folder"
                  className="glass-control inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh file tree"
              aria-label="Refresh file tree"
              className="glass-control inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={cn(
                  'h-3.5 w-3.5',
                  isRefreshing && 'animate-spin text-primary',
                )}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>

        {/* Protected Branch Banner (Non-Owner Editors) */}
        {branch?.isProtected && !isOwner && (
          <div className="border-b border-border/60 bg-primary/10 px-3 py-1.5 font-mono text-[10px] text-primary">
            Protected branch · read-only
          </div>
        )}

        {/* Inline API / Validation Error Banner */}
        {explorerError && (
          <div className="flex items-start justify-between gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            <div className="flex items-start gap-1.5">
              <AlertCircle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{explorerError}</span>
            </div>
            <button
              type="button"
              onClick={() => setExplorerError(null)}
              aria-label="Dismiss explorer error"
              className="shrink-0 hover:opacity-80"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Scrollable File Tree */}
        <div className="flex-1 overflow-y-auto px-2 py-2.5">
          {createDraft?.parentId === null && renderCreateForm(0)}

          {isLoading && files.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-4 font-mono text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Loading branch tree…</span>
            </div>
          ) : tree.length === 0 && !createDraft ? (
            <div className="space-y-2.5 px-3 py-5 text-center">
              <p className="font-mono text-xs text-muted-foreground">
                This branch has no visible files yet.
              </p>
              {canWriteBranch && (
                <button
                  type="button"
                  onClick={() => startCreate('file', null)}
                  className="glass-control inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-mono text-[11px] text-foreground hover:border-primary/50"
                >
                  <FilePlus className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <span>Create first file</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-0.5">
              {tree.map((branchNode) => renderBranchNode(branchNode))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}