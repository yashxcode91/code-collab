import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md';
}

/** Geometric Studio bracket emblem (`</>`). */
export function BrandMark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const boxSize =
    size === 'sm'
      ? 'h-7 w-7 rounded-md'
      : size === 'lg'
        ? 'h-11 w-11 rounded-2xl'
        : 'h-8 w-8 rounded-lg';
  const iconSize =
    size === 'sm'
      ? 'h-3.5 w-3.5'
      : size === 'lg'
        ? 'h-5 w-5'
        : 'h-4 w-4';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center bg-gradient-to-b from-violet-500 to-violet-700 text-white',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_16px_-4px_rgba(109,40,217,0.45)]',
        'dark:from-indigo-400 dark:to-indigo-600 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_-4px_rgba(99,102,241,0.5)]',
        boxSize,
        className,
      )}
    >
      <svg viewBox="0 0 24 24" fill="none" className={iconSize} aria-hidden="true">
        <path
          d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5.5l-3 13"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Full horizontal CodeCollab Studio wordmark + emblem used in page headers. */
export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  const textSize = size === 'sm' ? 'text-sm' : 'text-[15px]';

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <BrandMark size={size} />
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-semibold tracking-tight text-foreground', textSize)}>
          CodeCollab
        </span>
        <span className="hidden rounded border border-slate-900/10 bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06] sm:inline-block">
          studio
        </span>
      </div>
    </div>
  );
}

