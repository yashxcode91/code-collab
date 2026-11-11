import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  FileCode2,
  Folder,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  Project,
  ProjectFileNodeDto,
  ProjectRole,
  SupportedLanguage,
} from '@codecollab/shared';
import {
  fetchBranchFiles,
  fetchProjectDetail,
  queryKeys,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

const LANGUAGE_BADGES: Record<Project['language'], string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'PY',
  cpp: 'C++',
  java: 'JAVA',
};

const LANGUAGE_NAMES: Record<Project['language'], string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  cpp: 'C++',
  java: 'Java',
};

export const STARTER_ENTRY_FILES: Record<SupportedLanguage, string> = {
  typescript: 'index.ts',
  javascript: 'index.js',
  python: 'main.py',
  cpp: 'main.cpp',
  java: 'Main.java',
};

interface CompactTreeRow {
  id: string;
  name: string;
  nodeType: 'file' | 'folder';
  depth: number;
  locked?: boolean;
}

function buildCompactTreeRows(
  files: ProjectFileNodeDto[],
): CompactTreeRow[] {
  const byParent = new Map<string | null, ProjectFileNodeDto[]>();
  for (const node of files) {
    const parent = node.parentId ?? null;
    const list = byParent.get(parent) ?? [];
    list.push(node);
    byParent.set(parent, list);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => {
      if (a.nodeType !== b.nodeType) {
        return a.nodeType === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  const ordered: CompactTreeRow[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const node of children) {
      ordered.push({
        id: node.id,
        name: node.name,
        nodeType: node.nodeType,
        depth: Math.min(depth, 2),
        locked: Boolean(node.lockedById),
      });
      if (node.nodeType === 'folder' && depth < 2) {
        visit(node.id, depth + 1);
      }
    }
  };

  visit(null, 0);
  return ordered;
}

function formatRelativeTime(isoDate: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000),
  );
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

/**
 * Keeps role styling monochrome + Solar Tangerine (`owner` = warm primary highlight,
 * `editor` = neutral crystal pearl pill, `viewer` = muted crystal pill — avoiding generic green).
 */
function RolePill({ role }: { role: ProjectRole | null | undefined }) {
  const resolvedRole = role ?? 'viewer';
  if (resolvedRole === 'owner') {
    return (
      <span className="rounded-full border border-primary/35 bg-primary/15 px-2.5 py-0.5 font-mono text-[10px] font-medium text-primary">
        owner
      </span>
    );
  }
  if (resolvedRole === 'editor') {
    return (
      <span className="glass-control rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-foreground">
        editor
      </span>
    );
  }
  return (
    <span className="glass-control rounded-full px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      viewer
    </span>
  );
}

interface WorkspaceCardProps {
  project: Project;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  isDeleting?: boolean;
  /** Marks center Orbital focus; lazily hydrates live PostgreSQL branch files without N+1 bursts. */
  isActive?: boolean;
  className?: string;
}

/**
 * Interactive Frosted Studio Glass card representing a repository workspace and its live
 * file tree inside the Straight Orbital workspace deck. Renders as a native `<article>` so
 * parent GSAP Orbital transforms never conflict with nested layout transforms.
 */
export const WorkspaceCard = React.forwardRef<HTMLElement, WorkspaceCardProps>(
  function WorkspaceCard(
    {
      project,
      onOpen,
      onDelete,
      isDeleting = false,
      isActive = true,
      className,
    },
    ref,
  ) {
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const isOwner = project.currentUserRole === 'owner';

    useEffect(() => {
      if (!isActive) {
        setConfirmingDelete(false);
      }
    }, [isActive]);

    // Lazily query branch metadata & files only when focused (React Query caches for revisits)
    const detailQuery = useQuery({
      queryKey: queryKeys.projects.detail(project.id),
      queryFn: () => fetchProjectDetail(project.id),
      enabled: isActive,
      staleTime: 60_000,
    });

    const defaultBranch = useMemo(() => {
      const branches = detailQuery.data?.branches ?? [];
      return branches.find((b) => b.isDefault) ?? branches[0] ?? null;
    }, [detailQuery.data?.branches]);

    const filesQuery = useQuery({
      queryKey: queryKeys.projects.files(
        project.id,
        defaultBranch?.id ?? 'default',
      ),
      queryFn: () => fetchBranchFiles(project.id, defaultBranch!.id),
      enabled: isActive && Boolean(defaultBranch?.id),
      staleTime: 60_000,
    });

    const fallbackRows = useMemo<CompactTreeRow[]>(
      () => [
        { id: 'readme', name: 'README.md', nodeType: 'file', depth: 0 },
        { id: 'src', name: 'src', nodeType: 'folder', depth: 0 },
        {
          id: 'entry',
          name: STARTER_ENTRY_FILES[project.language],
          nodeType: 'file',
          depth: 1,
        },
      ],
      [project.language],
    );

    const liveRows = useMemo(() => {
      if (!filesQuery.data) return null;
      return buildCompactTreeRows(filesQuery.data);
    }, [filesQuery.data]);

    const displayedRows = liveRows ?? fallbackRows;
    const totalNodeCount = liveRows ? liveRows.length : displayedRows.length;
    const visibleRows = displayedRows.slice(0, 3);
    const hiddenCount = Math.max(0, totalNodeCount - visibleRows.length);

    return (
      <article
        ref={ref}
        className={cn(
          'glass-surface group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-3xl p-5 transition-colors duration-200',
          isActive
            ? 'border-primary/40 shadow-[0_18px_42px_-18px_rgba(var(--studio-rgb),0.26)]'
            : 'hover:border-primary/35',
          className,
        )}
      >
        {/* Top optical hairline gleam on focused/hovered card */}
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/55 to-transparent transition-opacity duration-200',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        />

        <div className="min-w-0">
          {/* Top Metadata Badges Row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'glass-control inline-flex h-7 items-center rounded-lg px-2 font-mono text-[11px] font-semibold transition-colors',
                  isActive
                    ? 'text-primary'
                    : 'text-foreground group-hover:text-primary',
                )}
              >
                {LANGUAGE_BADGES[project.language]}
              </span>
              <span className="glass-control inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-mono text-[10px] text-muted-foreground">
                {project.isPublic ? (
                  <Globe className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Lock className="h-3 w-3" aria-hidden="true" />
                )}
                <span>{project.isPublic ? 'Public' : 'Private'}</span>
              </span>
            </div>

            <RolePill role={project.currentUserRole} />
          </div>

          {/* Clickable Workspace Body (`Open Studio`) */}
          <button
            type="button"
            onClick={() => onOpen(project.id)}
            className="mt-3 block w-full text-left focus-visible:outline-none"
          >
            <h3
              className={cn(
                'truncate text-base font-semibold tracking-tight transition-colors',
                isActive
                  ? 'text-foreground group-hover:text-primary'
                  : 'text-foreground',
              )}
            >
              {project.name}
            </h3>
            <p className="mt-1 line-clamp-2 min-h-[2.1rem] text-xs leading-relaxed text-muted-foreground">
              {project.description?.trim() ||
                `${LANGUAGE_NAMES[project.language]} workspace ready for multi-cursor CRDT editing.`}
            </p>
          </button>

          {/* Compact File Structure Explorer Strip */}
          <button
            type="button"
            onClick={() => onOpen(project.id)}
            className="glass-control mt-3 block h-[106px] w-full overflow-hidden rounded-2xl px-3 py-2 text-left transition-colors hover:border-primary/40 focus-visible:outline-none"
          >
            <div className="flex items-center justify-between border-b border-border/50 pb-1.5 font-mono text-[10px] text-muted-foreground">
              <span className="inline-flex min-w-0 items-center gap-1">
                <GitBranch className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {defaultBranch?.name ?? 'main'}
                </span>
              </span>
              <span className="shrink-0">
                {filesQuery.isFetching && !filesQuery.data
                  ? 'loading…'
                  : liveRows
                    ? `${totalNodeCount} ${totalNodeCount === 1 ? 'node' : 'nodes'}`
                    : 'tree'}
              </span>
            </div>

            {filesQuery.isSuccess && liveRows && liveRows.length === 0 ? (
              <p className="mt-3 font-mono text-[10px] text-muted-foreground">
                Empty branch · open Studio to add files
              </p>
            ) : (
              <div className="mt-1.5 space-y-1 font-mono text-[10.5px]">
                {visibleRows.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 text-foreground/90"
                    style={{ paddingLeft: `${row.depth * 12}px` }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {row.nodeType === 'folder' ? (
                        <Folder
                          className="h-3 w-3 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                      ) : (
                        <FileCode2
                          className="h-3 w-3 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <span className="truncate">
                        {row.nodeType === 'folder' ? `${row.name}/` : row.name}
                      </span>
                    </span>
                    {row.locked ? (
                      <Lock
                        className="h-2.5 w-2.5 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    ) : row.id === visibleRows[visibleRows.length - 1]?.id &&
                      hiddenCount > 0 ? (
                      <span className="shrink-0 text-[9.5px] text-muted-foreground">
                        +{hiddenCount} more
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </button>
        </div>

        {/* Footer Telemetry + Owner Delete Guard + Open Studio CTA */}
        <div className="mt-3.5 space-y-2.5 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <GitBranch className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              {project.branchCount ?? 1}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              {project.memberCount ?? 1}/{project.maxConcurrentEditors}
            </span>
            <span className="ml-auto text-[10px]">
              {formatRelativeTime(project.updatedAt)}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            {isOwner ? (
              confirmingDelete ? (
                <div className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="text-destructive">Delete?</span>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => onDelete(project.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-destructive px-2 py-1 font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {isDeleting && (
                      <Loader2
                        className="h-2.5 w-2.5 animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    Yes
                  </button>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={() => setConfirmingDelete(false)}
                    className="glass-control rounded-lg px-2 py-1 text-muted-foreground hover:text-foreground"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  aria-label={`Delete workspace ${project.name}`}
                  className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:border-destructive/50 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground">
                Shared room
              </span>
            )}

            <button
              type="button"
              onClick={() => onOpen(project.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all',
                isActive
                  ? 'btn-studio-primary font-semibold'
                  : 'glass-control text-foreground group-hover:border-primary/50 group-hover:bg-primary group-hover:text-primary-foreground',
              )}
            >
              <span>Open Studio</span>
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </article>
    );
  },
);
