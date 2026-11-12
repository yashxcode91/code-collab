import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Braces,
  Cpu,
  FolderGit2,
  GitBranch,
  Layers,
  Plus,
  Search,
  Sparkles,
  Swords,
  TerminalSquare,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type {
  Project,
  ProjectDetailResponse,
  SupportedLanguage,
} from '@codecollab/shared';
import { CreateWorkspaceModal } from '@/components/studio-ui/CreateWorkspaceModal';
import {
  GlassySidebar,
  type TemplatePreset,
} from '@/components/studio-ui/GlassySidebar';
import {
  GooeyNavbar,
  type NavSectionId,
} from '@/components/studio-ui/GooeyNavbar';
import { PixelRippleBackground } from '@/components/studio-ui/PixelRippleBackground';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import {
  STARTER_ENTRY_FILES,
  WorkspaceCard,
} from '@/components/studio-ui/WorkspaceCard';
import {
  GithubGraph,
  normalizeGithubAccount,
  type GithubContribution,
  type GithubGraphSummary,
} from '@/components/unlumen-ui/github-graph';
import {
  HoverFeatureCards,
  type HoverFeatureCard,
} from '@/components/unlumen-ui/hover-feature-cards';
import { OrbitalImageWheel } from '@/components/unlumen-ui/orbital-image-wheel';
import { OAUTH_PROVIDER_STORAGE_KEY, useAuth } from '@/context/AuthContext';
import {
  deleteProject,
  fetchHealth,
  fetchProjects,
  queryKeys,
} from '@/lib/queries';

type LanguageFilter = 'all' | SupportedLanguage;

const LANGUAGE_FILTERS: Array<{ id: LanguageFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'typescript', label: 'TS' },
  { id: 'javascript', label: 'JS' },
  { id: 'python', label: 'PY' },
  { id: 'cpp', label: 'C++' },
  { id: 'java', label: 'JAVA' },
];

const SHORT_LANG_LABELS: Record<SupportedLanguage, string> = {
  typescript: 'TS',
  javascript: 'JS',
  python: 'PY',
  cpp: 'C++',
  java: 'JAVA',
};

