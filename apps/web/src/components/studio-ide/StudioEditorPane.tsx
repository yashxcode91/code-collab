import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorNamespace } from 'monaco-editor';
import {
  AlertTriangle,
  ChevronRight,
  Code2,
  Eye,
  FileCode2,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  X,
} from 'lucide-react';
import type {
  Project,
  ProjectBranchDto,
  ProjectFileNodeDto,
} from '@codecollab/shared';
import {
  disposeStudioModels,
  ensureMonacoConfigured,
  STUDIO_DARK_THEME,
  STUDIO_LIGHT_THEME,
} from '@/components/studio-ide/monacoWorkerSetup';
import {
  buildNodeBreadcrumb,
  resolveFileExtensionTag,
  resolveMonacoLanguage,
} from '@/components/studio-ide/studioLanguage';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';
import type {
  FileDraftBuffer,
  FileVersionConflict,
} from '@/stores/useStudioStore';

// Configure local Vite-bundled Monaco workers & custom themes lazily inside the Studio route only
ensureMonacoConfigured();

interface ReadyEditorSnapshot {
  branchId: string;
  file: ProjectFileNodeDto;
  draft: FileDraftBuffer;
  canEdit: boolean;
}

interface StudioEditorPaneProps {
  project: Project;
  branch: ProjectBranchDto | null;
  files: ProjectFileNodeDto[];
  openTabIds: string[];
  activeFile: ProjectFileNodeDto | null;
  activeDraft: FileDraftBuffer | null;
  activeConflict: FileVersionConflict | null;
  isFileLoading: boolean;
  fileLoadError: string | null;
  saveError: string | null;
  isSaving: boolean;
  canEditActiveFile: boolean;
  buffers: Record<string, FileDraftBuffer>;
  currentUserId: string;
  onSelectTab: (fileId: string) => void;
  onCloseTab: (fileId: string) => void;
  onChangeContent: (fileId: string, value: string) => void;
  onChangeCursor: (fileId: string, line: number, column: number) => void;
  onSaveFile: (fileId?: string) => Promise<boolean>;
  onDiscardDraft: (fileId: string) => void;
  onResolveConflictReload: (fileId: string, conflict: FileVersionConflict) => void;
  onResolveConflictOverwrite: (fileId: string, serverVersion: number) => void;
  onDismissSaveError: () => void;
  onRetryFileLoad: () => void;
}

/**
 * Center Studio IDE editor surface powered by locally bundled `monaco-editor`,
 * supporting open file tabs, breadcrumb navigation, checkout/ACL read-only notices,
 * atomic CAS version-conflict banners, `Ctrl/Cmd + S` saves, and footer telemetry.
 */
