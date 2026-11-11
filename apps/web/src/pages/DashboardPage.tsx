import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Code2,
  Database,
  FolderGit2,
  Loader2,
  LogOut,
  Radio,
  RefreshCw,
  TerminalSquare,
} from 'lucide-react';
import type { HealthCheckResponse } from '@codecollab/shared';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';

/**
 * Authenticated landing dashboard showing current session info, live PostgreSQL/Redis
 * infrastructure telemetry from `/api/health`, and Studio module cards (upgraded in Step 5).
 */
export function DashboardPage() {
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  // Reset image fallback state whenever a user logs in with a different OAuth avatar
  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatarUrl]);

  // Poll `/api/health` to show live PostgreSQL + Redis connectivity pills on the dashboard
  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await apiRequest<HealthCheckResponse>('/api/health');
      setHealth(data);
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : 'Unable to fetch server health',
      );
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await logout();
  };

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : 'CC';

  // Only allow HTTP/HTTPS avatar URLs (defense against javascript:/data: scheme injection)
  const safeAvatarUrl =
    user?.avatarUrl && /^https?:\/\//i.test(user.avatarUrl) && !avatarFailed
      ? user.avatarUrl
      : null;

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Top Bar */}
      <header className="border-b border-border bg-card/70 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5">
          <BrandLogo />

          <div className="flex items-center gap-3">
            <ThemeToggle />

            <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 sm:flex">
              {safeAvatarUrl ? (
                <img
                  src={safeAvatarUrl}
                  alt={`${user?.username ?? 'User'} avatar`}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="h-6 w-6 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent font-mono text-[11px] font-semibold text-accent-foreground">
                  {initials}
                </div>
              )}
              <span className="text-xs font-medium text-foreground">
                @{user?.username}
              </span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/70 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {isLoggingOut ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>{isLoggingOut ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
        {/* Session Summary Card */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-accent px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent-foreground">
                Authenticated Session
              </span>
              <h1 className="pt-1 text-2xl font-semibold tracking-tight text-foreground">
                Welcome back, {user?.username}
              </h1>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
            </div>

            <div className="flex flex-col items-start gap-1 font-mono text-xs text-muted-foreground sm:items-end">
              <span>Role: {user?.role ?? 'user'}</span>
              {user?.createdAt && (
                <span>
                  Joined {new Date(user.createdAt).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Minimal Workspace Module Preview */}
        <section className="grid gap-4 sm:grid-cols-3">
          <ModuleCard
            icon={<FolderGit2 className="h-4 w-4 text-primary" />}
            title="Workspaces"
            description="Create and organize collaborative project repositories."
          />
          <ModuleCard
            icon={<Code2 className="h-4 w-4 text-primary" />}
            title="Live CRDT Editor"
            description="Multi-cursor editing powered by Monaco and Yjs."
          />
          <ModuleCard
            icon={<TerminalSquare className="h-4 w-4 text-primary" />}
            title="Execution Sandbox"
            description="Isolated worker execution via BullMQ containers."
          />
        </section>

        {/* Compact Live Backend Health Panel */}
        <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <CheckCircle2
                className={
                  health?.status === 'ok'
                    ? 'h-4 w-4 text-emerald-500'
                    : 'h-4 w-4 text-muted-foreground'
                }
              />
              <div>
                <h2 className="text-sm font-medium text-foreground">
                  Backend Infrastructure
                </h2>
                <p className="font-mono text-xs text-muted-foreground">
                  {healthLoading && !health
                    ? 'Checking /api/health…'
                    : healthError
                      ? healthError
                      : `API ${health?.status.toUpperCase()} · Uptime ${health?.uptime ?? 0}s`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {health && (
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <StatusPill
                    icon={<Database className="h-3 w-3" />}
                    label="Postgres"
                    ok={health.services.database}
                  />
                  <StatusPill
                    icon={<Radio className="h-3 w-3" />}
                    label="Redis"
                    ok={health.services.redis}
                  />
                </div>
              )}

              <button
                type="button"
                onClick={loadHealth}
                disabled={healthLoading}
                aria-label="Refresh server health"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${healthLoading ? 'animate-spin' : ''}`}
                />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent">
          {icon}
        </div>
        <span className="rounded border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          Next up
        </span>
      </div>
      <h3 className="mt-3.5 text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      ].join(' ')}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

