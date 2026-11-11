'use client';

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import gsap from 'gsap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { MotionSubtitle } from '@/components/unlumen-ui/motion-subtitle';

export interface OrbitalImageWheelProps<T> {
  /** Items displayed on the orbital deck / circle wheel. */
  items: T[];
  /** Stable React key extractor per item. */
  getKey: (item: T, index: number) => string;
  /** Short pill label shown in the centered bottom navigation track. */
  getLabel: (item: T, index: number) => string;
  /** Animated subtitle shown above the active pill bar. */
  getSubtitle?: (item: T, index: number) => string;
  /** Custom renderer for each orbital card node. */
  renderItem: (
    item: T,
    state: { index: number; isActive: boolean; distance: number },
  ) => React.ReactNode;
  /** Controlled active item index. */
  activeIndex?: number;
  /** Callback fired whenever focused item changes. */
  onActiveIndexChange?: (index: number) => void;
  /** Preferred card width (auto-clamped on narrower viewports). @default 336 */
  itemWidth?: number;
  /** Fixed card height for consistent alignment. @default 356 */
  itemHeight?: number;
  /** Horizontal spacing gap between cards. @default 26 */
  itemGap?: number;
  /** Maximum blur (px) applied to flanking out-of-focus cards. @default 1.4 */
  blur?: number;
  /** Minimum brightness (%) away from center focus. @default 78 */
  dim?: number;
  /** Minimum saturation (%) away from center focus. @default 65 */
  minSaturation?: number;
  /** Focus spread distance in slot units. @default 1.35 */
  focusSpread?: number;
  /** Scale step reduction away from center card. @default 0.09 */
  scaleEffect?: number;
  /** Shows animated subtitle & centered clickable pill bar below wheel. @default true */
  showCaption?: boolean;
  /** Subtitle animation direction. @default "top" */
  subtitleDirection?: 'top' | 'bottom';
  /** Subtitle animation speed multiplier. @default 1.15 */
  subtitleSpeed?: number;
  /** Per-character reveal delay in seconds. @default 0.012 */
  subtitleStagger?: number;
  className?: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function positiveMod(value: number, modulus: number): number {
  if (modulus <= 0) return 0;
  return ((value % modulus) + modulus) % modulus;
}

function shortestCircularDelta(
  target: number,
  current: number,
  modulus: number,
): number {
  if (modulus <= 0) return 0;
  const raw = positiveMod(target - current, modulus);
  return raw > modulus / 2 ? raw - modulus : raw;
}

/**
 * Adaptive Unlumen Horizontal Orbital Carousel (`@unlumen-ui/orbital-image-wheel` focus physics):
 * - **1 workspace:** Single centered upright card.
 * - **2 workspaces:** Symmetrical centered pair on wide stages (single-card fallback on mobile).
 * - **3+ workspaces:** Straight horizontal (`y = 0`, `rotate = 0`) infinite carousel loop that
 *   always opens centered with both left and right wings populated, GSAP depth blur/scale/dimming
 *   on flanking cards, animated `<MotionSubtitle />`, and a GSAP `quickTo` centered pill track.
 */
export function OrbitalImageWheel<T>({
  items,
  getKey,
  getLabel,
  getSubtitle,
  renderItem,
  activeIndex: controlledActiveIndex,
  onActiveIndexChange,
  itemWidth = 336,
  itemHeight = 356,
  itemGap = 26,
  blur = 1.4,
  dim = 78,
  minSaturation = 65,
  focusSpread = 1.35,
  scaleEffect = 0.09,
  showCaption = true,
  subtitleDirection = 'top',
  subtitleSpeed = 1.15,
  subtitleStagger = 0.012,
  className,
}: OrbitalImageWheelProps<T>) {
  const stageRef = useRef<HTMLDivElement>(null);
  const titleViewportRef = useRef<HTMLDivElement>(null);
  const titleTrackRef = useRef<HTMLDivElement>(null);
  const titleStartSpacerRef = useRef<HTMLSpanElement>(null);
  const titleEndSpacerRef = useRef<HTMLSpanElement>(null);
  const titleTrackXToRef = useRef<((value: number) => void) | null>(null);

  const virtualSlotRef = useRef(0);
  const phaseStateRef = useRef({ value: 0 });
  const wheelLockUntilRef = useRef(0);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const prevTopologyRef = useRef<{ identity: string; circle: boolean } | null>(
    null,
  );

  const reducedMotion = useReducedMotion();
  const [internalIndex, setInternalIndex] = useState(0);
  const [stageWidth, setStageWidth] = useState(1040);
  const [titleViewportWidth, setTitleViewportWidth] = useState(760);

  const count = items.length;
  const maxIndex = Math.max(0, count - 1);
  const rawActiveIndex =
    controlledActiveIndex !== undefined ? controlledActiveIndex : internalIndex;
  const safeActiveIndex = clamp(rawActiveIndex, 0, maxIndex);

  const isCircularLoop = count >= 3;
  // Ensure enough virtual slots (>= 9) so endless horizontal wrapping never pops inside wide viewports
  const wheelRepeats = isCircularLoop ? Math.ceil(9 / count) : 1;
  const totalSlots = count * wheelRepeats;

  // Measure container width responsively
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const update = () => {
      setStageWidth(stage.clientWidth || 1040);
      if (titleViewportRef.current) {
        setTitleViewportWidth(titleViewportRef.current.clientWidth || 760);
      }
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(stage);
    if (titleViewportRef.current) {
      observer.observe(titleViewportRef.current);
    }
    return () => observer.disconnect();
  }, [count]);

