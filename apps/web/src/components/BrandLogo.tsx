import { useId } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface BrandLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  asLink?: boolean;
  to?: string;
}

/**
 * Devnolith Official Dimensional Ribbon "D" Emblem with Centered Code Brackets.
 * Namespaced with `useId` to prevent SVG gradient/filter ID collisions.
 */
export function BrandMark({
  className,
  size = 'md',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const uid = useId().replace(/:/g, '');
  const bodyId = `devnolith-body-${uid}`;
  const topId = `devnolith-top-${uid}`;
  const leftId = `devnolith-left-${uid}`;
  const rightId = `devnolith-right-${uid}`;
  const bottomId = `devnolith-bottom-${uid}`;
  const codeId = `devnolith-code-${uid}`;
  const shadowId = `devnolith-shadow-${uid}`;

  const boxSize =
    size === 'sm'
      ? 'h-7 w-7 rounded-lg'
      : size === 'lg'
        ? 'h-11 w-11 rounded-2xl'
        : 'h-8 w-8 rounded-xl';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center shrink-0 overflow-hidden shadow-sm transition-transform group-hover:scale-105',
        boxSize,
        className,
      )}
    >
      <svg
        viewBox="0 0 512 512"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={bodyId} x1=".12" y1=".05" x2=".92" y2=".92">
            <stop offset="0" stopColor="#FFB52C" />
            <stop offset=".48" stopColor="#FF9208" />
            <stop offset="1" stopColor="#E85A00" />
          </linearGradient>
          <linearGradient id={topId} x1=".05" y1=".05" x2=".95" y2=".9">
            <stop offset="0" stopColor="#FFC044" />
            <stop offset=".42" stopColor="#FF9C0A" />
            <stop offset="1" stopColor="#F47A00" />
          </linearGradient>
          <linearGradient id={leftId} x1="0" y1="0" x2=".1" y2="1">
            <stop offset="0" stopColor="#9D3500" />
            <stop offset=".5" stopColor="#E65A00" />
            <stop offset="1" stopColor="#FFD35F" />
          </linearGradient>
          <linearGradient id={rightId} x1=".1" y1="0" x2=".9" y2=".8">
            <stop offset="0" stopColor="#FF9B0C" />
            <stop offset=".55" stopColor="#F36B00" />
            <stop offset="1" stopColor="#B93E00" />
          </linearGradient>
          <linearGradient id={bottomId} x1=".1" y1=".15" x2=".9" y2=".85">
            <stop offset="0" stopColor="#FFD05A" />
            <stop offset=".4" stopColor="#FF970B" />
            <stop offset="1" stopColor="#DC4D00" />
          </linearGradient>
          <linearGradient id={codeId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFA00B" />
            <stop offset="1" stopColor="#E95E00" />
          </linearGradient>
          <filter id={shadowId} x="-25%" y="-20%" width="150%" height="155%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="7" />
            <feOffset dy="7" />
            <feComponentTransfer>
              <feFuncA type="linear" slope=".32" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Base dark canvas */}
        <rect width="512" height="512" fill="#0D0A08" rx="80" />

        <g transform="translate(-83 -4) scale(.88)" filter={`url(#${shadowId})`}>
          {/* Full continuous ribbon silhouette */}
          <path
            d="M190 151 C190 140 196 132 207 126 L278 98 C290 93 301 94 312 101 L548 230 C565 239 573 253 573 272 L573 428 C573 447 564 462 547 472 L392 557 C380 564 372 565 358 565 L190 565 L434 420 C446 412 457 414 468 421 L482 430 C491 435 495 443 495 454 L495 330 C495 316 488 304 476 297 L309 203 C303 199 299 201 299 210 L299 381 C299 393 293 400 283 406 L190 465 Z"
            fill={`url(#${bodyId})`}
          />

          {/* Top face of the folded ribbon */}
          <path
            d="M190 151 C190 140 196 132 207 126 L278 98 C290 93 301 94 312 101 L548 230 C565 239 573 253 573 272 L495 330 C495 316 488 304 476 297 L309 203 C303 199 299 201 299 210 L190 151 Z"
            fill={`url(#${topId})`}
          />

          {/* Inner left wall */}
          <path
            d="M190 151 L309 203 C303 199 299 201 299 210 L299 381 C299 393 293 400 283 406 L190 465 Z"
            fill={`url(#${leftId})`}
          />

          {/* Right upright of the D */}
          <path
            d="M548 230 C565 239 573 253 573 272 L573 428 C573 447 564 462 547 472 L495 502 L495 454 C495 443 491 435 482 430 L468 421 L476 297 Z"
            fill={`url(#${rightId})`}
            opacity=".92"
          />

          {/* Lower return of the ribbon */}
          <path
            d="M190 565 L358 565 C372 565 380 564 392 557 L547 472 L495 502 L495 454 C495 443 491 435 482 430 L468 421 C457 414 446 412 434 420 Z"
            fill={`url(#${bottomId})`}
          />

          {/* Subtle illuminated outer edges */}
          <path
            d="M207 126 L278 98 C290 93 301 94 312 101 L548 230"
            fill="none"
            stroke="#FFD36C"
            strokeWidth="2.8"
            strokeLinecap="round"
            opacity=".78"
          />
          <path
            d="M190 151 L190 465"
            fill="none"
            stroke="#FFB52D"
            strokeWidth="2"
            opacity=".35"
          />

          {/* Angular code glyph centered in the D opening */}
          <g fill={`url(#${codeId})`}>
            <path d="M372 333 L334 357 L372 384 L374 366 L360 357 L373 348 Z" />
            <path d="M432 333 L430 348 L445 357 L430 366 L432 384 L468 357 Z" />
            <path d="M414 316 L381 401 L398 401 L422 316 Z" />
          </g>
        </g>
      </svg>
    </div>
  );
}

/** Full horizontal Devnolith Studio wordmark + frosted studio badge with automatic linking to Home. */
export function BrandLogo({
  className,
  size = 'md',
  asLink = true,
  to = '/',
}: BrandLogoProps) {
  const textSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-lg' : 'text-[15px]';

  const content = (
    <div className={cn('inline-flex items-center gap-2.5 select-none group', className)}>
      <BrandMark size={size} />
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary',
            textSize,
          )}
        >
          Devnolith
        </span>
        <span className="glass-control hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
          studio
        </span>
      </div>
    </div>
  );

  if (asLink) {
    return (
      <Link
        to={to}
        aria-label="Devnolith Studio Home"
        className="inline-flex items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {content}
      </Link>
    );
  }

  return content;
}