export function StudioEditorPane({
  project,
  branch,
  files,
  openTabIds,
  activeFile,
  activeDraft,
  activeConflict,
  isFileLoading,
  fileLoadError,
  saveError,
  isSaving,
  canEditActiveFile,
  buffers,
  currentUserId,
  onSelectTab,
  onCloseTab,
  onChangeContent,
  onChangeCursor,
  onSaveFile,
  onDiscardDraft,
  onResolveConflictReload,
  onResolveConflictOverwrite,
  onDismissSaveError,
  onRetryFileLoad,
}: StudioEditorPaneProps) {
  const { theme } = useTheme();
  const branchId = branch?.id ?? 'default';

  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(
    null,
  );
  const [closingAfterSave, setClosingAfterSave] = useState(false);

  const editorRef = useRef<MonacoEditorNamespace.IStandaloneCodeEditor | null>(
    null,
  );
  const monacoRef = useRef<Monaco | null>(null);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);

  // Refs prevent stale closures inside Monaco event listeners & keyboard bindings
  const onSaveRef = useRef(onSaveFile);
  onSaveRef.current = onSaveFile;

  const onChangeCursorRef = useRef(onChangeCursor);
  onChangeCursorRef.current = onChangeCursor;

  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

  // Snapshot last fully hydrated target so switching to an unhydrated tab shows a loading veil
  // instead of initializing a blank `""` Monaco model that pollutes the Ctrl+Z undo stack.
  const [lastReady, setLastReady] = useState<ReadyEditorSnapshot | null>(null);

  useEffect(() => {
    if (activeFile && activeDraft) {
      setLastReady({
        branchId,
        file: activeFile,
        draft: activeDraft,
        canEdit: canEditActiveFile,
      });
    } else if (!activeFile) {
      setLastReady(null);
    }
  }, [branchId, activeFile, activeDraft, canEditActiveFile]);

  // Clear stale snapshot immediately if user closes all tabs or switches branch
  const renderedTarget = useMemo<ReadyEditorSnapshot | null>(() => {
    if (!activeFile) return null;
    if (activeDraft) {
      return {
        branchId,
        file: activeFile,
        draft: activeDraft,
        canEdit: canEditActiveFile,
      };
    }
    if (lastReady && lastReady.branchId === branchId) {
      return lastReady;
    }
    return null;
  }, [activeFile, activeDraft, branchId, canEditActiveFile, lastReady]);

  const isWaitingForNewBuffer = Boolean(activeFile && !activeDraft);

  const expectedModelPath = renderedTarget
    ? `inmemory://studio/${renderedTarget.branchId}/${renderedTarget.file.id}/${encodeURIComponent(renderedTarget.file.name)}`
    : null;

  const expectedModelPathRef = useRef<string | null>(expectedModelPath);
  expectedModelPathRef.current = expectedModelPath;

  const isWaitingForNewBufferRef = useRef(isWaitingForNewBuffer);
  isWaitingForNewBufferRef.current = isWaitingForNewBuffer;

  // Dispose all Studio Monaco models only when leaving the Studio workspace cleanly
  useEffect(() => {
    return () => {
      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = null;
      disposeStudioModels('inmemory://studio/');
    };
  }, []);

  // Re-evaluate dirty tab prompt if pending close target gets saved/closed elsewhere
  useEffect(() => {
    if (pendingCloseTabId && !openTabIds.includes(pendingCloseTabId)) {
      setPendingCloseTabId(null);
    }
  }, [openTabIds, pendingCloseTabId]);

  const openTabs = useMemo(() => {
    const nodeMap = new Map(files.map((node) => [node.id, node]));
    return openTabIds
      .map((id) => nodeMap.get(id))
      .filter((node): node is ProjectFileNodeDto => Boolean(node));
  }, [files, openTabIds]);

  const breadcrumbs = useMemo(
    () => buildNodeBreadcrumb(files, activeFile?.id ?? null),
    [files, activeFile?.id],
  );

  const monacoLanguage = useMemo(
    () =>
      resolveMonacoLanguage(
        renderedTarget?.file.name ?? activeFile?.name,
        project.language,
      ),
    [renderedTarget?.file.name, activeFile?.name, project.language],
  );

  const handleRequestCloseTab = (tabId: string) => {
    if (buffers[tabId]?.isDirty) {
      setPendingCloseTabId(tabId);
      return;
    }
    onCloseTab(tabId);
  };

  const handleConfirmSaveAndClose = async () => {
    if (!pendingCloseTabId) return;
    setClosingAfterSave(true);
    const saved = await onSaveFile(pendingCloseTabId);
    setClosingAfterSave(false);
    if (saved) {
      const targetId = pendingCloseTabId;
      setPendingCloseTabId(null);
      onCloseTab(targetId);
    }
  };

  const handleBeforeMount = useCallback(() => {
    ensureMonacoConfigured();
  }, []);

  const handleMount = useCallback(
    (
      editorInstance: MonacoEditorNamespace.IStandaloneCodeEditor,
      monacoInstance: Monaco,
    ) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;

      // Bind Ctrl/Cmd + S directly inside Monaco command palette
      editorInstance.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => {
          void onSaveRef.current();
        },
      );

      cursorListenerRef.current?.dispose();
      cursorListenerRef.current = editorInstance.onDidChangeCursorPosition(
        (event) => {
          const current = activeFileRef.current;
          if (!current || current.nodeType !== 'file') return;
          onChangeCursorRef.current(
            current.id,
            event.position.lineNumber,
            event.position.column,
          );
        },
      );
    },
    [],
  );

  const handleEditorChange = useCallback(
    (nextValue: string | undefined) => {
      if (nextValue === undefined || isWaitingForNewBufferRef.current) return;
      const target = activeFileRef.current;
      if (!target || target.nodeType !== 'file') return;

      const currentModelUri = editorRef.current?.getModel()?.uri.toString();
      if (
        expectedModelPathRef.current &&
        currentModelUri &&
        currentModelUri !== expectedModelPathRef.current
      ) {
        return;
      }

      onChangeContent(target.id, nextValue);
    },
    [onChangeContent],
  );

  const pendingCloseNode = pendingCloseTabId
    ? files.find((f) => f.id === pendingCloseTabId)
    : null;

  const isLockedByMe = Boolean(
    activeFile?.lockedById && activeFile.lockedById === currentUserId,
  );
  const isLockedByOther = Boolean(
    activeFile?.lockedById && activeFile.lockedById !== currentUserId,
  );

  const readOnlyReason = useMemo(() => {
    if (!activeFile || canEditActiveFile) return null;
    if (isLockedByOther) {
      return `Checked out exclusively by @${activeFile.lockedByUsername ?? 'another collaborator'}.`;
    }
    if (branch?.isProtected && project.currentUserRole !== 'owner') {
      return `Branch "${branch.name}" is protected by the workspace owner.`;
    }
    if (project.currentUserRole === 'viewer' || !project.currentUserRole) {
      return 'You have viewer access in this workspace.';
    }
    return 'Read-only permission override applied on this file or parent folder.';
  }, [
    activeFile,
    canEditActiveFile,
    isLockedByOther,
    branch?.isProtected,
    branch?.name,
    project.currentUserRole,
  ]);

  return (
    <section
      aria-label="Code Editor Workspace"
      className="glass-surface flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl"
    >
      {/* 1. Open File Tabs Strip */}
      <div className="flex min-h-[40px] items-center gap-1 overflow-x-auto border-b border-border/60 bg-black/[0.02] px-2 py-1 dark:bg-white/[0.02]">
        {openTabs.length === 0 ? (
          <span className="px-2 font-mono text-[11px] text-muted-foreground">
            No files open
          </span>
        ) : (
          openTabs.map((tab) => {
            const isTabActive = tab.id === activeFile?.id;
            const isTabDirty = Boolean(buffers[tab.id]?.isDirty);
            const isTabLockedOther = Boolean(
              tab.lockedById && tab.lockedById !== currentUserId,
            );
            const isTabLockedMine = tab.lockedById === currentUserId;

            return (
              <div
                key={tab.id}
                className={cn(
                  'group inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 font-mono text-[11.5px] transition-colors',
                  isTabActive
                    ? 'border-primary/45 bg-[hsl(var(--editor))] text-foreground shadow-sm'
                    : 'border-transparent text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className="inline-flex items-center gap-1.5 focus-visible:outline-none"
                >
                  <span className="rounded bg-foreground/[0.07] px-1 py-0.5 text-[8.5px] font-semibold text-muted-foreground dark:bg-white/[0.08]">
                    {resolveFileExtensionTag(tab.name)}
                  </span>
                  <span className="max-w-[140px] truncate">{tab.name}</span>
                </button>

                {isTabLockedMine && (
                  <Lock
                    className="h-2.5 w-2.5 text-primary"
                    aria-label="Locked by you"
                  />
                )}
                {isTabLockedOther && (
                  <Lock
                    className="h-2.5 w-2.5 text-amber-500"
                    aria-label={`Locked by @${tab.lockedByUsername ?? 'user'}`}
                  />
                )}
                {isTabDirty && (
                  <span
                    title="Unsaved draft"
                    className="h-2 w-2 rounded-full bg-primary"
                  />
                )}

                <button
                  type="button"
                  onClick={() => handleRequestCloseTab(tab.id)}
                  aria-label={`Close ${tab.name}`}
                  className="ml-0.5 rounded p-0.5 text-muted-foreground/70 opacity-70 hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Inline Unsaved Tab Close Confirmation Prompt */}
      {pendingCloseNode && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/35 bg-primary/10 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-foreground">
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>
              Save unsaved changes to{' '}
              <span className="font-mono font-semibold">
                {pendingCloseNode.name}
              </span>{' '}
              before closing?
            </span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            {pendingCloseNode.effectivePermission === 'edit' && (
              <button
                type="button"
                disabled={closingAfterSave || isSaving}
                onClick={() => void handleConfirmSaveAndClose()}
                className="btn-studio-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold"
              >
                {closingAfterSave && (
                  <Loader2
                    className="h-3 w-3 animate-spin"
                    aria-hidden="true"
                  />
                )}
                <span>Save & Close</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const targetId = pendingCloseNode.id;
                setPendingCloseTabId(null);
                onCloseTab(targetId);
              }}
              className="rounded-lg bg-destructive px-2.5 py-1 font-semibold text-destructive-foreground hover:opacity-90"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={() => setPendingCloseTabId(null)}
              className="glass-control rounded-lg px-2.5 py-1 text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* 2. Breadcrumb + Version + Checkout Lock Bar */}
      {activeFile && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-1.5 font-mono text-[11px]">
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-muted-foreground">
            <GitBranch className="h-3 w-3 text-primary" aria-hidden="true" />
            <span>{branch?.name ?? 'main'}</span>
            {breadcrumbs.map((segment, index) => (
              <span
                key={segment.id}
                className="inline-flex items-center gap-1"
              >
                <ChevronRight className="h-3 w-3 opacity-60" aria-hidden="true" />
                <span
                  className={cn(
                    'truncate',
                    index === breadcrumbs.length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {segment.name}
                </span>
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2 text-[10.5px]">
            {activeDraft?.isDirty && canEditActiveFile && (
              <button
                type="button"
                onClick={() => onDiscardDraft(activeFile.id)}
                title="Revert unsaved edits back to last synced server version"
                className="glass-control inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                <span>Revert</span>
              </button>
            )}

            {isLockedByMe && (
              <span className="rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-primary">
                checked out by you
              </span>
            )}
            {isLockedByOther && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/[0.12] px-2 py-0.5 text-amber-600 dark:text-amber-300">
                locked by @{activeFile.lockedByUsername ?? 'user'}
              </span>
            )}

            <span className="glass-control rounded-md px-1.5 py-0.5 text-muted-foreground">
              v{activeDraft?.savedVersion ?? activeFile.version}
            </span>
          </div>
        </div>
      )}

      {/* 3. Read-Only / Lock Banner */}
      {readOnlyReason && (
        <div className="flex items-center gap-2 border-b border-border/50 bg-muted/45 px-3 py-1.5 text-[11px] text-muted-foreground">
          {isLockedByOther ? (
            <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          ) : (
            <Eye className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span>
            <strong className="font-medium text-foreground">Read-only mode:</strong>{' '}
            {readOnlyReason}
          </span>
        </div>
      )}

      {/* 4. Optimistic CAS 409 Conflict Banner */}
      {activeFile && activeConflict && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-destructive/35 bg-destructive/10 px-3 py-2 text-xs">
          <div className="flex items-start gap-2 text-destructive">
            <ShieldAlert
              className="mt-0.5 h-4 w-4 shrink-0"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Save conflict detected (server now at v
                {activeConflict.serverVersion})
              </p>
              <p className="text-[11px] opacity-90">{activeConflict.message}</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <button
              type="button"
              onClick={() =>
                onResolveConflictReload(activeFile.id, activeConflict)
              }
              className="glass-control inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-medium text-foreground"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              <span>Reload v{activeConflict.serverVersion}</span>
            </button>
            <button
              type="button"
              disabled={isSaving || !canEditActiveFile}
              onClick={() =>
                onResolveConflictOverwrite(
                  activeFile.id,
                  activeConflict.serverVersion,
                )
              }
              className="btn-studio-primary inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold disabled:opacity-50"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              <span>Overwrite With My Edits</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. Non-Conflict Save Error Banner */}
      {saveError && !activeConflict && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/35 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={onDismissSaveError}
            aria-label="Dismiss save error"
            className="hover:opacity-80"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 6. Main Monaco Canvas or Empty / Error State */}
      <div className="relative min-h-0 flex-1 bg-[hsl(var(--editor))]">
        {!activeFile ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <div className="glass-control flex h-12 w-12 items-center justify-center rounded-2xl text-primary">
              <FileCode2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-base font-semibold tracking-tight text-foreground">
              Select a file to begin editing
            </h2>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              Open any file from the left Explorer tree or create a new module
              in{' '}
              <span className="font-mono text-foreground">
                {branch?.name ?? 'main'}
              </span>
              . Press{' '}
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                Ctrl/Cmd + S
              </kbd>{' '}
              to persist versioned snapshots to PostgreSQL.
            </p>
          </div>
        ) : fileLoadError && !activeDraft ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <AlertTriangle
              className="h-8 w-8 text-destructive"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-semibold text-foreground">
              Unable to load {activeFile.name}
            </p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {fileLoadError}
            </p>
            <button
              type="button"
              onClick={onRetryFileLoad}
              className="btn-studio-primary mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <>
            {renderedTarget && expectedModelPath && (
              <Editor
                height="100%"
                width="100%"
                path={expectedModelPath}
                language={monacoLanguage}
                value={renderedTarget.draft.content}
                theme={theme === 'dark' ? STUDIO_DARK_THEME : STUDIO_LIGHT_THEME}
                keepCurrentModel={true}
                saveViewState={true}
                beforeMount={handleBeforeMount}
                onMount={handleMount}
                onChange={handleEditorChange}
                loading={
                  <div className="flex h-full w-full items-center justify-center gap-2 font-mono text-xs text-muted-foreground">
                    <Loader2
                      className="h-4 w-4 animate-spin text-primary"
                      aria-hidden="true"
                    />
                    <span>Initializing Monaco Engine…</span>
                  </div>
                }
                options={{
                  readOnly: !renderedTarget.canEdit || isWaitingForNewBuffer,
                  domReadOnly: !renderedTarget.canEdit || isWaitingForNewBuffer,
                  minimap: { enabled: true },
                  fontSize: 13.5,
                  fontFamily:
                    '"Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontLigatures: true,
                  tabSize: 2,
                  insertSpaces: true,
                  smoothScrolling: true,
                  cursorSmoothCaretAnimation: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  renderLineHighlight: 'all',
                  padding: { top: 14, bottom: 14 },
                }}
              />
            )}

            {(isWaitingForNewBuffer || isFileLoading) && !activeDraft && (
              <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-[hsl(var(--editor))]/85 backdrop-blur-[2px] font-mono text-xs text-muted-foreground">
                <Loader2
                  className="h-4 w-4 animate-spin text-primary"
                  aria-hidden="true"
                />
                <span>Loading {activeFile.name}…</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* 7. Bottom IDE Telemetry Status Footer */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-[hsl(var(--editor-bar))] px-3 py-1.5 font-mono text-[10.5px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {activeFile && activeDraft ? (
            <>
              <span>
                Ln {activeDraft.cursorLine}, Col {activeDraft.cursorColumn}
              </span>
              <span className="hidden sm:inline">Spaces: 2</span>
              <span className="hidden sm:inline">UTF-8</span>
              <span className="inline-flex items-center gap-1 text-foreground">
                <Code2 className="h-3 w-3 text-primary" aria-hidden="true" />
                {monacoLanguage}
              </span>
            </>
          ) : (
            <span>Ready</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {activeFile && activeDraft && (
            <>
              <span>v{activeDraft.savedVersion}</span>
              <span
                className={cn(
                  activeDraft.isDirty ? 'font-medium text-primary' : '',
                )}
              >
                {isSaving
                  ? 'Saving…'
                  : activeDraft.isDirty
                    ? 'Unsaved draft'
                    : 'Saved'}
              </span>
            </>
          )}
        </div>
      </footer>
    </section>
  );
}