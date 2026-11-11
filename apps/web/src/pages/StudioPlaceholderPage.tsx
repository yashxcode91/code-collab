import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Code2,
  GitBranch,
  Globe,
  Lock,
  ShieldCheck,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { fetchProjectDetail, queryKeys } from '@/lib/queries';

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  cpp: 'C++',
  java: 'Java',
};

/**
 * Destination verification route (`/studio/:projectId`) linked from Dashboard workspace cards.
 * Fetches live project, branch, and collaborator telemetry from `/api/projects/:projectId`
 * and displays Step 6 IDE readiness inside a matching Crystal Mirror Glass workspace frame.
 */
export function StudioPlaceholderPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>(
    {},
  );

  const detailQuery = useQuery({
    queryKey: queryKeys.projects.detail(projectId),
    queryFn: () => fetchProjectDetail(projectId),
    enabled: Boolean(projectId),
  });

  const project = detailQuery.data?.project;
  const branches = detailQuery.data?.branches ?? [];
  const members = detailQuery.data?.members ?? [];

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <StudioBackdrop />

      {/* Floating Mirror-Glass Header */}
      <header className="sticky top-4 z-30 mx-auto max-w-6xl px-4 sm:px-6">
        <div className="glass-mirror flex items-center justify-between rounded-2xl px-4 py-2.5 sm:px-5">
          <div className="relative z-10 flex items-center gap-3">
            <BrandLogo size="sm" />
            <span className="hidden h-4 w-px bg-border sm:inline-block" />
            <Link
              to="/"
              className="glass-control inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Workspaces</span>
            </Link>
          </div>

          <div className="relative z-10 flex items-center gap-2.5">
            {user?.username && (
              <span className="glass-control hidden rounded-xl px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
                @{user.username}
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl px-4 pb-16 pt-10 sm:px-6">
        {detailQuery.isLoading && (
          <section className="glass-mirror rounded-3xl p-8">
            <div className="relative z-10 space-y-5 animate-pulse">
              <div className="h-5 w-40 rounded-full bg-muted/70" />
              <div className="h-8 w-72 rounded-xl bg-muted/70" />
              <div className="h-4 w-full max-w-lg rounded-lg bg-muted/60" />
              <div className="grid gap-4 pt-3 sm:grid-cols-3">
                <div className="h-28 rounded-2xl bg-muted/50" />
                <div className="h-28 rounded-2xl bg-muted/50" />
                <div className="h-28 rounded-2xl bg-muted/50" />
              </div>
            </div>
          </section>
        )}

        {detailQuery.isError && (
          <section className="glass-mirror rounded-3xl p-8">
            <div className="relative z-10 space-y-4">
              <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] text-destructive">
                Workspace Unavailable
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">
                Unable to load workspace
              </h1>
              <p className="max-w-lg text-sm text-muted-foreground">
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : 'This project may have been deleted or you do not have access to it.'}
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
        )}

        {project && (
          <div className="space-y-6">
            {/* Primary Readiness Overview Panel */}
            <section className="glass-mirror overflow-hidden rounded-3xl p-7 sm:p-9">
              <div className="relative z-10 space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    {/* Monochrome crystal readiness pill matching dashboard status aesthetics */}
                    <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-medium text-foreground">
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-75 dark:bg-white" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground shadow-[0_0_8px_rgba(255,255,255,0.75)] dark:bg-white" />
                      </span>
                      <span>IDE Shell Primed · Step 6 Ready</span>
                    </span>

                    <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                      {project.name}
                    </h1>

                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {project.description?.trim() ||
                        'Collaborative repository bootstrapped and ready for multi-cursor Monaco editing, Yjs CRDT synchronization, and isolated container execution.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-foreground">
                      <Code2
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span>
                        {LANGUAGE_LABELS[project.language] ?? project.language}
                      </span>
                    </span>
                    <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-muted-foreground">
                      {project.isPublic ? (
                        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{project.isPublic ? 'Public' : 'Private'}</span>
                    </span>
                  </div>
                </div>

                {/* Live PostgreSQL Telemetry Tiles */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="glass-control rounded-2xl p-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium">Branches</span>
                      <GitBranch
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2.5 text-2xl font-semibold tracking-tight text-foreground">
                      {branches.length}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Default:{' '}
                      <span className="text-foreground">
                        {branches.find((b) => b.isDefault)?.name ?? 'main'}
                      </span>
                    </p>
                  </div>

                  <div className="glass-control rounded-2xl p-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium">Collaborators</span>
                      <Users
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2.5 text-2xl font-semibold tracking-tight text-foreground">
                      {members.length}
                      <span className="text-sm font-normal text-muted-foreground">
                        {' '}
                        / {project.maxConcurrentEditors} max
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Your role:{' '}
                      <span className="text-foreground">
                        {project.currentUserRole ?? 'viewer'}
                      </span>
                    </p>
                  </div>

                  <div className="glass-control rounded-2xl p-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium">Same-Line Guard</span>
                      <ShieldCheck
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                    </div>
                    <p className="mt-2.5 text-lg font-semibold tracking-tight text-foreground">
                      {project.preventSameLineEdit
                        ? 'Strict Line Lock'
                        : 'CRDT Free-Flow'}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      Yjs awareness threshold active
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Secondary Branch & Member Roster Cards */}
            <div className="grid gap-6 md:grid-cols-2">
              <section className="glass-surface rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Provisioned Branches
                  </h2>
                  <TerminalSquare
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <ul className="mt-4 space-y-2">
                  {branches.map((branch) => (
                    <li
                      key={branch.id}
                      className="glass-control flex items-center justify-between rounded-xl px-3.5 py-2.5 font-mono text-xs"
                    >
                      <span className="flex items-center gap-2 text-foreground">
                        <GitBranch
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {branch.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {branch.isDefault ? 'default' : 'feature'}
                        {branch.isProtected ? ' · protected' : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="glass-surface rounded-3xl p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">
                    Active Members
                  </h2>
                  <Users
                    className="h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                </div>
                <ul className="mt-4 space-y-2">
                  {members.map((member) => {
                    const safeUrl =
                      member.user.avatarUrl &&
                      /^https?:\/\//i.test(member.user.avatarUrl) &&
                      !failedAvatars[member.id]
                        ? member.user.avatarUrl
                        : null;

                    return (
                      <li
                        key={member.id}
                        className="glass-control flex items-center justify-between rounded-xl px-3.5 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
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
                              className="h-6 w-6 rounded-full object-cover ring-1 ring-border"
                            />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold text-foreground">
                              {member.user.username.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="font-mono text-foreground">
                            @{member.user.username}
                          </span>
                        </div>
                        <span className="glass-control rounded-full px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {member.role}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
