import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import {
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { User } from '@codecollab/shared';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SidebarToggleIcon } from '@/components/unlumen-ui/sidebar-toggle-icon';

export type NavSectionId = 'workspaces' | 'templates' | 'activity' | 'roadmap';

interface NavTab {
  id: NavSectionId;
  label: string;
}

const NAV_TABS: NavTab[] = [
  { id: 'workspaces', label: 'Workspaces' },
  { id: 'templates', label: 'Templates' },
  { id: 'activity', label: 'Activity' },
  { id: 'roadmap', label: 'Roadmap' },
];

interface GooeyNavbarProps {
  user: User | null;
  activeTab: NavSectionId;
  onSelectTab: (tab: NavSectionId) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCreateNew: () => void;
  onSync: () => void;
  isSyncing: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
  projectCount?: number;
}

/**
 * Sticky Mirror-Glass top navigation bar — the single primary navigation surface across
 * the Dashboard (replaces any redundant bottom floating dock that could obscure scrolled forms).
 *
 * SVG Gooey Filter Architecture:
 * - Renders an SVG `feGaussianBlur` + `feColorMatrix (22 -9)` metaball filter strictly around
 *   the sliding active tab pill and the tiny top neck tether (`goo-tether`).
 * - Inside the filtered wrapper, pills use **100% opaque `bg-primary`** while the outer wrapper
 *   applies `opacity-20 dark:opacity-30`. (Rendering low-alpha fills *inside* the matrix would
 *   cause `22 * alpha - 9 < 0`, collapsing them to invisible.)
 */
export function GooeyNavbar({
  user,
  activeTab,
  onSelectTab,
  sidebarOpen,
  onToggleSidebar,
  onCreateNew,
  onSync,
  isSyncing,
  onLogout,
  isLoggingOut,
}: GooeyNavbarProps) {
  const filterId = useId().replace(/:/g, '');
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatarUrl]);

  // Enforce HTTP/HTTPS scheme on external OAuth avatars (blocks javascript:/data: injection)
  const safeAvatarUrl =
    user?.avatarUrl && /^https?:\/\//i.test(user.avatarUrl) && !avatarFailed
      ? user.avatarUrl
      : null;

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : 'CC';

  return (
    <header className="sticky top-4 z-40 mx-auto w-full max-w-7xl xl:max-w-[1400px] 2xl:max-w-[1536px] px-4 sm:px-6 lg:px-8">
      {/* Off-screen SVG filter definition for liquid metaball blending */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
      >
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <div className="glass-mirror rounded-2xl px-3 py-2.5 sm:px-4">
        <div className="relative z-10 flex items-center justify-between gap-2">
          {/* Left: Morphing Sidebar Toggle + Studio Brand + Hub Popover Trigger */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={
                sidebarOpen
                  ? 'Close workspace sidebar'
                  : 'Open workspace sidebar'
              }
              aria-expanded={sidebarOpen}
              className="glass-control inline-flex h-9 w-9 items-center justify-center rounded-xl text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <SidebarToggleIcon isOpen={sidebarOpen} className="h-5 w-5" />
            </button>

            <BrandLogo size="sm" />
          </div>

          {/* Center: Gooey Sliding Section Navigation Pills (Desktop) */}
          <nav
            aria-label="Dashboard sections"
            className="glass-control relative hidden items-center rounded-xl p-1 md:flex"
          >
            {/* Outer opacity wrapper + inner opaque pills preserve SVG feColorMatrix alpha math */}
            <div
              style={{ filter: `url(#${filterId})` }}
              className="pointer-events-none absolute inset-1 opacity-20 dark:opacity-25"
              aria-hidden="true"
            >
              <div className="relative flex h-full w-full items-center">
                {NAV_TABS.map((tab) => (
                  <div
                    key={tab.id}
                    className="relative flex h-full flex-1 items-center justify-center px-3"
                  >
                    {activeTab === tab.id && (
                      <motion.div
                        layoutId="gooey-nav-pill"
                        transition={{
                          type: 'spring',
                          stiffness: 360,
                          damping: 28,
                        }}
                        className="absolute inset-0 rounded-lg bg-primary"
                      />
                    )}
                    <span className="invisible text-sm font-medium">
                      {tab.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {NAV_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`relative z-10 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Right: Create CTA + Sync + Theme + User Pill + Sign Out */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCreateNew}
              className="btn-studio-primary inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">New</span>
            </button>

            <button
              type="button"
              onClick={onSync}
              disabled={isSyncing}
              title="Refresh workspaces & telemetry"
              aria-label="Refresh workspaces and server telemetry"
              className="glass-control inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin text-primary' : ''}`}
                aria-hidden="true"
              />
            </button>

            <ThemeToggle />

            <div className="glass-control hidden items-center gap-2 rounded-xl px-2.5 py-1 sm:inline-flex">
              {safeAvatarUrl ? (
                <img
                  src={safeAvatarUrl}
                  alt={`${user?.username ?? 'User'} avatar`}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="h-6 w-6 rounded-full object-cover ring-1 ring-border"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold text-foreground">
                  {initials}
                </div>
              )}
              <span className="max-w-[120px] truncate font-mono text-xs font-medium text-foreground">
                @{user?.username}
              </span>
            </div>

            <button
              type="button"
              onClick={onLogout}
              disabled={isLoggingOut}
              aria-label="Sign out"
              className="glass-control inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-55 sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isLoggingOut ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="hidden lg:inline">
                {isLoggingOut ? 'Signing out…' : 'Sign out'}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Quick-Jump Strip (`< md` screens where central pill bar hides) */}
        <div className="relative z-10 mt-2 flex items-center gap-1.5 border-t border-border/50 pt-2 md:hidden">
          {NAV_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                className={`flex-1 rounded-lg py-1 font-mono text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
