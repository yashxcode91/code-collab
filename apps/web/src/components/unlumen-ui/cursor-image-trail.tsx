"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/lib/utils";

export interface CursorImageTrailProps {
  items: React.ReactNode[];
  /** Size of each trail item in px, or "auto" for natural chip sizing. @default 120 */
  itemSize?: number | "auto";
  /** Max simultaneous items in the trail. @default 8 */
  trailLength?: number;
  /** Minimum cursor travel (px) before spawning a new item. @default 80 */
  spawnDistance?: number;
  /** Max random rotation applied to each item in degrees. @default 20 */
  rotationRange?: number;
  /** Auto-expire each trail item after N ms so items fade smoothly on pause. */
  itemLifetimeMs?: number;
  /** Starting z-index for spawned trail items. @default 20 */
  trailZIndex?: number;
  /** Render target — defaults to the wrapper container or window. */
  containerRef?: React.RefObject<HTMLElement>;
  className?: string;
  children?: React.ReactNode;
}

interface TrailItem {
  id: number;
  x: number;
  y: number;
  rotation: number;
  itemIndex: number;
}

let _id = 0;
const nextId = () => ++_id;

export function CursorImageTrail({
  items,
  itemSize = 120,
  trailLength = 8,
  spawnDistance = 80,
  rotationRange = 20,
  itemLifetimeMs,
  trailZIndex = 20,
  containerRef,
  className,
  children,
}: CursorImageTrailProps) {
  const [trail, setTrail] = React.useState<TrailItem[]>([]);
  const lastPos = React.useRef<{ x: number; y: number } | null>(null);
  const itemCounter = React.useRef(0);
  const containerElRef = React.useRef<HTMLDivElement>(null);
  const timersRef = React.useRef<Map<number, number>>(new Map());
  const itemsRef = React.useRef(items);
  itemsRef.current = items;

  React.useEffect(() => {
    const el = containerRef?.current ?? containerElRef.current ?? window;
    const timers = timersRef.current;

    const clearAllTimers = () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };

    const onLeave = () => {
      lastPos.current = null;
      clearAllTimers();
      setTrail([]);
    };

    const onMove = (e: Event) => {
      if (itemsRef.current.length === 0) return;

      const mouseEvent = e as MouseEvent;
      const rect =
        containerRef?.current?.getBoundingClientRect() ??
        containerElRef.current?.getBoundingClientRect();

      const x = rect ? mouseEvent.clientX - rect.left : mouseEvent.clientX;
      const y = rect ? mouseEvent.clientY - rect.top : mouseEvent.clientY;

      if (lastPos.current) {
        const dx = x - lastPos.current.x;
        const dy = y - lastPos.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < spawnDistance) return;
      }

      lastPos.current = { x, y };

      const id = nextId();
      const rotation = (Math.random() * 2 - 1) * rotationRange;
      const itemIndex = itemCounter.current % itemsRef.current.length;
      itemCounter.current += 1;

      setTrail((prev) => {
        const next = [...prev, { id, x, y, rotation, itemIndex }];
        const trimmed = next.slice(-trailLength);

        // Cancel timers for any evicted older items
        const activeIds = new Set(trimmed.map((item) => item.id));
        timers.forEach((timerId, keyId) => {
          if (!activeIds.has(keyId)) {
            window.clearTimeout(timerId);
            timers.delete(keyId);
          }
        });

        return trimmed;
      });

      if (itemLifetimeMs && itemLifetimeMs > 0) {
        const timerId = window.setTimeout(() => {
          timers.delete(id);
          setTrail((prev) => prev.filter((item) => item.id !== id));
        }, itemLifetimeMs);
        timers.set(id, timerId);
      }
    };

    el.addEventListener("mousemove", onMove, { passive: true });
    el.addEventListener("mouseleave", onLeave);

    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      clearAllTimers();
    };
  }, [spawnDistance, rotationRange, trailLength, itemLifetimeMs, containerRef]);

  const total = trail.length;

  return (
    <div
      ref={containerElRef}
      className={cn("relative overflow-hidden", className)}
    >
      {children}

      <AnimatePresence>
        {trail.map((item, i) => {
          const age = total - 1 - i;
          const scale = 0.72 + 0.28 * (1 - age / Math.max(trailLength, 1));

          return (
            <motion.div
              key={item.id}
              aria-hidden="true"
              className="pointer-events-none absolute select-none will-change-transform"
              style={{
                left: item.x,
                top: item.y,
                width: itemSize === "auto" ? "auto" : itemSize,
                x: "-50%",
                y: "-50%",
                zIndex: trailZIndex + i,
              }}
              initial={{
                opacity: 0,
                scale: 0.6,
                rotate: item.rotation * 1.3,
              }}
              animate={{
                opacity: 0.9,
                scale,
                rotate: item.rotation,
              }}
              exit={{
                opacity: 0,
                scale: 0.45,
                rotate: item.rotation * 0.4,
              }}
              transition={{
                duration: 0.34,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <div className="w-full [&>img]:h-auto [&>img]:w-full [&>svg]:h-auto [&>svg]:w-full">
                {items[item.itemIndex]}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

