import type { ProjectFileNodeDto, SupportedLanguage } from '@codecollab/shared';

export interface FileTreeBranch {
  node: ProjectFileNodeDto;
  children: FileTreeBranch[];
  depth: number;
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  py: 'python',
  pyw: 'python',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  h: 'cpp',
  c: 'c',
  java: 'java',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  xml: 'xml',
  txt: 'plaintext',
};

const WORKSPACE_FALLBACK_LANGUAGE: Record<SupportedLanguage, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  cpp: 'cpp',
  java: 'java',
};

/** Maps a file name's extension cleanly to one of the 5 supported sandbox runner languages. */
export function inferExecutionLanguage(
  filename: string | undefined,
  workspaceLanguage: SupportedLanguage,
): SupportedLanguage {
  if (!filename) return workspaceLanguage;
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx !== -1 && dotIdx < filename.length - 1) {
    const ext = filename.slice(dotIdx + 1).toLowerCase();
    if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'jsx') {
      return 'javascript';
    }
    if (ext === 'ts' || ext === 'mts' || ext === 'cts' || ext === 'tsx') {
      return 'typescript';
    }
    if (ext === 'py' || ext === 'pyw') {
      return 'python';
    }
    if (
      ext === 'cpp' ||
      ext === 'cc' ||
      ext === 'cxx' ||
      ext === 'hpp' ||
      ext === 'hh' ||
      ext === 'h' ||
      ext === 'c'
    ) {
      return 'cpp';
    }
    if (ext === 'java') {
      return 'java';
    }
  }
  return workspaceLanguage;
}

/** Maps a file name's extension cleanly to a Monaco syntax highlighting language ID. */
export function resolveMonacoLanguage(
  filename: string | undefined,
  workspaceLanguage: SupportedLanguage,
): string {
  if (!filename) {
    return WORKSPACE_FALLBACK_LANGUAGE[workspaceLanguage] ?? 'plaintext';
  }
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx !== -1 && dotIdx < filename.length - 1) {
    const ext = filename.slice(dotIdx + 1).toLowerCase();
    if (EXTENSION_LANGUAGE_MAP[ext]) {
      return EXTENSION_LANGUAGE_MAP[ext];
    }
  }
  return WORKSPACE_FALLBACK_LANGUAGE[workspaceLanguage] ?? 'plaintext';
}

/** Short 2–4 char explorer chip derived from file extension. */
export function resolveFileExtensionTag(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1 || dotIdx === filename.length - 1) {
    return 'TXT';
  }
  return filename.slice(dotIdx + 1).toUpperCase().slice(0, 4);
}

/**
 * Converts flat branch `ProjectFileNodeDto[]` rows into a deterministic nested tree
 * (folders sorted first alphabetically, followed by files alphabetically).
 */
export function buildFileTree(nodes: ProjectFileNodeDto[]): FileTreeBranch[] {
  const byParent = new Map<string | null, ProjectFileNodeDto[]>();
  for (const node of nodes) {
    const parent = node.parentId ?? null;
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }

  for (const bucket of byParent.values()) {
    bucket.sort((a, b) => {
      if (a.nodeType !== b.nodeType) {
        return a.nodeType === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const walk = (parentId: string | null, depth: number): FileTreeBranch[] => {
    const children = byParent.get(parentId) ?? [];
    return children.map((node) => ({
      node,
      depth,
      children: node.nodeType === 'folder' ? walk(node.id, depth + 1) : [],
    }));
  };

  return walk(null, 0);
}

/** Builds ordered breadcrumb segments from branch root down to `targetNodeId`. */
export function buildNodeBreadcrumb(
  nodes: ProjectFileNodeDto[],
  targetNodeId: string | null,
): ProjectFileNodeDto[] {
  if (!targetNodeId) return [];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chain: ProjectFileNodeDto[] = [];
  let current: ProjectFileNodeDto | undefined = byId.get(targetNodeId);
  let guard = 0;

  while (current && guard < 64) {
    chain.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
    guard += 1;
  }

  return chain;
}

/** Collects `rootId` and all nested descendant node IDs so deleting a folder cleans up tabs, buffers, and models. */
export function collectSubtreeIds(
  nodes: ProjectFileNodeDto[],
  rootId: string,
): string[] {
  const byParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = byParent.get(node.parentId) ?? [];
    list.push(node.id);
    byParent.set(node.parentId, list);
  }

  const collected: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    collected.push(id);
    const children = byParent.get(id);
    if (children) queue.push(...children);
  }
  return collected;
}

/** Picks an ergonomic default file when opening a branch (`src/*` entry file or `README.md` or first file). */
export function pickDefaultEntryFile(
  nodes: ProjectFileNodeDto[],
  language: SupportedLanguage,
): ProjectFileNodeDto | null {
  const files = nodes.filter((node) => node.nodeType === 'file');
  if (files.length === 0) return null;

  const preferredEntryNames: Record<SupportedLanguage, string> = {
    typescript: 'index.ts',
    javascript: 'index.js',
    python: 'main.py',
    cpp: 'main.cpp',
    java: 'Main.java',
  };

  const entryMatch = files.find(
    (node) => node.name === preferredEntryNames[language],
  );
  if (entryMatch) return entryMatch;

  const nonReadme = files.find(
    (node) => node.name.toLowerCase() !== 'readme.md',
  );
  return nonReadme ?? files[0] ?? null;
}
