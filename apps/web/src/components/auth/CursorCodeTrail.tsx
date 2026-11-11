import React, { useEffect, useState } from 'react';
import { CursorImageTrail } from '@/components/unlumen-ui/cursor-image-trail';

function CodeFragmentChip({
  token,
  tone,
}: {
  token: string;
  tone: 'violet' | 'sky' | 'emerald' | 'amber';
}) {
  const toneClasses: Record<typeof tone, string> = {
    violet:
      'border-violet-300/80 bg-white/95 text-violet-700 dark:border-indigo-400/35 dark:bg-indigo-950/90 dark:text-indigo-200',
    sky:
      'border-sky-300/80 bg-white/95 text-sky-700 dark:border-sky-400/35 dark:bg-slate-900/90 dark:text-sky-200',
    emerald:
      'border-emerald-300/80 bg-white/95 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-950/90 dark:text-emerald-200',
    amber:
      'border-amber-300/80 bg-white/95 text-amber-700 dark:border-amber-400/35 dark:bg-amber-950/90 dark:text-amber-200',
  };

  return (
    <span
      className={[
        'inline-flex w-max items-center justify-center whitespace-nowrap rounded-md border px-2 py-1',
        'font-mono text-[11px] font-medium leading-none shadow-sm',
        toneClasses[tone],
      ].join(' ')}
    >
      {token}
    </span>
  );
}

const CODE_TRAIL_ITEMS: React.ReactNode[] = [
  <CodeFragmentChip key="arrow" token="() =>" tone="violet" />,
  <CodeFragmentChip key="crdt" token="Y.Doc()" tone="sky" />,
  <CodeFragmentChip key="jsx" token="<Room />" tone="emerald" />,
  <CodeFragmentChip key="type" token=": Peer" tone="amber" />,
  <CodeFragmentChip key="sync" token="sync()" tone="violet" />,
  <CodeFragmentChip key="braces" token="{ ... }" tone="sky" />,
  <CodeFragmentChip key="async" token="await" tone="emerald" />,
  <CodeFragmentChip key="ws" token="ws://" tone="amber" />,
];

interface CursorCodeTrailProps {
  containerRef: React.RefObject<HTMLElement>;
  className?: string;
  children: React.ReactNode;
}

/**
 * Integrates Unlumen UI's CursorImageTrail with developer code fragments:
 * - Bounded strictly to the right showcase container (`containerRef`)
 * - Auto-fades fragments after 700ms so they never obstruct static content
 * - Respects `prefers-reduced-motion` and skips touch-only devices
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