  const resolvedWidth = clamp(
    Math.min(itemWidth, stageWidth - (stageWidth < 520 ? 36 : 96)),
    256,
    460,
  );
  const resolvedHeight = clamp(itemHeight, 240, 520);
  const resolvedGap = stageWidth < 520 ? Math.min(itemGap, 14) : itemGap;
  const cardStep = resolvedWidth + resolvedGap;

  // 2 workspaces center cleanly as a balanced pair on wide stages
  const centerPairOnStage =
    count === 2 && stageWidth >= resolvedWidth * 2 + resolvedGap + 24;

  const itemsIdentity = useMemo(
    () => items.map((item, i) => getKey(item, i)).join('|'),
    [getKey, items],
  );

  // Build virtual horizontal carousel nodes so 3+ items loop seamlessly left/right along y = 0
  const wheelSlots = useMemo(() => {
    if (count === 0) return [];
    return Array.from({ length: totalSlots }, (_, slotIndex) => {
      const itemIndex = slotIndex % count;
      return {
        slotIndex,
        itemIndex,
        item: items[itemIndex]!,
        key: isCircularLoop
          ? `${getKey(items[itemIndex]!, itemIndex)}__slot_${slotIndex}`
          : getKey(items[itemIndex]!, itemIndex),
      };
    });
  }, [count, getKey, isCircularLoop, items, totalSlots]);

  const selectLogicalIndex = useCallback(
    (nextLogical: number) => {
      const wrapped = isCircularLoop
        ? positiveMod(nextLogical, count)
        : clamp(nextLogical, 0, maxIndex);
      if (controlledActiveIndex === undefined) {
        setInternalIndex(wrapped);
      }
      onActiveIndexChange?.(wrapped);
    },
    [controlledActiveIndex, count, isCircularLoop, maxIndex, onActiveIndexChange],
  );

  const stepBy = useCallback(
    (delta: number) => {
      if (count <= 1 || delta === 0) return;
      if (isCircularLoop) {
        const nextVirtual = virtualSlotRef.current + delta;
        virtualSlotRef.current = nextVirtual;
        selectLogicalIndex(positiveMod(nextVirtual, count));
      } else {
        const next = clamp(safeActiveIndex + delta, 0, maxIndex);
        virtualSlotRef.current = next;
        selectLogicalIndex(next);
      }
    },
    [count, isCircularLoop, maxIndex, safeActiveIndex, selectLogicalIndex],
  );

