import React, { useEffect, useState } from 'react';
import { CursorImageTrail } from '@/components/unlumen-ui/cursor-image-trail';

/**
 * Single floating syntax token emitted along cursor paths behind the centered auth card.
 * Uses strictly the single active `--primary` accent for emphasized tokens plus neutral glass
 * styling for structural tokens to keep the visual language monochrome + Solar Tangerine.
 */
function CodeFragmentChip({
  token,
  emphasized = false,
}: {
  token: string;
  emphasized?: boolean;
}) {
  return (
    <span
      className={[
        'inline-flex w-max items-center justify-center whitespace-nowrap rounded-md border px-2 py-1',
        'font-mono text-[11px] font-medium leading-none shadow-sm',
        emphasized
          ? 'border-primary/35 bg-white/95 text-primary dark:border-primary/40 dark:bg-neutral-950/90 dark:text-primary'
          : 'border-slate-300/80 bg-white/95 text-slate-700 dark:border-white/20 dark:bg-neutral-950/90 dark:text-neutral-200',
      ].join(' ')}
    >
      {token}
    </span>
  );
}

const CODE_TRAIL_ITEMS: React.ReactNode[] = [
  <CodeFragmentChip key="arrow" token="() =>" emphasized />,
  <CodeFragmentChip key="crdt" token="Y.Doc()" />,
  <CodeFragmentChip key="jsx" token="<Room />" emphasized />,
  <CodeFragmentChip key="type" token=": Peer" />,
  <CodeFragmentChip key="sync" token="sync()" emphasized />,
  <CodeFragmentChip key="braces" token="{ ... }" />,
  <CodeFragmentChip key="async" token="await" emphasized />,
  <CodeFragmentChip key="ws" token="ws://" />,
];

interface CursorCodeTrailProps {
  containerRef: React.RefObject<HTMLElement>;
  className?: string;
  children: React.ReactNode;
}

/**
 * Integrates Unlumen UI's `CursorImageTrail` with collaborative engineering tokens:
 * - Bounded strictly inside `containerRef`
 * - Layered behind the centered mirror card (`trailZIndex={10}` vs `z-20`)
 * - Automatically fades fragments after 720ms and disables itself on reduced motion or touch input
 */
export function CursorCodeTrail({
  containerRef,
  className,
  children,
}: CursorCodeTrailProps) {
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const isTouchDevice = useMediaQuery('(hover: none) and (pointer: coarse)');

  if (prefersReducedMotion || isTouchDevice) {
    return <div className={className}>{children}</div>;
  }

  return (
    <CursorImageTrail
      items={CODE_TRAIL_ITEMS}
      itemSize="auto"
      trailLength={5}
      spawnDistance={76}
      rotationRange={9}
      itemLifetimeMs={720}
      trailZIndex={10}
      containerRef={containerRef}
      className={className}
    >
      {children}
    </CursorImageTrail>
  );
}

/** Subscribes reactively to a CSS media query (e.g., reduced motion or coarse touch pointer). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = (event: MediaQueryListEvent) => setMatches(event.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);

  return matches;
}
