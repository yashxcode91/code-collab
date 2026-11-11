import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md';
}

export function BrandLogo({ className, size = 'md' }: BrandLogoProps) {
  const boxSize = size === 'sm' ? 'h-7 w-7 rounded-md' : 'h-8 w-8 rounded-lg';
  const iconSize = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  const textSize = size === 'sm' ? 'text-sm' : 'text-[15px]';

  return (
    <div className={cn('inline-flex items-center gap-2.5 select-none', className)}>
      <div
        className={cn(
          'relative flex items-center justify-center bg-primary text-primary-foreground shadow-sm',
          boxSize,
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className={iconSize}
          aria-hidden="true"
        >
          <path
            d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5.5l-3 13"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('font-semibold tracking-tight text-foreground', textSize)}>
          CodeCollab
        </span>
        <span className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
          studio
        </span>
      </div>
    </div>
  );
}