  const applyOrbitalPhase = useCallback(
    (phase: number) => {
      const stage = stageRef.current;
      if (!stage) return;

      const cards = stage.querySelectorAll<HTMLElement>('[data-oiw-slot]');
      const safeSpread = Math.max(0.45, focusSpread);

      cards.forEach((card) => {
        const slotAttr = card.getAttribute('data-oiw-slot');
        const slotIndex = slotAttr ? Number.parseInt(slotAttr, 10) : 0;

        if (isCircularLoop) {
          const slotDelta = shortestCircularDelta(slotIndex, phase, totalSlots);
          const absD = Math.abs(slotDelta);
          const focusIntensity = clamp(absD / safeSpread, 0, 1);

          // Dead-level straight horizontal track (`y = 0`, `rotate = 0`)
          const x = slotDelta * cardStep;
          const currentScale = clamp(
            1 - Math.min(2.2, absD) * scaleEffect,
            0.74,
            1,
          );
          const currentOpacity =
            absD > 2.65
              ? 0
              : clamp(
                  1 -
                    focusIntensity * 0.36 -
                    Math.max(0, absD - 1.35) * 0.48,
                  0,
                  1,
                );

          const isSettledCenter = absD < 0.015;
          const currentBlur = focusIntensity * blur;
          const currentBrightness =
            dim + (1 - focusIntensity) * (100 - dim);
          const currentSaturation =
            minSaturation + (1 - focusIntensity) * (100 - minSaturation);
          const zIndex = 40 - Math.round(Math.min(39, absD * 12));

          gsap.set(card, {
            x,
            y: 0,
            xPercent: -50,
            yPercent: -50,
            rotate: 0,
            scale: currentScale,
            opacity: currentOpacity,
            visibility: currentOpacity <= 0.01 ? 'hidden' : 'visible',
            pointerEvents: absD <= 2.15 ? 'auto' : 'none',
            filter: isSettledCenter
              ? 'none'
              : `blur(${currentBlur.toFixed(2)}px) brightness(${currentBrightness.toFixed(1)}%) saturate(${currentSaturation.toFixed(1)}%)`,
            zIndex,
          });
          return;
        }

        // 1 or 2 workspaces: centered horizontal stage
        const focusDelta = slotIndex - phase;
        const absD = Math.abs(focusDelta);
        const focusIntensity = clamp(absD / safeSpread, 0, 1);
        const layoutDelta = centerPairOnStage ? slotIndex - 0.5 : focusDelta;
        const x = layoutDelta * cardStep;
        const currentScale = centerPairOnStage
          ? clamp(1 - Math.min(1, absD) * 0.04, 0.94, 1)
          : clamp(1 - Math.min(2.2, absD) * scaleEffect, 0.76, 1);
        const currentOpacity = centerPairOnStage
          ? clamp(1 - Math.min(1, absD) * 0.14, 0.82, 1)
          : clamp(1 - focusIntensity * 0.42, 0.28, 1);
        const zIndex = 30 - Math.round(Math.min(29, absD * 10));

        gsap.set(card, {
          x,
          y: 0,
          xPercent: -50,
          yPercent: -50,
          rotate: 0,
          scale: currentScale,
          opacity: currentOpacity,
          visibility: 'visible',
          pointerEvents: 'auto',
          filter: 'none',
          zIndex,
        });
      });
    },
    [
      blur,
      cardStep,
      centerPairOnStage,
      dim,
      focusSpread,
      isCircularLoop,
      minSaturation,
      scaleEffect,
      totalSlots,
    ],
  );

  // Sync continuous horizontal loop phase cleanly with active logical index
  useLayoutEffect(() => {
    if (count === 0) return;

    const tweenTarget = phaseStateRef.current;
    gsap.killTweensOf(tweenTarget);

    const prevTopology = prevTopologyRef.current;
    const topologyChanged =
      !prevTopology ||
      prevTopology.identity !== itemsIdentity ||
      prevTopology.circle !== isCircularLoop;
    prevTopologyRef.current = {
      identity: itemsIdentity,
      circle: isCircularLoop,
    };

    if (topologyChanged) {
      virtualSlotRef.current = safeActiveIndex;
      tweenTarget.value = safeActiveIndex;
      applyOrbitalPhase(safeActiveIndex);
      return;
    }

    if (isCircularLoop) {
      const currentMod = positiveMod(virtualSlotRef.current, count);
      if (currentMod !== safeActiveIndex) {
        const delta = shortestCircularDelta(
          safeActiveIndex,
          currentMod,
          count,
        );
        virtualSlotRef.current += delta;
      }
    } else {
      virtualSlotRef.current = safeActiveIndex;
    }

    const targetPhase = virtualSlotRef.current;
    applyOrbitalPhase(tweenTarget.value);

    gsap.to(tweenTarget, {
      value: targetPhase,
      duration: reducedMotion ? 0 : 0.56,
      ease: 'power3.out',
      overwrite: true,
      onUpdate: () => applyOrbitalPhase(tweenTarget.value),
      onComplete: () => applyOrbitalPhase(targetPhase),
    });

    return () => {
      gsap.killTweensOf(tweenTarget);
    };
  }, [
    applyOrbitalPhase,
    count,
    isCircularLoop,
    itemsIdentity,
    reducedMotion,
    safeActiveIndex,
  ]);

