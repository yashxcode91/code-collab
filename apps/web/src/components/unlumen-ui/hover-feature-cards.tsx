"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Configuration model for an interactive starter-template / feature card.
 * Extended from Unlumen UI's registry component to support inline TSX code previews
 * (`preview`), badges, icons, metadata, and click handlers alongside links.
 */
export interface HoverFeatureCard {
  name: string;
  description: string;
  badge?: string;
  meta?: string;
  icon?: React.ReactNode;
  preview?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  img?: string;
  imgLight?: string;
  imgClassName?: string;
  imgWidth?: number;
  containerClassName?: string;
  glowClassName?: string;
  fadeBottom?: boolean;
  soon?: boolean;
}

export interface HoverFeatureCardsProps {
  items: HoverFeatureCard[];
  className?: string;
  renderLink?: (href: string, children: React.ReactNode) => React.ReactNode;
}

/**
 * Single kinetic feature/template card with a spring-loaded glass drawer underneath.
 * - Top card sits at `z-[5]` (Tailwind v3 bracket notation) using `.glass-surface`.
 * - Hidden description drawer rests beneath at `z-[1]` (`opacity: 0, y: -32`) and
 *   glides smoothly down to `y: 0` when hovered or keyboard-focused.
 */
function HoverFeatureCard({
  item,
  renderLink,
}: {
  item: HoverFeatureCard;
  renderLink?: HoverFeatureCardsProps["renderLink"];
}) {
  const isInteractive = Boolean((item.href || item.onClick) && !item.soon);

  // Allow Enter / Space keys to activate clickable template cards for keyboard users
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!item.onClick || item.soon) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      item.onClick();
    }
  };

  const inner = (
    <motion.div
      initial="rest"
      whileHover="hover"
      whileFocus="hover"
      animate="rest"
      whileTap={isInteractive ? { scale: 0.985 } : undefined}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      variants={{ rest: { scale: 1, y: 0 } }}
      onClick={!item.soon ? item.onClick : undefined}
      onKeyDown={handleKeyDown}
      role={item.onClick && !item.href ? "button" : undefined}
      tabIndex={item.onClick && !item.soon ? 0 : undefined}
      aria-label={item.onClick ? `${item.name}: ${item.description}` : undefined}
      className={cn(
        "group relative flex w-full flex-col text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-3xl",
        item.soon
          ? "cursor-not-allowed opacity-75"
          : isInteractive
            ? "cursor-pointer"
            : "",
      )}
    >
      {/* Front Studio Glass Tile (`z-[5]` keeps it layered above the sliding drawer at `z-[1]`) */}
      <div
        className={cn(
          "glass-surface relative z-[5] flex h-48 w-full flex-col overflow-hidden rounded-3xl transition-all duration-200",
          isInteractive && "group-hover:border-primary/45",
          item.soon && "border-dashed",
        )}
      >
        {/* Subtle per-card radial accent glow tucked behind card content */}
        {item.glowClassName && (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-2xl opacity-55 transition-opacity duration-300 group-hover:opacity-90",
              item.glowClassName,
            )}
          />
        )}

        <div
          className={cn(
            "relative flex h-full w-full flex-col justify-between overflow-hidden px-5 pt-5 pb-4",
            item.containerClassName,
          )}
        >
          {/* Card Header Row: Icon + Title + Optional Badge / Coming Soon Pill */}
          <div className="relative z-10 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              {item.icon && (
                <div className="glass-control flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                  {item.icon}
                </div>
              )}
              <div className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-base font-semibold tracking-tight",
                    item.soon ? "text-muted-foreground/80" : "text-foreground",
                  )}
                >
                  {item.name}
                </span>
                {item.meta && (
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {item.meta}
                  </span>
                )}
              </div>
            </div>

            {item.soon ? (
              <span className="glass-control shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                Coming soon
              </span>
            ) : (
              item.badge && (
                <span className="glass-control shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground group-hover:border-primary/35 group-hover:text-primary">
                  {item.badge}
                </span>
              )
            )}
          </div>

          {/* Optional Custom TSX Code Preview OR Upstream Light/Dark Image */}
          {item.preview ? (
            <div className="relative z-10 mt-2.5">{item.preview}</div>
          ) : (
            <>
              {item.img && (
                <img
                  src={item.img}
                  alt={item.name}
                  width={item.imgWidth ?? 200}
                  height={200}
                  className={cn("hidden h-auto dark:block", item.imgClassName)}
                />
              )}
              {(item.imgLight ?? item.img) && (
                <img
                  src={item.imgLight ?? item.img}
                  alt={item.name}
                  width={item.imgWidth ?? 200}
                  height={200}
                  className={cn("h-auto dark:hidden", item.imgClassName)}
                />
              )}
            </>
          )}

          {item.fadeBottom && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-background/55 to-transparent" />
          )}
        </div>
      </div>

      {/* Spring-Loaded Glass Reveal Drawer sliding down beneath the top card */}
      <motion.div
        variants={{
          rest: { opacity: 0, y: -32 },
          hover: { opacity: 1, y: 0 },
        }}
        transition={{ type: "spring", stiffness: 220, damping: 18 }}
        className="pointer-events-none relative z-[1] -mt-3 w-[92%] self-center overflow-hidden"
      >
        <div className="glass-surface relative rounded-b-2xl border-t-0 px-4 pb-3.5 pt-5">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
          {isInteractive && (
            <span className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] font-medium text-primary">
              <span>Use template</span>
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );

  if (item.href && renderLink) {
    return renderLink(item.href, inner);
  }

  return inner;
}

/** Responsive grid container rendering starter-template / feature reveal cards. */
function HoverFeatureCards({
  items,
  className,
  renderLink,
}: HoverFeatureCardsProps) {
  return (
    <div
      className={cn("grid w-full grid-cols-1 gap-4 sm:grid-cols-2", className)}
    >
      {items.map((item) => (
        <HoverFeatureCard key={item.name} item={item} renderLink={renderLink} />
      ))}
    </div>
  );
}

export { HoverFeatureCards, HoverFeatureCard };
