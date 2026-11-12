import { create } from 'zustand';
import type { ProjectFileDetailDto } from '@codecollab/shared';

export type InspectorTab = 'closed' | 'members' | 'access' | 'settings';

export interface FileDraftBuffer {
  fileId: string;
  content: string;
  lastSyncedContent: string;
  savedVersion: number;
  isDirty: boolean;
  cursorLine: number;
  cursorColumn: number;
}

export interface FileVersionConflict {
  fileId: string;
  message: string;
  serverVersion: number;
  serverContent: string;
  serverUpdatedAt: string;
}

interface StudioState {
  projectId: string | null;
  activeBranchId: string | null;
  openTabIds: string[];
  activeFileId: string | null;
  aclTargetNodeId: string | null;
  expandedFolderIds: Record<string, boolean>;
  buffers: Record<string, FileDraftBuffer>;
  conflicts: Record<string, FileVersionConflict>;
  rightPanelTab: InspectorTab;
  explorerCollapsed: boolean;
  isWindowExpanded: boolean;
  focusModeEnabled: boolean;

  initProjectSession: (projectId: string, defaultBranchId: string | null) => void;
  selectBranch: (branchId: string) => void;
  openFileTab: (fileId: string) => void;
  closeFileTab: (fileId: string) => void;
  setActiveFileId: (fileId: string | null) => void;
  setAclTargetNodeId: (nodeId: string | null) => void;
  toggleFolder: (folderId: string) => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  hydrateFileBuffer: (
    file: ProjectFileDetailDto,
    options?: { forceOverwrite?: boolean },
  ) => void;
  updateDraftContent: (fileId: string, content: string) => void;
  syncCollabBuffer: (
    fileId: string,
    content: string,
    savedVersion?: number,
  ) => void;
  markFileSaved: (file: ProjectFileDetailDto) => void;
  discardFileDraft: (fileId: string) => void;
  setCursorPosition: (fileId: string, line: number, column: number) => void;
  setFileConflict: (
    fileId: string,
    conflict: FileVersionConflict | null,
  ) => void;
  removeDeletedNode: (deletedIds: string[]) => void;
  setRightPanelTab: (tab: InspectorTab) => void;
  toggleExplorer: () => void;
  toggleWindowExpanded: () => void;
  toggleFocusMode: () => void;
  resetMergedBranchBuffers: (preserveFileId?: string | null) => void;
  resetStudio: () => void;
}

const INITIAL_STATE = {
  projectId: null as string | null,
  activeBranchId: null as string | null,
  openTabIds: [] as string[],
  activeFileId: null as string | null,
  aclTargetNodeId: null as string | null,
  expandedFolderIds: {} as Record<string, boolean>,
  buffers: {} as Record<string, FileDraftBuffer>,
  conflicts: {} as Record<string, FileVersionConflict>,
  rightPanelTab: 'closed' as InspectorTab,
  explorerCollapsed: false,
  isWindowExpanded: false,
  focusModeEnabled: false,
};

/**
 * Ephemeral local IDE session state powered by Zustand.
 * Server state (project metadata, branches, file tree, permissions, file fetches)
 * intentionally stays in TanStack React Query (`queries.ts`) so there is zero cache duplication.
 */
