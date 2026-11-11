import React, { useRef } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CursorCodeTrail } from '@/components/auth/CursorCodeTrail';

interface AuthCenteredLayoutProps {
  children: React.ReactNode;
}

/**
 * Centered studio authentication layout:
 * - Architectural dot grid, circuit lines, and subtle studio glow (`z-0`)
 * - Bounded cursor code trail floating behind the card (`z-10`–`z-14`)
 * - Centered mirror-glass auth card (`z-20`) prioritized on every screen size
 */
export function AuthCenteredLayout({ children }: AuthCenteredLayoutProps) {
  const stageRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={stageRef}
      className="relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground"
    >
      <CursorCodeTrail
        containerRef={stageRef as React.RefObject<HTMLElement>}
        className="flex flex-1 flex-col justify-between"
      >
        {/* 1. Radial-Masked Architectural Dot Grid (fades seamlessly toward edges) */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 h-full w-full text-slate-400/50 dark:text-white/[0.14]"
          style={{
            maskImage:
              'radial-gradient(ellipse 68% 62% at 50% 48%, black 32%, transparent 100%)',
            WebkitMaskImage:
              'radial-gradient(ellipse 68% 62% at 50% 48%, black 32%, transparent 100%)',
          }}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="auth-studio-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1.5" cy="1.5" r="1.15" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#auth-studio-grid)" />
        </svg>

        {/* 2. Studio Spotlight & Single-Accent Ambient Halo Behind Mirror Card */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[560px] w-[560px] -translate-x-[68%] -translate-y-[62%] rounded-full bg-primary/20 blur-3xl dark:bg-primary/[0.085]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[480px] w-[480px] -translate-x-[22%] -translate-y-[28%] rounded-full bg-slate-400/20 blur-3xl dark:bg-slate-400/[0.085]"
        />

        {/* 3. Concentric Precision Halo Rings Framing the Center Stage */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900/[0.045] dark:border-white/[0.05] md:block"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden h-[920px] w-[920px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900/[0.03] dark:border-white/[0.03] lg:block"
        />

        {/* 4. Top Bar */}
        <header className="relative z-20 flex items-center justify-between px-6 pt-5 sm:px-10 sm:pt-7">
          <BrandLogo />
          <ThemeToggle />
        </header>

        {/* 5. Centered Mirror-Glass Card + Precision Floor Reflection */}
        <main className="relative z-20 flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-[476px]">
            <div className="glass-mirror overflow-hidden rounded-[26px] p-7 sm:p-10">
              <div className="relative z-10">{children}</div>
            </div>

            {/* Subtle Specular Floor Horizon + Engineering Trust Caption */}
            <div
              aria-hidden="true"
              className="mx-auto mt-5 h-px w-2/3 bg-gradient-to-r from-transparent via-slate-900/15 to-transparent dark:via-white/20"
            />
            <p className="mt-3 text-center font-mono text-[11px] tracking-tight text-muted-foreground/80">
              Yjs CRDT · HttpOnly JWT · Encrypted sessions
            </p>
          </div>
        </main>

        {/* 6. Subtle Footer */}
        <footer className="relative z-20 px-6 pb-5 text-center sm:px-10 sm:pb-6">
          <p className="text-xs text-muted-foreground/80">
            © {new Date().getFullYear()} CodeCollab · Real-time engineering workspace
          </p>
        </footer>
      </CursorCodeTrail>
    </div>
  );
}