  // Center active workspace pill inside bottom pill track using `gsap.quickTo`
  const titleLabels = useMemo(
    () => items.map((item, i) => getLabel(item, i)),
    [getLabel, items],
  );

  useEffect(() => {
    titleTrackXToRef.current = null;
  }, [reducedMotion]);

  useLayoutEffect(() => {
    const viewport = titleViewportRef.current;
    const track = titleTrackRef.current;
    const startSpacer = titleStartSpacerRef.current;
    const endSpacer = titleEndSpacerRef.current;
    if (!viewport || !track || titleLabels.length === 0) return;

    if (!titleTrackXToRef.current) {
      titleTrackXToRef.current = gsap.quickTo(track, 'x', {
        duration: reducedMotion ? 0 : 0.52,
        ease: 'power4.out',
        overwrite: true,
      });
    }

    const firstTitle = track.querySelector<HTMLElement>('[data-title-index="0"]');
    const lastTitle = track.querySelector<HTMLElement>(
      `[data-title-index="${titleLabels.length - 1}"]`,
    );
    const activeTitle = track.querySelector<HTMLElement>(
      `[data-title-index="${safeActiveIndex}"]`,
    );
    if (!firstTitle || !lastTitle || !activeTitle) return;

    const viewportW = viewport.clientWidth;
    const startPad = Math.max(0, viewportW / 2 - firstTitle.offsetWidth / 2);
    const endPad = Math.max(0, viewportW / 2 - lastTitle.offsetWidth / 2);

    if (startSpacer) startSpacer.style.width = `${Math.round(startPad)}px`;
    if (endSpacer) endSpacer.style.width = `${Math.round(endPad)}px`;

    const activeCenter = activeTitle.offsetLeft + activeTitle.offsetWidth / 2;
    let targetX = Math.round(viewportW / 2 - activeCenter);

    if (track.scrollWidth <= viewportW) {
      targetX = Math.round((viewportW - track.scrollWidth) / 2);
    } else {
      const minX = viewportW - track.scrollWidth;
      targetX = Math.round(clamp(targetX, minX, 0));
    }

    titleTrackXToRef.current(targetX);
  }, [
    itemsIdentity,
    reducedMotion,
    safeActiveIndex,
    titleLabels,
    titleViewportWidth,
  ]);

  // Step cleanly on horizontal trackpad gesture without blocking normal vertical scroll
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (count <= 1) return;
      const horizontalIntent =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.shiftKey
            ? event.deltaY
            : 0;
      if (Math.abs(horizontalIntent) < 18) return;

      const now = performance.now();
      if (now < wheelLockUntilRef.current) return;
      wheelLockUntilRef.current = now + 320;

