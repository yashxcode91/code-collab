import { useEffect, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
} from 'motion/react';
import {
  ArrowRight,
  Database,
  FolderGit2,
  GitBranch,
  Plus,
  Radio,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { HealthCheckResponse, Project } from '@codecollab/shared';
import type { NavSectionId } from '@/components/studio-ui/GooeyNavbar';

export interface TemplatePreset {
  name: string;
  language: Project['language'];
  description: string;
  preventSameLineEdit: boolean;
}

const SIDEBAR_PRESETS: TemplatePreset[] = [
  {
    name: 'realtime-ts-room',
    language: 'typescript',
    description: 'Type-safe CRDT event bus with live presence awareness.',
    preventSameLineEdit: false,
  },
  {
    name: 'python-ml-sandbox',
    language: 'python',
    description: 'Async data pipeline & matrix benchmark runner.',
    preventSameLineEdit: false,
  },
  {
    name: 'cpp-algo-arena',
    language: 'cpp',
    description: 'Zero-overhead systems playground with strict line locks.',
    preventSameLineEdit: true,
  },
];

interface GlassySidebarProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  health: HealthCheckResponse | undefined;
  activeTab: NavSectionId;
  onSelectTab: (tab: NavSectionId) => void;
  onOpenProject: (projectId: string) => void;
  onCreateFromPreset: (preset?: TemplatePreset) => void;
}

/**
 * Interactive crystal `.glass-mirror` slide-over drawer providing quick section jumps,
 * a cursor-tracked floating project preview pill (`useSpring`), quick-launch templates,
 * and monochrome infrastructure status badges.
 */
