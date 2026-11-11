/**
 * Fixed full-viewport atmospheric background for Dashboard and Studio routes (`z-0`).
 * Combines engineering precision geometry (subtle orthographic grid lines, radial-vignetted
 * dot matrix, concentric orbit rings) with dual light-source spotlights: a warm Solar Tangerine
 * glow paired with a neutral silver counterbalance so `.glass-surface` and `.glass-mirror`
 * layers visibly refract light above both Slate-Charcoal Dark and Light Alabaster canvases.
 */
export function StudioBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* 1. Focused Solar Tangerine Top Spotlight so frosted dark glass catches crisp warmth */}
      <div className="absolute left-[-8%] top-[-14%] h-[580px] w-[580px] rounded-full bg-primary/15 blur-[130px] dark:bg-primary/[0.085]" />

      {/* 2. Cool Silver Counterbalance Halo on Opposite Diagonal */}
      <div className="absolute bottom-[-16%] right-[-10%] h-[540px] w-[540px] rounded-full bg-slate-400/20 blur-[140px] dark:bg-slate-400/[0.09]" />

      {/* 3. Crisp Cool Slate Mist Behind Center Horizon */}
      <div className="absolute left-1/2 top-[34%] h-[360px] w-[620px] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[120px] dark:bg-slate-300/[0.045]" />

      {/* 4. Architectural Orthographic Line Grid masked radially toward viewport perimeter */}
      <div
        className="absolute inset-0 opacity-[0.42] dark:opacity-[0.34]"
        style={{
          backgroundImage:
            'linear-gradient(to right, hsl(var(--border) / 0.55) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--border) / 0.55) 1px, transparent 1px)',
          backgroundSize: '72px 72px',
          maskImage:
            'radial-gradient(ellipse 80% 72% at 50% 24%, black 22%, transparent 96%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 80% 72% at 50% 24%, black 22%, transparent 96%)',
        }}
      />

      {/* 5. Fine Precision Dot Matrix Inside Primary Reading Corridor */}
      <svg
        className="absolute inset-0 h-full w-full text-slate-400/45 dark:text-white/[0.11]"
        style={{
          maskImage:
            'radial-gradient(ellipse 68% 58% at 50% 28%, black 18%, transparent 92%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 68% 58% at 50% 28%, black 18%, transparent 92%)',
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="studio-dot-matrix"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.5" cy="1.5" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#studio-dot-matrix)" />
      </svg>

      {/* 6. Large Concentric Reference Circles Framing the Workspace Stage */}
      <div className="hidden lg:block absolute left-1/2 top-[160px] h-[780px] w-[780px] -translate-x-1/2 rounded-full border border-slate-900/[0.04] dark:border-white/[0.04]" />
      <div className="hidden xl:block absolute left-1/2 top-[40px] h-[1060px] w-[1060px] -translate-x-1/2 rounded-full border border-slate-900/[0.025] dark:border-white/[0.025]" />
    </div>
  );
}