function formatShortRelativeTime(isoDate: string): string {
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

function formatUtcMonthDay(isoDate: string | null): string {
  if (!isoDate) return 'no bursts yet';
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return 'no bursts yet';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/**
 * Generates deterministic trailing 140-day studio activity data so the Solar Tangerine
 * `<GithubGraph />` renders immediately on first load without depending on external APIs,
 * weighted lightly by how many workspaces and updates exist in PostgreSQL.
 */
function buildStudioActivitySeed(projects: Project[]): GithubContribution[] {
  const days = 140;
  const today = new Date();
  const countsByDay = new Map<string, number>();

  for (const project of projects) {
    const updatedKey = project.updatedAt.slice(0, 10);
    const createdKey = project.createdAt.slice(0, 10);
    countsByDay.set(updatedKey, (countsByDay.get(updatedKey) ?? 0) + 3);
    countsByDay.set(createdKey, (countsByDay.get(createdKey) ?? 0) + 2);
  }

  const result: GithubContribution[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - offset);
    const key = d.toISOString().slice(0, 10);

    // Deterministic gentle studio rhythm combined with real project event spikes
    const hash = ((offset * 29 + d.getUTCDay() * 13) % 19) / 19;
    const baseline =
      hash > 0.78 ? 4 : hash > 0.56 ? 3 : hash > 0.36 ? 2 : hash > 0.22 ? 1 : 0;
    const count = baseline + (countsByDay.get(key) ?? 0);
    const level =
      count === 0 ? 0 : count >= 6 ? 4 : count >= 4 ? 3 : count >= 2 ? 2 : 1;

    result.push({ date: key, count, level });
  }
  return result;
}

/** Minimal frosted code snippet frame embedded inside HoverFeatureCards template tiles. */
function MiniCodeFrame({
  filename,
  lines,
}: {
  filename: string;
  lines: string[];
}) {
  return (
    <div className="glass-control overflow-hidden rounded-xl p-2.5 font-mono text-[10px] leading-relaxed">
      <div className="mb-1.5 flex items-center justify-between border-b border-border/50 pb-1 text-[9px] text-muted-foreground">
        <span>{filename}</span>
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/30 transition-colors group-hover:bg-primary" />
      </div>
      <div className="space-y-0.5 text-muted-foreground">
        {lines.map((line, index) => (
          <div key={`${filename}-${index}`} className="truncate">
            <span className="mr-2 select-none text-muted-foreground/50">
              {index + 1}
            </span>
            <span
              className={
                index === 0
                  ? 'font-medium text-foreground transition-colors group-hover:text-primary'
                  : 'text-muted-foreground'
              }
            >
              {line}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * CodeCollab Dashboard Hub (`/`):
 * - Single top sticky `GooeyNavbar` (no bottom floating Dock obstructing scrolled forms)
 * - Hero Mirror Card with HiDPI `PixelRippleBackground` + monochrome `API OK` beacon + Studio Snapshot
 * - Searchable & language-filterable workspace repository grid backed by TanStack React Query
 * - Quick-launch starter templates (`HoverFeatureCards`) opening prefilled workspace creation modal
 * - Solar Tangerine `GithubGraph` cadence panel (with CSS sibling-backdrop isolation) + Telemetry card
 */
export function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<NavSectionId>('workspaces');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<TemplatePreset | null>(
    null,
  );
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<LanguageFilter>('all');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const [recentCreated, setRecentCreated] =
    useState<ProjectDetailResponse | null>(null);
  const [activeWorkspaceIndex, setActiveWorkspaceIndex] = useState(0);
  const [pendingFocusProjectId, setPendingFocusProjectId] = useState<
    string | null
  >(null);

  // GitHub cadence binding: auto-syncs for GitHub OAuth sign-ins while supporting manual overrides
  const [githubInput, setGithubInput] = useState('');
  const [customGithubAccount, setCustomGithubAccount] = useState<string | null>(
    null,
  );
  const [preferStudioSeed, setPreferStudioSeed] = useState(false);
  const [cadenceSummary, setCadenceSummary] =
    useState<GithubGraphSummary | null>(null);

  // Reset manual cadence overrides whenever the signed-in user switches
  useEffect(() => {
    setGithubInput('');
    setCustomGithubAccount(null);
    setPreferStudioSeed(false);
  }, [user?.id]);

  // Extract permanent numeric GitHub user ID when `avatarUrl` comes from GitHub OAuth
  const githubAvatarId = useMemo(() => {
    const match = user?.avatarUrl?.match(
      /^https?:\/\/avatars\.githubusercontent\.com\/u\/(\d+)/i,
    );
    return match?.[1] ?? null;
  }, [user?.avatarUrl]);

  const storedOAuthProvider =
    typeof window !== 'undefined' && user?.id
      ? (() => {
          try {
            return window.localStorage.getItem(OAUTH_PROVIDER_STORAGE_KEY);
          } catch {
            return null;
          }
        })()
      : null;

  const isGithubAuthUser = Boolean(
    githubAvatarId || storedOAuthProvider === 'github',
  );

  // Read cached GitHub login synchronously so repeat loads don't wait on external lookup
  const cachedGithubHandle = useMemo(() => {
    if (!githubAvatarId || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(
        `codecollab:gh-login:${githubAvatarId}`,
      );
      return raw ? normalizeGithubAccount(raw) : null;
    } catch {
      return null;
    }
  }, [githubAvatarId]);

  // Resolve exact GitHub `login` (preserves hyphens/casing rather than CodeCollab `_` username)
  const resolvedGithubQuery = useQuery({
    queryKey: ['github-login', user?.id ?? '', githubAvatarId ?? ''],
    enabled: Boolean(user && githubAvatarId && !cachedGithubHandle),
    staleTime: 1000 * 60 * 60,
    retry: 1,
    queryFn: async () => {
      const fallback = normalizeGithubAccount(user?.username ?? '') ?? null;
      try {
        const res = await fetch(
          `https://api.github.com/user/${githubAvatarId}`,
          {
            headers: { Accept: 'application/vnd.github+json' },
          },
        );
        if (!res.ok) return fallback;
        const profile = (await res.json()) as { login?: unknown };
        const exactLogin =
          typeof profile.login === 'string'
            ? normalizeGithubAccount(profile.login)
            : null;
        if (exactLogin) {
          try {
            window.sessionStorage.setItem(
              `codecollab:gh-login:${githubAvatarId}`,
              exactLogin,
            );
          } catch {
            // Ignore session storage errors
          }
          return exactLogin;
        }
      } catch {
        // Fall back cleanly to sanitized username if GitHub API is rate-limited/unreachable
      }
      return fallback;
    },
  });

  const autoGithubHandle = useMemo(() => {
    if (!isGithubAuthUser) return null;
    if (githubAvatarId) {
      return (
        cachedGithubHandle ??
        resolvedGithubQuery.data ??
        (resolvedGithubQuery.isPending
          ? null
          : normalizeGithubAccount(user?.username ?? ''))
      );
    }
    return normalizeGithubAccount(user?.username ?? '');
  }, [
    isGithubAuthUser,
    githubAvatarId,
    cachedGithubHandle,
    resolvedGithubQuery.data,
    resolvedGithubQuery.isPending,
    user?.username,
  ]);

  const isResolvingAutoGithub = Boolean(
    !preferStudioSeed &&
      !customGithubAccount &&
      githubAvatarId &&
      !cachedGithubHandle &&
      resolvedGithubQuery.isPending,
  );

  const liveGithubAccount =
    customGithubAccount ?? (preferStudioSeed ? null : autoGithubHandle);

  const workspacesRef = useRef<HTMLElement>(null);
  const templatesRef = useRef<HTMLElement>(null);
  const activityRef = useRef<HTMLElement>(null);

  // Primary data queries backed by `@tanstack/react-query`
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.all,
    queryFn: fetchProjects,
  });

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onMutate: (projectId) => {
      setDeletingProjectId(projectId);
    },
    onSettled: () => {
      setDeletingProjectId(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });

  const projects = projectsQuery.data ?? [];

  // Aggregate summary metrics for the Hero Snapshot tile
  const stats = useMemo(() => {
    let owned = 0;
    let totalMembers = 0;
    let totalBranches = 0;
    for (const p of projects) {
      if (p.currentUserRole === 'owner') owned += 1;
      totalMembers += p.memberCount ?? 1;
      totalBranches += p.branchCount ?? 1;
    }
    return {
      total: projects.length,
      owned,
      shared: Math.max(0, projects.length - owned),
      totalMembers,
      totalBranches,
    };
  }, [projects]);

  // Language distribution, guardrails, and 3 most recently updated rooms for Stack Mix card
  const stackInsights = useMemo(() => {
    const counts = new Map<SupportedLanguage, number>();
    let publicCount = 0;
    let lockedCount = 0;

    for (const p of projects) {
      counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
      if (p.isPublic) publicCount += 1;
      if (p.preventSameLineEdit) lockedCount += 1;
    }

    const total = projects.length;
    const languages = Array.from(counts.entries())
      .map(([id, count]) => ({
        id,
        label: SHORT_LANG_LABELS[id],
        count,
        sharePct: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);

    const recentRooms = [...projects]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 3);

    return {
      languages,
      recentRooms,
      publicCount,
      privateCount: Math.max(0, total - publicCount),
      lockedCount,
    };
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesLang =
        languageFilter === 'all' || project.language === languageFilter;
      if (!matchesLang) return false;
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) ||
        (project.description ?? '').toLowerCase().includes(q) ||
        project.language.toLowerCase().includes(q)
      );
    });
  }, [projects, searchQuery, languageFilter]);

  useEffect(() => {
    if (pendingFocusProjectId) {
      const targetIdx = filteredProjects.findIndex(
        (project) => project.id === pendingFocusProjectId,
      );
      if (targetIdx !== -1) {
        setActiveWorkspaceIndex(targetIdx);
        setPendingFocusProjectId(null);
        return;
      }
    }
    setActiveWorkspaceIndex((prev) =>
      filteredProjects.length === 0
        ? 0
        : Math.min(prev, filteredProjects.length - 1),
    );
  }, [filteredProjects, pendingFocusProjectId]);

  const studioSeedData = useMemo(
    () => buildStudioActivitySeed(projects),
    [projects],
  );

  const handleSelectSection = (tab: NavSectionId) => {
    setActiveTab(tab);
    const targetMap = {
      workspaces: workspacesRef.current,
      templates: templatesRef.current,
      activity: activityRef.current,
    };
    targetMap[tab]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openCreateModal = (preset: TemplatePreset | null = null) => {
    setSelectedPreset(preset);
    setModalOpen(true);
  };

  const handleSync = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.health });
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
  };

  const handleGithubSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = githubInput.trim().replace(/^@+/, '');
    if (cleaned) {
      setPreferStudioSeed(false);
      setCustomGithubAccount(cleaned);
    } else {
      // Submitting an empty handle restores the user's linked GitHub login (if GitHub OAuth)
      setCustomGithubAccount(null);
      setPreferStudioSeed(false);
    }
  };

  const starterCards: HoverFeatureCard[] = [
    {
      name: 'TypeScript CRDT Room',
      meta: 'Node 20 · Yjs Awareness',
      badge: 'TS',
      icon: <Braces className="h-4 w-4" aria-hidden="true" />,
      glowClassName: 'bg-slate-400/20 dark:bg-white/[0.05]',
      description:
        'Live typed workspace preconfigured for multi-cursor awareness and instant compilation.',
      preview: (
        <MiniCodeFrame
          filename="room.ts"
          lines={[
            'export const doc = new Y.Doc();',
            'const room = awareness.getStates();',
            'syncRoom(doc, { latencyMs: 18 });',
          ]}
        />
      ),
      onClick: () =>
        openCreateModal({
          name: 'ts-crdt-studio',
          language: 'typescript',
          description:
            'Collaborative TypeScript room tuned for real-time multi-cursor editing.',
          preventSameLineEdit: false,
        }),
    },
    {
      name: 'Python Compute Sandbox',
      meta: 'Python 3.12 · Isolated Worker',
      badge: 'PY',
      icon: <TerminalSquare className="h-4 w-4" aria-hidden="true" />,
      glowClassName: 'bg-slate-400/20 dark:bg-white/[0.05]',
      description:
        'Isolated BullMQ execution target suited for algorithms, scripting, and fast benchmarks.',
      preview: (
        <MiniCodeFrame
          filename="main.py"
          lines={[
            'def solve(stream: list[int]) -> int:',
            '    return sum(x for x in stream)',
            'print(solve([2, 5, 8, 13]))',
          ]}
        />
      ),
      onClick: () =>
        openCreateModal({
          name: 'python-compute-lab',
          language: 'python',
          description:
            'Python execution workspace with fast isolated BullMQ container runs.',
          preventSameLineEdit: false,
        }),
    },
    {
      name: 'C++ Systems Arena',
      meta: 'G++ 13 · Strict Line Lock',
      badge: 'C++',
      icon: <Cpu className="h-4 w-4" aria-hidden="true" />,
      glowClassName: 'bg-slate-400/20 dark:bg-white/[0.05]',
      description:
        'Enables same-line conflict prevention out of the box for disciplined pair debugging.',
      preview: (
        <MiniCodeFrame
          filename="engine.cpp"
          lines={[
            '#include <vector>',
            'int main() { std::vector<int> q{1,2};',
            '  return q.empty() ? 1 : 0; }',
          ]}
        />
      ),
      onClick: () =>
        openCreateModal({
          name: 'cpp-systems-arena',
          language: 'cpp',
          description:
            'Systems programming room with strict line-level concurrency locks.',
          preventSameLineEdit: true,
        }),
    },
    {
      name: 'JavaScript Event Mesh',
      meta: 'ESM Runtime · Fast Boot',
      badge: 'JS',
      icon: <Layers className="h-4 w-4" aria-hidden="true" />,
      glowClassName: 'bg-slate-400/20 dark:bg-white/[0.05]',
      description:
        'Lightweight ES module canvas built for rapid API prototyping with live collaborators.',
      preview: (
        <MiniCodeFrame
          filename="mesh.js"
          lines={[
            'export async function broadcast(msg) {',
            '  return await channel.publish(msg);',
            '}',
          ]}
        />
      ),
      onClick: () =>
        openCreateModal({
          name: 'js-event-mesh',
          language: 'javascript',
          description:
            'Interactive ES module prototype workspace for shared API building.',
          preventSameLineEdit: false,
        }),
    },
    {
      name: 'Execution Arena',
      meta: 'BullMQ · Docker Sandbox',
      soon: true,
      icon: <Swords className="h-4 w-4" aria-hidden="true" />,
      description:
        'Run competitive timed coding rooms and isolated multi-language Docker tests.',
      preview: (
        <MiniCodeFrame
          filename="arena.runner"
          lines={[
            'container: alpine-seccomp',
            'quota: 128MB RAM · net=none',
            'queue: waiting Step 9…',
          ]}
        />
      ),
    },
    {
      name: 'AI Pair Debugger',
      meta: 'Context-aware static review',
      soon: true,
      icon: <Bot className="h-4 w-4" aria-hidden="true" />,
      description:
        'Instant diff explanations and security audits directly inside your active branch.',
      preview: (
        <MiniCodeFrame
          filename="audit.agent"
          lines={[
            'analyze: branch/diff',
            'checks: ACL + Type Safety + Tests',
            'status: planned module',
          ]}
        />
      ),
    },
  ];

  const isSyncing = projectsQuery.isFetching || healthQuery.isFetching;
  const apiHealthy = healthQuery.data?.status === 'ok';

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <StudioBackdrop />

      <GooeyNavbar
        user={user}
        activeTab={activeTab}
        onSelectTab={handleSelectSection}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        onCreateNew={() => openCreateModal(null)}
        onSync={handleSync}
        isSyncing={isSyncing}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
        projectCount={projects.length}
      />

      <GlassySidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        projects={projects}
        health={healthQuery.data}
        activeTab={activeTab}
        onSelectTab={handleSelectSection}
        onOpenProject={(projectId) => navigate(`/studio/${projectId}`)}
        onCreateFromPreset={(preset) => openCreateModal(preset ?? null)}
      />

      <CreateWorkspaceModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        preset={selectedPreset}
        onCreated={(detail) => {
          setRecentCreated(detail);
          setSearchQuery('');
          setLanguageFilter('all');
          setPendingFocusProjectId(detail.project.id);
        }}
      />

      <main className="relative z-10 mx-auto max-w-6xl space-y-12 px-4 pb-16 pt-8 sm:px-6">
        {/* 1. Flagship Mirror-Glass Hero Banner + Studio Snapshot */}
        <section className="glass-mirror relative overflow-hidden rounded-[28px] p-6 sm:p-8 lg:p-10">
          <PixelRippleBackground gap={18} pixelSize={2.5} />

          <div className="relative z-10 grid items-center gap-8 lg:grid-cols-12">
            {/* Hero Intro Copy + Monochrome Crystal Health Beacon */}
            <div className="space-y-5 lg:col-span-7">
              <div className="flex flex-wrap items-center gap-2.5">
                {/* Monochrome crystal capsule replacing common green status badges */}
                <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-medium text-foreground">
                  <span className="relative flex h-2 w-2">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        apiHealthy
                          ? 'animate-ping bg-foreground dark:bg-white'
                          : 'bg-primary'
                      }`}
                    />
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        apiHealthy
                          ? 'bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.75)] dark:bg-white'
                          : 'bg-primary'
                      }`}
                    />
                  </span>
                  <span>
                    {healthQuery.isLoading && !healthQuery.data
                      ? 'Checking API · Postgres & Redis'
                      : apiHealthy
                        ? 'API OK · Postgres & Redis'
                        : 'Telemetry Degraded · Check Services'}
                  </span>
                </span>

                <span className="font-mono text-[11px] text-muted-foreground">
                  @{user?.username} · {user?.role ?? 'member'}
                </span>
              </div>

              <div className="space-y-2.5">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Collaborative Studio Hub
                </h1>
                <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                  Provision multi-cursor CRDT repositories, inspect live branch
                  access, and jump directly into isolated code execution from a
                  unified workspace surface.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => openCreateModal(null)}
                  className="btn-studio-primary inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold sm:text-sm"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>New Workspace</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectSection('templates')}
                  className="glass-control inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-medium text-foreground sm:text-sm"
                >
                  <Sparkles
                    className="h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>Browse Templates</span>
                </button>
              </div>
            </div>

            {/* Right: Frosted Glass Studio Snapshot Telemetry Card */}
            <div className="lg:col-span-5">
              <div className="glass-surface rounded-3xl p-5">
                <div className="flex items-center justify-between border-b border-border/60 pb-3">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    Studio Snapshot
                  </span>
                  <span className="font-mono text-[11px] font-medium text-muted-foreground">
                    {healthQuery.data?.uptime ?? 0}s uptime
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="glass-control rounded-2xl p-3.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <FolderGit2
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      Workspaces
                    </span>
                    <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
                      {stats.total}
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {stats.owned} owned · {stats.shared} shared
                    </span>
                  </div>

                  <div className="glass-control rounded-2xl p-3.5">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <GitBranch
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      Active Topology
                    </span>
                    <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">
                      {stats.totalBranches}
                    </p>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                      <Users className="h-2.5 w-2.5" aria-hidden="true" />
                      {stats.totalMembers} collaborator seats
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Newly Created Workspace Prompt Banner (Monochrome Crystal + Solar Tangerine Accent) */}
          {recentCreated && (
            <div className="glass-control relative z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-primary/35 px-4 py-3">
              <div className="flex items-center gap-2.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="font-medium text-foreground">
                  Workspace{' '}
                  <strong className="font-semibold text-primary">
                    {recentCreated.project.name}
                  </strong>{' '}
                  is ready with {recentCreated.branches.length} default branch.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/studio/${recentCreated.project.id}`)
                  }
                  className="btn-studio-primary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold"
                >
                  <span>Open Studio</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setRecentCreated(null)}
                  aria-label="Dismiss notification"
                  className="glass-control inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 2. Workspaces Grid + Search & Language Filter Bar */}
        <section
          ref={workspacesRef}
          id="workspaces"
          className="scroll-mt-24 space-y-5"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  Repositories · File Structure
                </span>
                {filteredProjects.length > 0 && (
                  <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {Math.min(activeWorkspaceIndex + 1, filteredProjects.length)} /{' '}
                    {filteredProjects.length}
                  </span>
                )}
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                Your Workspaces
              </h2>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              {/* Search Box */}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search repositories…"
                  aria-label="Search workspaces"
                  className="glass-control h-9 w-full rounded-xl pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary/55 focus:outline-none sm:w-56"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Segmented Glass Language Filter */}
              <div
                role="group"
                aria-label="Filter workspaces by language"
                className="glass-surface inline-flex items-center gap-1 rounded-xl p-1"
              >
                {LANGUAGE_FILTERS.map((item) => {
                  const active = languageFilter === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLanguageFilter(item.id)}
                      className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                        active
                          ? 'bg-primary/15 text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Query Loading / Error / Empty / Orbital Deck */}
          {projectsQuery.isLoading && (
            <div className="flex items-center justify-center gap-6 overflow-hidden py-2">
              {[0, 1, 2].map((slot) => (
                <div
                  key={slot}
                  className={`glass-surface h-[356px] w-[336px] shrink-0 animate-pulse rounded-3xl p-5 ${
                    slot !== 1 ? 'hidden opacity-60 scale-90 sm:block' : ''
                  }`}
                >
                  <div className="h-6 w-24 rounded-lg bg-muted/60" />
                  <div className="mt-4 h-5 w-44 rounded-lg bg-muted/60" />
                  <div className="mt-2 h-4 w-full rounded-lg bg-muted/40" />
                  <div className="mt-4 h-[106px] w-full rounded-2xl bg-muted/35" />
                </div>
              ))}
            </div>
          )}

          {projectsQuery.isError && (
            <div className="glass-surface flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
              <div>
                <h3 className="text-sm font-semibold text-destructive">
                  Failed to load workspaces
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {projectsQuery.error instanceof Error
                    ? projectsQuery.error.message
                    : 'Unable to reach /api/projects.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => projectsQuery.refetch()}
                className="glass-control rounded-xl px-3.5 py-2 text-xs font-medium text-foreground"
              >
                Retry
              </button>
            </div>
          )}

          {!projectsQuery.isLoading &&
            !projectsQuery.isError &&
            projects.length === 0 && (
              <div className="glass-surface flex flex-col items-center justify-center rounded-3xl border-dashed px-6 py-12 text-center">
                <div className="glass-control flex h-12 w-12 items-center justify-center rounded-2xl text-foreground/80">
                  <FolderGit2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  No workspaces created yet
                </h3>
                <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
                  Start from an empty repository or pick a pre-configured CRDT
                  starter template below to invite collaborators.
                </p>
                <button
                  type="button"
                  onClick={() => openCreateModal(null)}
                  className="btn-studio-primary mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Create your first workspace</span>
                </button>
              </div>
            )}

          {!projectsQuery.isLoading &&
            !projectsQuery.isError &&
            projects.length > 0 &&
            filteredProjects.length === 0 && (
              <div className="glass-surface flex flex-wrap items-center justify-between gap-3 rounded-3xl px-6 py-5">
                <p className="text-xs text-muted-foreground">
                  No workspaces matched your current search or language filter.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setLanguageFilter('all');
                  }}
                  className="glass-control rounded-xl px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  Reset filters
                </button>
              </div>
            )}

          {!projectsQuery.isLoading &&
            !projectsQuery.isError &&
            filteredProjects.length > 0 && (
              <OrbitalImageWheel
                items={filteredProjects}
                getKey={(project) => project.id}
                getLabel={(project) => project.name}
                getSubtitle={(project) =>
                  `${SHORT_LANG_LABELS[project.language]} · src/${STARTER_ENTRY_FILES[project.language]} · ${project.branchCount ?? 1} ${(project.branchCount ?? 1) === 1 ? 'branch' : 'branches'} · ${project.memberCount ?? 1} ${(project.memberCount ?? 1) === 1 ? 'member' : 'members'} · ${project.maxConcurrentEditors} live ${project.maxConcurrentEditors === 1 ? 'seat' : 'seats'} · ${project.isPublic ? 'Public' : 'Private'}`
                }
                activeIndex={activeWorkspaceIndex}
                onActiveIndexChange={setActiveWorkspaceIndex}
                itemWidth={336}
                itemHeight={356}
                itemGap={26}
                renderItem={(project, { isActive }) => (
                  <WorkspaceCard
                    project={project}
                    isActive={isActive}
                    onOpen={(id) => navigate(`/studio/${id}`)}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    isDeleting={
                      deleteMutation.isPending &&
                      deletingProjectId === project.id
                    }
                  />
                )}
              />
            )}
        </section>

        {/* 3. Interactive Quick-Launch Starter Templates (`HoverFeatureCards`) */}
        <section
          ref={templatesRef}
          id="templates"
          className="scroll-mt-24 space-y-5"
        >
          <div>
            <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Starter Blueprints
            </span>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
              Quick-Launch Environments
            </h2>
          </div>

          <HoverFeatureCards items={starterCards} className="lg:grid-cols-3" />
        </section>

        {/* 4. Solar Tangerine Cadence Graph & Stack Mix / Recent Rooms */}
        <section
          ref={activityRef}
          id="activity"
          className="scroll-mt-24 grid gap-6 lg:grid-cols-12"
        >
          {/* Left: Activity Cadence Card — isolates `.glass-surface` onto a sibling backdrop div
              so `backdrop-filter` does NOT create a containing block clipping fixed tooltips! */}
          <div className="relative flex flex-col rounded-3xl p-6 lg:col-span-7">
            <div
              aria-hidden="true"
              className="glass-surface pointer-events-none absolute inset-0 overflow-hidden rounded-3xl"
            />

            <div className="relative z-10 flex flex-1 flex-col justify-between gap-5">
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                        <Activity className="h-3 w-3" aria-hidden="true" />
                        <span>Cadence</span>
                      </span>
                      {isResolvingAutoGithub ? (
                        <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          Syncing GitHub…
                        </span>
                      ) : liveGithubAccount ? (
                        <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-foreground">
                          GitHub · @{liveGithubAccount}
                        </span>
                      ) : preferStudioSeed && autoGithubHandle ? (
                        <button
                          type="button"
                          onClick={() => setPreferStudioSeed(false)}
                          className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary/45 hover:text-primary"
                        >
                          Studio · Sync @{autoGithubHandle}
                        </button>
                      ) : (
                        <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          Studio
                        </span>
                      )}
                    </div>
                    <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                      Workspace & Commit Rhythm
                    </h2>
                  </div>

                  {/* GitHub account connector — pre-linked automatically for GitHub OAuth sign-ins */}
                  <form
                    onSubmit={handleGithubSubmit}
                    className="flex items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={githubInput}
                      onChange={(e) => setGithubInput(e.target.value)}
                      placeholder={
                        liveGithubAccount
                          ? `@${liveGithubAccount}`
                          : 'github handle'
                      }
                      aria-label="GitHub username for live graph"
                      className="glass-control h-8 w-32 rounded-xl px-2.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/65 focus:border-primary/55 focus:outline-none sm:w-36"
                    />
                    <button
                      type="submit"
                      className="glass-control h-8 rounded-xl px-2.5 font-mono text-[11px] font-medium text-foreground hover:border-primary/45 hover:text-primary"
                    >
                      Update
                    </button>
                    {(liveGithubAccount || isResolvingAutoGithub) && (
                      <button
                        type="button"
                        onClick={() => {
                          setGithubInput('');
                          setCustomGithubAccount(null);
                          setPreferStudioSeed(true);
                        }}
                        title="Revert to Studio cadence"
                        aria-label="Revert to Studio cadence"
                        className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </form>
                </div>

                <GithubGraph
                  account={liveGithubAccount ?? user?.username ?? 'codecollab'}
                  data={
                    liveGithubAccount || isResolvingAutoGithub
                      ? undefined
                      : studioSeedData
                  }
                  loading={isResolvingAutoGithub}
                  onSummaryChange={setCadenceSummary}
                  variant="tangerine"
                  months={5}
                  cellSize={18}
                  cellGap={5}
                  cellRadius={3}
                  autoFit
                  showAccount={false}
                  showLegend
                  ambientEffect="twinkle"
                />
              </div>

              {/* Lower Summary Telemetry Strip + Profile/Source Footer */}
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="glass-control rounded-2xl px-3.5 py-2.5">
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      5m Total
                    </span>
                    <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                      {cadenceSummary ? cadenceSummary.totalContributions : '—'}
                    </p>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {liveGithubAccount ? 'contributions' : 'studio events'}
                    </span>
                  </div>

                  <div className="glass-control rounded-2xl px-3.5 py-2.5">
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Active Days
                    </span>
                    <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                      {cadenceSummary ? cadenceSummary.activeDays : '—'}
                    </p>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {cadenceSummary
                        ? `${cadenceSummary.currentStreak}d current streak`
                        : 'days active'}
                    </span>
                  </div>

                  <div className="glass-control rounded-2xl px-3.5 py-2.5">
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Peak Day
                    </span>
                    <p className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                      {cadenceSummary ? cadenceSummary.peakCount : '—'}
                    </p>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {cadenceSummary
                        ? formatUtcMonthDay(cadenceSummary.peakDate)
                        : 'best burst'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border/60 pt-4 font-mono text-[11px] text-muted-foreground">
                  <span>
                    {liveGithubAccount
                      ? 'GitHub public calendar · last 5m'
                      : 'Local studio activity · trailing 140d'}
                  </span>
                  {(() => {
                    const safeHandle = liveGithubAccount
                      ? normalizeGithubAccount(liveGithubAccount)
                      : null;
                    return safeHandle ? (
                      <a
                        href={`https://github.com/${safeHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-primary"
                      >
                        <span>View @{safeHandle}</span>
                        <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openCreateModal(null)}
                        className="text-muted-foreground transition-colors hover:text-primary"
                      >
                        + New room
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Language Mix & Recent Rooms Panel (live from PostgreSQL, zero duplicate telemetry) */}
          <div className="glass-surface flex flex-col justify-between rounded-3xl p-6 lg:col-span-5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                    Stack &amp; Pulse
                  </span>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                    Language Mix &amp; Recent
                  </h2>
                </div>
                <span className="glass-control rounded-full px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {stackInsights.languages.length}{' '}
                  {stackInsights.languages.length === 1 ? 'runtime' : 'runtimes'}
                </span>
              </div>

              {/* Segmented Language Distribution Bar + Click-to-Filter Chips */}
              {stackInsights.languages.length > 0 && (
                <div className="mt-4 space-y-2.5">
                  <div
                    className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted/60 p-[1px]"
                    aria-label="Workspace language breakdown"
                  >
                    {stackInsights.languages.map((lang, idx) => {
                      const barTones = [
                        'bg-primary',
                        'bg-foreground/65',
                        'bg-foreground/45',
                        'bg-foreground/30',
                        'bg-foreground/18',
                      ];
                      return (
                        <div
                          key={lang.id}
                          style={{ width: `${Math.max(lang.sharePct, 8)}%` }}
                          className={`h-full rounded-full transition-all ${barTones[idx] ?? 'bg-foreground/15'}`}
                          title={`${lang.label}: ${lang.count} (${lang.sharePct}%)`}
                        />
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {stackInsights.languages.map((lang, idx) => (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => {
                          setLanguageFilter(lang.id);
                          handleSelectSection('workspaces');
                        }}
                        className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] text-foreground hover:border-primary/45 hover:text-primary"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            idx === 0 ? 'bg-primary' : 'bg-foreground/50'
                          }`}
                        />
                        <span>{lang.label}</span>
                        <span className="text-muted-foreground">
                          {lang.count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 3 Most Recently Active Workspaces */}
              <div className="mt-5 space-y-2">
                {stackInsights.recentRooms.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-center">
                    <p className="text-xs text-muted-foreground">
                      No recent workspace activity yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => openCreateModal(null)}
                      className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] font-medium text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      <span>Launch first room</span>
                    </button>
                  </div>
                ) : (
                  stackInsights.recentRooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => navigate(`/studio/${room.id}`)}
                      className="glass-control group flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left hover:border-primary/40"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/65 font-mono text-[10px] font-semibold text-foreground transition-colors group-hover:text-primary">
                          {SHORT_LANG_LABELS[room.language]}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground transition-colors group-hover:text-primary">
                            {room.name}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            {formatShortRelativeTime(room.updatedAt)} ·{' '}
                            {room.branchCount ?? 1}{' '}
                            {(room.branchCount ?? 1) === 1
                              ? 'branch'
                              : 'branches'}
                            {room.preventSameLineEdit ? ' · line-lock' : ''}
                          </p>
                        </div>
                      </div>

                      <ArrowRight
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-border/60 pt-4 font-mono text-[11px] text-muted-foreground">
              <span>
                {stackInsights.publicCount} public ·{' '}
                {stackInsights.privateCount} private ·{' '}
                {stackInsights.lockedCount} locked
              </span>
              <button
                type="button"
                onClick={() => {
                  setLanguageFilter('all');
                  handleSelectSection('workspaces');
                }}
                className="text-muted-foreground transition-colors hover:text-primary"
              >
                All rooms
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