      stepBy(horizontalIntent > 0 ? 1 : -1);
    },
    [count, stepBy],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || count <= 1) return;
      dragStartRef.current = { x: event.clientX, y: event.clientY };
    },
    [count],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const start = dragStartRef.current;
      dragStartRef.current = null;
      if (!start || count <= 1) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        stepBy(dx < 0 ? 1 : -1);
      }
    },
    [count, stepBy],
  );

  if (count === 0) return null;

  const activeItem = items[safeActiveIndex] ?? items[0]!;
  const activeSubtitle = getSubtitle
    ? getSubtitle(activeItem, safeActiveIndex)
    : undefined;
  const activeWheelSlot = isCircularLoop
    ? positiveMod(virtualSlotRef.current, totalSlots)
    : safeActiveIndex;
  const stageHeight = resolvedHeight + 16;

  return (
    <div
      className={cn('space-y-4 select-none', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          stepBy(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          stepBy(-1);
        }
      }}
    >
      {/* Straight Horizontal Orbital Stage (centered pair for 1–2; endless horizontal loop for 3+) */}
      <div
        ref={stageRef}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => {
          dragStartRef.current = null;
        }}
        className="relative w-full overflow-hidden"
        style={{
          height: stageHeight,
          WebkitMaskImage:
            isCircularLoop && stageWidth >= 560
              ? 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)'
              : undefined,
          maskImage:
            isCircularLoop && stageWidth >= 560
              ? 'linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)'
              : undefined,
        }}
        aria-roledescription="carousel"
        aria-label="Straight horizontal orbital workspace carousel"
      >
        {/* Subtle flat horizontal horizon rail behind cards */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-border/80 to-transparent"
        />

        {wheelSlots.map(({ slotIndex, itemIndex, item, key }) => {
          const isSlotActive = slotIndex === activeWheelSlot;
          const signedDelta = isCircularLoop
            ? shortestCircularDelta(
                slotIndex,
                virtualSlotRef.current,
                totalSlots,
              )
            : slotIndex - safeActiveIndex;

          return (
            <div
              key={key}
              data-oiw-slot={slotIndex}
              onClickCapture={(event) => {
                const currentSlot = isCircularLoop
                  ? positiveMod(Math.round(virtualSlotRef.current), totalSlots)
                  : safeActiveIndex;
                if (slotIndex !== currentSlot) {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isCircularLoop) {
                    const liveDelta = shortestCircularDelta(
                      slotIndex,
                      currentSlot,
                      totalSlots,
                    );
                    stepBy(liveDelta);
                  } else {
                    stepBy(itemIndex - safeActiveIndex);
                  }
                }
              }}
              className={cn(
                'absolute left-1/2 top-1/2 origin-center will-change-transform',
                !isSlotActive && 'cursor-pointer',
              )}
              style={{
                width: resolvedWidth,
                height: resolvedHeight,
              }}
            >
              {renderItem(item, {
                index: itemIndex,
                isActive: isSlotActive,
                distance: signedDelta,
              })}
            </div>
          );
        })}
      </div>

      {/* Unlumen MotionSubtitle + Centered GSAP Pill Navigation Track */}
      {showCaption && (
        <div className="space-y-2.5 text-center">
          {activeSubtitle && (
            <div className="px-4">
              <MotionSubtitle
                text={activeSubtitle}
                direction={subtitleDirection}
                speed={subtitleSpeed}
                stagger={subtitleStagger}
                className="font-mono text-[11px] tracking-wide text-muted-foreground"
              />
            </div>
          )}

          <div className="mx-auto flex max-w-3xl items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => stepBy(-1)}
              disabled={!isCircularLoop && safeActiveIndex <= 0}
              aria-label="Previous workspace"
              className="glass-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:border-primary/45 hover:text-primary disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>

            <div
              ref={titleViewportRef}
              className="w-full overflow-hidden py-1"
              style={{
                WebkitMaskImage:
                  count > 2
                    ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                    : undefined,
                maskImage:
                  count > 2
                    ? 'linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)'
                    : undefined,
              }}
            >
              <div ref={titleTrackRef} className="flex w-max items-center">
                <span
                  ref={titleStartSpacerRef}
                  aria-hidden
                  className="block h-px shrink-0"
                />

                {titleLabels.map((title, i) => {
                  const dist = isCircularLoop
                    ? Math.abs(
                        shortestCircularDelta(i, safeActiveIndex, count),
                      )
                    : Math.abs(i - safeActiveIndex);
                  const pillActive = i === safeActiveIndex;
                  return (
                    <button
                      key={`${getKey(items[i]!, i)}-pill`}
                      type="button"
                      data-title-index={i}
                      onClick={() => {
                        if (isCircularLoop) {
                          const delta = shortestCircularDelta(
                            i,
                            safeActiveIndex,
                            count,
                          );
                          stepBy(delta);
                        } else {
                          stepBy(i - safeActiveIndex);
                        }
                      }}
                      aria-current={pillActive ? 'true' : undefined}
                      style={{
                        opacity:
                          dist === 0
                            ? 1
                            : dist === 1
                              ? 0.68
                              : dist === 2
                                ? 0.42
                                : 0.24,
                        transform: pillActive ? 'scale(1)' : 'scale(0.95)',
                      }}
                      className={cn(
                        'glass-control mr-2 inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 font-mono text-xs transition-[opacity,transform,color,border-color] duration-200',
                        pillActive
                          ? 'border-primary/50 bg-primary/15 font-semibold text-primary'
                          : 'text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                      )}
                    >
                      {title}
                    </button>
                  );
                })}

                <span
                  ref={titleEndSpacerRef}
                  aria-hidden
                  className="block h-px shrink-0"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => stepBy(1)}
              disabled={!isCircularLoop && safeActiveIndex >= maxIndex}
              aria-label="Next workspace"
              className="glass-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:border-primary/45 hover:text-primary disabled:pointer-events-none disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrbitalImageWheel;
