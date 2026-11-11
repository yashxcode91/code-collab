import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md';
}

/** Geometric Studio bracket emblem (`</>`), styled via Solar Tangerine CSS variables. */
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
      style={{
        background:
          'linear-gradient(180deg, var(--studio-btn-from), var(--studio-btn-to))',
        color: 'var(--studio-btn-text)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.36), 0 6px 18px -4px rgba(var(--studio-rgb), 0.48)',
      }}
      className={cn(
        'relative flex items-center justify-center',
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

/** Full horizontal CodeCollab Studio wordmark + frosted studio badge used in headers. */
export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  const textSize = size === 'sm' ? 'text-sm' : 'text-[15px]';

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <BrandMark size={size} />
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-semibold tracking-tight text-foreground', textSize)}>
          CodeCollab
        </span>
        <span className="glass-control hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
          studio
        </span>
      </div>
    </div>
  );
}