export const useStudioStore = create<StudioState>((set) => ({
  ...INITIAL_STATE,

  initProjectSession: (projectId, defaultBranchId) =>
    set((state) => {
      if (state.projectId === projectId) {
        if (!state.activeBranchId && defaultBranchId) {
          return { activeBranchId: defaultBranchId };
        }
        return state;
      }
      return {
        ...INITIAL_STATE,
        projectId,
        activeBranchId: defaultBranchId,
      };
    }),

  selectBranch: (branchId) =>
    set((state) => {
      if (state.activeBranchId === branchId) return state;
      return {
        activeBranchId: branchId,
        openTabIds: [],
        activeFileId: null,
        aclTargetNodeId: null,
        expandedFolderIds: {},
        buffers: {},
        conflicts: {},
      };
    }),

  openFileTab: (fileId) =>
    set((state) => {
      const exists = state.openTabIds.includes(fileId);
      return {
        openTabIds: exists ? state.openTabIds : [...state.openTabIds, fileId],
        activeFileId: fileId,
      };
    }),

  closeFileTab: (fileId) =>
    set((state) => {
      const idx = state.openTabIds.indexOf(fileId);
      if (idx === -1) return state;

      const nextTabs = state.openTabIds.filter((id) => id !== fileId);
      let nextActive = state.activeFileId;
      if (state.activeFileId === fileId) {
        nextActive = nextTabs[idx] ?? nextTabs[idx - 1] ?? null;
      }

      const nextBuffers = { ...state.buffers };
      delete nextBuffers[fileId];

      const nextConflicts = { ...state.conflicts };
      delete nextConflicts[fileId];

      return {
        openTabIds: nextTabs,
        activeFileId: nextActive,
        buffers: nextBuffers,
        conflicts: nextConflicts,
      };
    }),

  setActiveFileId: (fileId) => set({ activeFileId: fileId }),

  setAclTargetNodeId: (nodeId) => set({ aclTargetNodeId: nodeId }),

  toggleFolder: (folderId) =>
    set((state) => ({
      expandedFolderIds: {
        ...state.expandedFolderIds,
        [folderId]: !(state.expandedFolderIds[folderId] ?? true),
      },
    })),

  setFolderExpanded: (folderId, expanded) =>
    set((state) => ({
      expandedFolderIds: {
        ...state.expandedFolderIds,
        [folderId]: expanded,
      },
    })),

  hydrateFileBuffer: (file, options) =>
    set((state) => {
      const existing = state.buffers[file.id];
      const force = Boolean(options?.forceOverwrite);

      // Preserve unsaved user edits during background query refetches unless reloading explicitly
      if (existing && existing.isDirty && !force) {
        return state;
      }

      return {
        buffers: {
          ...state.buffers,
          [file.id]: {
            fileId: file.id,
            content: file.content,
            lastSyncedContent: file.content,
            savedVersion: file.version,
            isDirty: false,
            cursorLine: existing?.cursorLine ?? 1,
            cursorColumn: existing?.cursorColumn ?? 1,
          },
        },
        ...(force
          ? {
              conflicts: (() => {
                const next = { ...state.conflicts };
                delete next[file.id];
                return next;
              })(),
            }
          : {}),
      };
    }),

  updateDraftContent: (fileId, content) =>
    set((state) => {
      const existing = state.buffers[fileId];
      if (!existing) return state;
      return {
        buffers: {
          ...state.buffers,
          [fileId]: {
            ...existing,
            content,
            isDirty: content !== existing.lastSyncedContent,
          },
        },
      };
    }),

  syncCollabBuffer: (fileId, content, savedVersion) =>
    set((state) => {
      const existing = state.buffers[fileId];
      return {
        buffers: {
          ...state.buffers,
          [fileId]: {
            fileId,
            content,
            lastSyncedContent: content,
            savedVersion: savedVersion ?? existing?.savedVersion ?? 1,
            isDirty: false,
            cursorLine: existing?.cursorLine ?? 1,
            cursorColumn: existing?.cursorColumn ?? 1,
          },
        },
      };
    }),

  markFileSaved: (file) =>
    set((state) => {
      const existing = state.buffers[file.id];
      const synced = file.content;
      const nextConflicts = { ...state.conflicts };
      delete nextConflicts[file.id];

      return {
        buffers: {
          ...state.buffers,
          [file.id]: {
            fileId: file.id,
            content: synced,
            lastSyncedContent: synced,
            savedVersion: file.version,
            isDirty: false,
            cursorLine: existing?.cursorLine ?? 1,
            cursorColumn: existing?.cursorColumn ?? 1,
          },
        },
        conflicts: nextConflicts,
      };
    }),

  discardFileDraft: (fileId) =>
    set((state) => {
      const existing = state.buffers[fileId];
      if (!existing) return state;
      const nextConflicts = { ...state.conflicts };
      delete nextConflicts[fileId];
      return {
        buffers: {
          ...state.buffers,
          [fileId]: {
            ...existing,
            content: existing.lastSyncedContent,
            isDirty: false,
          },
        },
        conflicts: nextConflicts,
      };
    }),

  setCursorPosition: (fileId, line, column) =>
    set((state) => {
      const existing = state.buffers[fileId];
      if (!existing) return state;
      if (existing.cursorLine === line && existing.cursorColumn === column) {
        return state;
      }
      return {
        buffers: {
          ...state.buffers,
          [fileId]: {
            ...existing,
            cursorLine: line,
            cursorColumn: column,
          },
        },
      };
    }),

  setFileConflict: (fileId, conflict) =>
    set((state) => {
      const next = { ...state.conflicts };
      if (conflict) {
        next[fileId] = conflict;
      } else {
        delete next[fileId];
      }
      return { conflicts: next };
    }),

  removeDeletedNode: (deletedIds) =>
    set((state) => {
      if (deletedIds.length === 0) return state;
      const deletedSet = new Set(deletedIds);
      const nextTabs = state.openTabIds.filter((id) => !deletedSet.has(id));
      const nextActive =
        state.activeFileId && deletedSet.has(state.activeFileId)
          ? (nextTabs[0] ?? null)
          : state.activeFileId;

      const nextBuffers = { ...state.buffers };
      const nextConflicts = { ...state.conflicts };
      for (const id of deletedIds) {
        delete nextBuffers[id];
        delete nextConflicts[id];
      }

      return {
        openTabIds: nextTabs,
        activeFileId: nextActive,
        aclTargetNodeId:
          state.aclTargetNodeId && deletedSet.has(state.aclTargetNodeId)
            ? null
            : state.aclTargetNodeId,
        buffers: nextBuffers,
        conflicts: nextConflicts,
      };
    }),

  setRightPanelTab: (rightPanelTab) => set({ rightPanelTab }),

  toggleExplorer: () =>
    set((state) => ({ explorerCollapsed: !state.explorerCollapsed })),

  toggleWindowExpanded: () =>
    set((state) => ({ isWindowExpanded: !state.isWindowExpanded })),

  toggleFocusMode: () =>
    set((state) => ({ focusModeEnabled: !state.focusModeEnabled })),

  resetMergedBranchBuffers: (preserveFileId) =>
    set((state) => {
      if (!preserveFileId) {
        return { buffers: {}, conflicts: {} };
      }
      const nextBuffers: Record<string, FileDraftBuffer> = {};
      if (state.buffers[preserveFileId]) {
        nextBuffers[preserveFileId] = state.buffers[preserveFileId];
      }
      const nextConflicts: Record<string, FileVersionConflict> = {};
      if (state.conflicts[preserveFileId]) {
        nextConflicts[preserveFileId] = state.conflicts[preserveFileId];
      }
      return { buffers: nextBuffers, conflicts: nextConflicts };
    }),

  resetStudio: () => set({ ...INITIAL_STATE }),
}));
