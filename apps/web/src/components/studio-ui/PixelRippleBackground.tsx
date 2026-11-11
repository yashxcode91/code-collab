import { useEffect, useRef } from 'react';

interface PixelRippleBackgroundProps {
  /** Spacing in CSS pixels between grid dots. @default 18 */
  gap?: number;
  /** Diameter/side length of each crisp square pixel dot in CSS pixels. @default 2.5 */
  pixelSize?: number;
  className?: string;
}

interface RippleWave {
  x: number;
  y: number;
  startTime: number;
  maxRadius: number;
  strength: number;
}

const DEFAULT_STUDIO_RGB = '249, 115, 22';

/**
 * Interactive HiDPI `<canvas>` background rendering an architectural dot matrix
 * that emits luminous Solar Tangerine shockwaves on pointer hover or click.
 *
 * Engineering highlights:
 * - **Crisp HiDPI Scaling:** Caps `devicePixelRatio` at `2` to stay sharp on Retina displays
 *   without paying 9x fill-rate cost on ultra-dense screens.
 * - **Reactive Theme Sync:** Reads `--studio-rgb` from `document.documentElement` via a
 *   `MutationObserver` so light/dark toggles re-tint ripples instantaneously.
 * - **Idle-Stop Loop:** Runs `requestAnimationFrame` only while waves are actively propagating,
 *   dropping to `0%` GPU/CPU idle overhead once ripples settle back to baseline.
 * - **Parent Event Binding:** Listens on `canvas.parentElement` so callers can keep `pointer-events-none`
 *   on the canvas while pointer movement anywhere inside the Hero Banner triggers waves.
 */
export function PixelRippleBackground({
  gap = 18,
  pixelSize = 2.5,
  className = '',
}: PixelRippleBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let studioRgb = DEFAULT_STUDIO_RGB;
    let isDark = document.documentElement.classList.contains('dark');
    let rafId: number | null = null;
    let lastMoveSpawn = 0;
    const waves: RippleWave[] = [];

    // Sync active theme (`isDark`) and Solar Tangerine RGB triplet from CSS custom properties
    const readThemeTokens = () => {
      const root = document.documentElement;
      isDark = root.classList.contains('dark');
      const raw = getComputedStyle(root)
        .getPropertyValue('--studio-rgb')
        .trim();
      if (raw) {
        studioRgb = raw;
      }
    };

    const drawFrame = (now: number) => {
      if (width <= 0 || height <= 0) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      // Cull expired waves after their wavefront finishes fading past maxRadius + band tail
      const waveSpeed = 0.24; // px/ms
      const bandWidth = 58;
      for (let i = waves.length - 1; i >= 0; i -= 1) {
        const elapsed = now - waves[i]!.startTime;
        if (elapsed * waveSpeed > waves[i]!.maxRadius + bandWidth) {
          waves.splice(i, 1);
        }
      }

      const baseDotColor = isDark
        ? 'rgba(255, 255, 255, 0.085)'
        : 'rgba(15, 23, 42, 0.08)';

      const half = pixelSize / 2;

      for (let py = gap * 0.5; py < height; py += gap) {
        for (let px = gap * 0.5; px < width; px += gap) {
          let energy = 0;

          for (let w = 0; w < waves.length; w += 1) {
            const wave = waves[w]!;
            const radius = (now - wave.startTime) * waveSpeed;
            const dist = Math.hypot(px - wave.x, py - wave.y);
            const bandDelta = Math.abs(dist - radius);

            if (bandDelta < bandWidth) {
              const ringProfile = 1 - bandDelta / bandWidth;
              const distanceDecay = Math.max(0, 1 - radius / wave.maxRadius);
              energy = Math.max(
                energy,
                ringProfile * ringProfile * distanceDecay * wave.strength,
              );
            }
          }

          if (energy > 0.02) {
            // Luminous Solar Tangerine surge scaled gently in size and alpha
            const boost = pixelSize + energy * 2.2;
            const offset = boost / 2;
            ctx.fillStyle = `rgba(${studioRgb}, ${Math.min(0.85, 0.16 + energy * 0.68)})`;
            ctx.fillRect(px - offset, py - offset, boost, boost);
          } else {
            ctx.fillStyle = baseDotColor;
            ctx.fillRect(px - half, py - half, pixelSize, pixelSize);
          }
        }
      }

      // Stop loop immediately once all waves finish propagating cleanly
      if (waves.length > 0 && !reducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame);
      } else {
        rafId = null;
      }
    };

    const ensureLoopRunning = () => {
      if (reducedMotion || rafId !== null) return;
      rafId = window.requestAnimationFrame(drawFrame);
    };

    const spawnWave = (x: number, y: number, strength: number, maxR: number) => {
      if (reducedMotion) return;
      // Keep burst queue bounded so rapid trackpad sweeps stay silky 60fps
      if (waves.length >= 6) {
        waves.shift();
      }
      waves.push({
        x,
        y,
        startTime: performance.now(),
        maxRadius: maxR,
        strength,
      });
      ensureLoopRunning();
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      drawFrame(performance.now());
    };

    const handlePointerMove = (event: PointerEvent) => {
      const now = performance.now();
      // Throttle ambient hover ripples to ~110ms intervals
      if (now - lastMoveSpawn < 110) return;
      lastMoveSpawn = now;
      const rect = host.getBoundingClientRect();
      spawnWave(
        event.clientX - rect.left,
        event.clientY - rect.top,
        0.55,
        240,
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      spawnWave(
        event.clientX - rect.left,
        event.clientY - rect.top,
        0.95,
        360,
      );
    };

    readThemeTokens();
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    const themeObserver = new MutationObserver(() => {
      readThemeTokens();
      drawFrame(performance.now());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    if (!reducedMotion) {
      host.addEventListener('pointermove', handlePointerMove, {
        passive: true,
      });
      host.addEventListener('pointerdown', handlePointerDown, {
        passive: true,
      });
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      host.removeEventListener('pointermove', handlePointerMove);
      host.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [gap, pixelSize]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