export function GlassySidebar({
  open,
  onClose,
  projects,
  health,
  activeTab,
  onSelectTab,
  onOpenProject,
  onCreateFromPreset,
}: GlassySidebarProps) {
  const [hoveredProject, setHoveredProject] = useState<Project | null>(null);

  // Track vertical pointer offset along the project list for the floating preview card
  const rawPreviewY = useMotionValue(120);
  const smoothPreviewY = useSpring(rawPreviewY, {
    stiffness: 340,
    damping: 30,
  });

  // Dismiss sidebar on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setHoveredProject(null);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Workspace navigation sidebar"
        >
          {/* Dimmed backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Slide-over Mirror Glass Panel */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 330, damping: 34 }}
            className="glass-mirror relative z-10 flex h-full w-80 max-w-[85vw] flex-col justify-between overflow-y-auto border-y-0 border-l-0 p-5"
          >
            <div className="relative z-10 space-y-6">
              {/* Drawer Header */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Navigator
                  </span>
                  <h2 className="text-sm font-semibold text-foreground">
                    Studio Index
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close sidebar"
                  className="glass-control inline-flex h-8 w-8 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Section Links with Lengthening Leading Bars */}
              <div className="space-y-1">
                <SidebarDashLink
                  label="Workspaces"
                  active={activeTab === 'workspaces'}
                  badge={String(projects.length)}
                  onClick={() => {
                    onSelectTab('workspaces');
                    onClose();
                  }}
                />
                <SidebarDashLink
                  label="Starter Templates"
                  active={activeTab === 'templates'}
                  onClick={() => {
                    onSelectTab('templates');
                    onClose();
                  }}
                />
                <SidebarDashLink
                  label="Activity & Telemetry"
                  active={activeTab === 'activity'}
                  onClick={() => {
                    onSelectTab('activity');
                    onClose();
                  }}
                />
              </div>

              {/* Recent Workspaces List + Spring Preview Emitter */}
              <div className="space-y-2 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Recent Repositories
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onCreateFromPreset();
                    }}
                    className="inline-flex items-center gap-1 font-mono text-[10px] font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                    <span>New</span>
                  </button>
                </div>

                {projects.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border p-3 font-mono text-[11px] text-muted-foreground">
                    No workspaces yet. Launch a preset below to start.
                  </p>
                ) : (
                  <ul
                    className="space-y-1.5"
                    onMouseLeave={() => setHoveredProject(null)}
                  >
                    {projects.slice(0, 6).map((project) => (
                      <li key={project.id}>
                        <button
                          type="button"
                          onMouseEnter={(event) => {
                            rawPreviewY.set(event.currentTarget.offsetTop);
                            setHoveredProject(project);
                          }}
                          onFocus={(event) => {
                            rawPreviewY.set(event.currentTarget.offsetTop);
                            setHoveredProject(project);
                          }}
                          onClick={() => {
                            onOpenProject(project.id);
                            onClose();
                          }}
                          className="glass-control group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs hover:border-primary/40"
                        >
                          <span className="flex items-center gap-2 truncate font-medium text-foreground">
                            <FolderGit2
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                              aria-hidden="true"
                            />
                            <span className="truncate">{project.name}</span>
                          </span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] uppercase text-muted-foreground group-hover:text-primary">
                            {project.language}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Quick-Launch Templates */}
              <div className="space-y-2 border-t border-border/60 pt-4">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <Sparkles
                    className="h-3 w-3 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>Quick Templates</span>
                </span>
                <div className="space-y-1.5">
                  {SIDEBAR_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => {
                        onClose();
                        onCreateFromPreset(preset);
                      }}
                      className="glass-control group flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs hover:border-primary/40"
                    >
                      <span className="truncate font-mono text-[11px] text-foreground">
                        {preset.name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground transition-colors group-hover:text-primary">
                        + Use
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Monochrome Infrastructure Telemetry */}
            <div className="relative z-10 mt-6 space-y-2 border-t border-border/60 pt-4">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Runtime Stack
              </span>
              <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                <span className="glass-control inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-foreground">
                  <Database
                    className="h-3 w-3 text-foreground/80"
                    aria-hidden="true"
                  />
                  <span className="truncate">Postgres</span>
                  <span
                    className={`ml-auto h-1.5 w-1.5 rounded-full ${
                      health?.services.database
                        ? 'bg-foreground shadow-[0_0_6px_rgba(255,255,255,0.65)] dark:bg-white'
                        : 'bg-muted-foreground/45'
                    }`}
                  />
                </span>
                <span className="glass-control inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-foreground">
                  <Radio
                    className="h-3 w-3 text-foreground/80"
                    aria-hidden="true"
                  />
                  <span className="truncate">Redis</span>
                  <span
                    className={`ml-auto h-1.5 w-1.5 rounded-full ${
                      health?.services.redis
                        ? 'bg-foreground shadow-[0_0_6px_rgba(255,255,255,0.65)] dark:bg-white'
                        : 'bg-muted-foreground/45'
                    }`}
                  />
                </span>
              </div>
            </div>
          </motion.aside>

          {/* Cursor-Tracked Floating Project Card Outside Sidebar Right Edge */}
          <AnimatePresence>
            {hoveredProject && (
              <motion.div
                initial={{ opacity: 0, x: -8, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -8, scale: 0.96 }}
                style={{ top: smoothPreviewY }}
                className="glass-mirror pointer-events-none relative left-3 z-20 hidden h-fit w-64 rounded-2xl p-4 sm:block"
              >
                <div className="relative z-10 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {hoveredProject.name}
                    </span>
                    <span className="glass-control rounded-full px-2 py-0.5 font-mono text-[10px] uppercase text-foreground">
                      {hoveredProject.language}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {hoveredProject.description?.trim() ||
                      'Multi-cursor Monaco repository powered by Yjs CRDT synchronization.'}
                  </p>
                  <div className="flex items-center gap-3 pt-1 font-mono text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3 w-3 text-muted-foreground" />
                      {hoveredProject.branchCount ?? 1} branches
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      {hoveredProject.memberCount ?? 1}/
                      {hoveredProject.maxConcurrentEditors}
                    </span>
                    <ArrowRight className="ml-auto h-3 w-3 text-primary" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Interactive navigation link with an animated left indicator dash that lengthens on hover. */
function SidebarDashLink({
  label,
  active,
  badge,
  onClick,
}: {
  label: string;
  active: boolean;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition-colors ${
        active
          ? 'bg-primary/15 font-semibold text-primary'
          : 'text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground'
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={`h-[2px] rounded-full transition-all duration-200 ${
            active
              ? 'w-5 bg-primary'
              : 'w-2.5 bg-muted-foreground/50 group-hover:w-5 group-hover:bg-primary'
          }`}
        />
        <span>{label}</span>
      </span>
      {badge !== undefined && (
        <span className="glass-control rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
