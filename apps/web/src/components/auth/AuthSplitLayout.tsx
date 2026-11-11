import React, { useRef } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { CollabShowcasePanel } from '@/components/auth/CollabShowcasePanel';
import { CursorCodeTrail } from '@/components/auth/CursorCodeTrail';

interface AuthSplitLayoutProps {
  children: React.ReactNode;
}

/**
 * Responsive split-screen auth layout:
 * - Desktop (`lg+`): 44% focused auth column | 56% collaborative showcase + cursor trail
 * - Tablet & Mobile (`<lg`): clean prioritized form view, showcase hidden
 */
export function AuthSplitLayout({ children }: AuthSplitLayoutProps) {
  const showcaseRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* Left Column — Authentication Form */}
      <div className="relative flex w-full flex-col justify-between lg:w-[44%] xl:w-[42%]">
        {/* Header */}
        <header className="flex items-center justify-between px-6 pt-6 sm:px-10">
          <BrandLogo />
          <ThemeToggle />
        </header>

        {/* Centered Form Slot */}
        <main className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>

        {/* Subtle Footer */}
        <footer className="px-6 pb-6 text-center sm:px-10">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} CodeCollab · Real-time engineering workspace
          </p>
        </footer>

        {/* Hairline vertical divider on desktop */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-px bg-border lg:block"
        />
      </div>

      {/* Right Column — Developer Visual Showcase + Cursor Code Trail */}
      <aside
        ref={showcaseRef}
        className="relative hidden flex-1 overflow-hidden lg:block"
      >
        <CursorCodeTrail
          containerRef={showcaseRef as React.RefObject<HTMLElement>}
          className="h-full w-full"
        >
          <CollabShowcasePanel />
        </CursorCodeTrail>
      </aside>
    </div>
  );
}

