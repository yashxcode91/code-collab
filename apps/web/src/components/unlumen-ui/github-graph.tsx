"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Added `"tangerine"` alongside Unlumen UI's built-in colorways so activity heatmaps
 * share CodeCollab's single Solar Tangerine studio accent cleanly in both themes.
 */
export type GithubGraphVariant =
  | "github"
  | "graphite"
  | "ocean"
  | "violet"
  | "tangerine";
export type GithubGraphAnimation = "none" | "wave" | "scan" | "cascade";
export type GithubGraphAmbientEffect = "none" | "tide" | "drift" | "twinkle";

export type GithubContribution = {
  date: string;
  count: number;
  level?: number;
};

export type GithubContributionCell = GithubContribution & {
  level: number;
};

export type GithubContributionWeek = GithubContributionCell[];

/** Aggregate metrics derived from the active contribution calendar window. */
export interface GithubGraphSummary {
  totalContributions: number;
  activeDays: number;
  currentStreak: number;
  peakCount: number;
  peakDate: string | null;
}

export interface GithubGraphProps {
  /** GitHub username, with or without a leading @. @default "shadcn" */
  account?: string;
  /** Number of recent calendar months to display. @default 6 */
  months?: number;
  /** Color treatment for contribution levels. @default "tangerine" */
  variant?: GithubGraphVariant;
  /** Entrance choreography for graph cells. Use "none" to render immediately. @default "wave" */
  animation?: GithubGraphAnimation;
  /** Animation multiplier; higher values reveal the graph faster. @default 1 */
  animationSpeed?: number;
  /** Size of each contribution cell in pixels. @default 18 */
  cellSize?: number;
  /** Space between contribution cells in pixels. @default 4 */
  cellGap?: number;
  /** Corner radius of contribution cells in pixels. @default 3 */
  cellRadius?: number;
  /** Fills the available width with a responsive grid instead of fixed seven-day columns. @default false */
  autoFit?: boolean;
  /** Shows the contribution-level legend. @default false */
  showLegend?: boolean;
  /** Shows the account name above the graph. @default true */
  showAccount?: boolean;
  /** Persistent, subtle motion pattern applied to graph cells. @default "twinkle" */
  ambientEffect?: GithubGraphAmbientEffect;
  /** Strength of the persistent cell motion. @default 0.65 */
  ambientIntensity?: number;
  /** Optional preloaded contributions, which bypass the public fetch. */
  data?: GithubContribution[];
  /** Forces the pulse loading skeleton (e.g., while resolving a linked OAuth login). @default false */
  loading?: boolean;
  /** Invoked whenever the rendered window metrics finish loading or reset. */
  onSummaryChange?: (summary: GithubGraphSummary | null) => void;
  className?: string;
}

type ResourceState =
  | { status: "loading" }
  | { status: "ready"; contributions: GithubContribution[] }
  | { status: "error"; message: string };

const CONTRIBUTIONS_ENDPOINT =
  "https://github-contributions-api.jogruber.de/v4";

// Light-theme color ramps: translucent slate zero-well advancing into vibrant level 1–4 hues
const VARIANTS: Record<
  GithubGraphVariant,
  [string, string, string, string, string]
> = {
  github: ["rgba(15, 23, 42, 0.065)", "#9be9a8", "#40c463", "#30a14e", "#216e39"],
  graphite: ["rgba(15, 23, 42, 0.065)", "#d4d4d8", "#a1a1aa", "#52525b", "#18181b"],
  ocean: ["rgba(15, 23, 42, 0.065)", "#b4e2ff", "#62bdf5", "#2585d8", "#124e93"],
  violet: ["rgba(15, 23, 42, 0.065)", "#dcc5ff", "#b486ff", "#8355df", "#52269c"],
  tangerine: [
    "rgba(15, 23, 42, 0.065)",
    "#fed7aa",
    "#fdba74",
    "#f97316",
    "#c2410c",
  ],
};

// Dark-theme color ramps: translucent obsidian glass zero-well (`0`) advancing to luminous accents
const DARK_VARIANTS: Record<
  GithubGraphVariant,
  [string, string, string, string, string]
> = {
  github: ["rgba(255, 255, 255, 0.065)", "#0e4429", "#006d32", "#26a641", "#39d353"],
  graphite: ["rgba(255, 255, 255, 0.065)", "#3f3f46", "#71717a", "#a1a1aa", "#f4f4f5"],
  ocean: ["rgba(255, 255, 255, 0.065)", "#0c4a6e", "#0284c7", "#38bdf8", "#7dd3fc"],
  violet: ["rgba(255, 255, 255, 0.065)", "#3b0764", "#6b21a8", "#9333ea", "#c084fc"],
  tangerine: [
    "rgba(255, 255, 255, 0.085)",
    "#7c2d12",
    "#c2410c",
    "#f97316",
    "#fb923c",
  ],
};

/**
 * Watches `<html class="dark">` with a `MutationObserver` so Contribution cells swap
 * immediately between Light Alabaster and Dark Obsidian color ramps on theme toggle.
 */
function useIsDarkTheme(): boolean {
  const [isDark, setIsDark] = React.useState(() =>
    typeof document !== "undefined"
      ? document.documentElement.classList.contains("dark")
      : false,
  );

  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.classList.contains("dark"));
    sync();

    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function dateFromISO(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function fallbackLevel(count: number, maxCount: number): number {
  if (!Number.isFinite(count) || count <= 0 || maxCount <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

/** Returns a valid GitHub handle without its optional @ prefix. */
export function normalizeGithubAccount(account: string): string | null {
  const normalized = account.trim().replace(/^@+/, "");
  return /^(?!-)[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(normalized)
    ? normalized
    : null;
}

/** Builds Sunday-first calendar columns and fills missing dates with level zero. */
export function buildContributionWeeks(
  contributions: GithubContribution[],
): GithubContributionWeek[] {
  const valid = contributions
    .map((item) => ({ ...item, parsedDate: dateFromISO(item.date) }))
    .filter(
      (item): item is GithubContribution & { parsedDate: Date } =>
        item.parsedDate !== null && Number.isFinite(item.count),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (valid.length === 0) return [];

  const maxCount = Math.max(0, ...valid.map((item) => item.count));
  const byDate = new Map(valid.map((item) => [item.date, item]));
  const firstDate = valid[0]!.parsedDate;
  const lastDate = valid[valid.length - 1]!.parsedDate;
  const startDate = addDays(firstDate, -firstDate.getUTCDay());
  const endDate = addDays(lastDate, 6 - lastDate.getUTCDay());
  const cells: GithubContributionCell[] = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    const key = isoDate(date);
    const contribution = byDate.get(key);
    const count = Math.max(0, contribution?.count ?? 0);
    const explicitLevel = contribution?.level;
    const level =
      Number.isInteger(explicitLevel) &&
      explicitLevel! >= 0 &&
      explicitLevel! <= 4
        ? count === 0
          ? 0
          : explicitLevel!
        : fallbackLevel(count, maxCount);

    cells.push({ date: key, count, level });
  }

  return Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) =>
    cells.slice(index * 7, index * 7 + 7),
  );
}

/** Filters contributions down to the trailing `months` calendar window (1–12). */
function selectRecentContributions(
  contributions: GithubContribution[],
  months: number,
): GithubContribution[] {
  const parsed = contributions
    .map((contribution) => ({
      contribution,
      date: dateFromISO(contribution.date),
    }))
    .filter(
      (item): item is { contribution: GithubContribution; date: Date } =>
        item.date !== null,
    );
  const latest = parsed.reduce<Date | null>(
    (current, item) => (!current || item.date > current ? item.date : current),
    null,
  );

  if (!latest) return [];

  const start = new Date(latest);
  start.setUTCMonth(
    start.getUTCMonth() - Math.max(1, Math.min(12, Math.round(months))),
  );
  return parsed
    .filter((item) => item.date >= start)
    .map((item) => item.contribution);
}

function formatContributionLabel(contribution: GithubContributionCell): string {
  const date = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(dateFromISO(contribution.date) ?? new Date());
  const label = contribution.count === 1 ? "activity" : "activities";
  return `${contribution.count} ${label} · ${date}`;
}

function getCellDelay(
  animation: GithubGraphAnimation,
  weekIndex: number,
  dayIndex: number,
  speed: number,
): number {
  if (animation === "none") return 0;

  const step =
    animation === "wave"
      ? weekIndex * 0.026 + dayIndex * 0.016
      : animation === "scan"
        ? weekIndex * 0.03
        : (weekIndex + dayIndex * 2) * 0.018;
  return step / Math.max(speed, 0.1);
}

function getAmbientCellMotion(
  effect: GithubGraphAmbientEffect,
  intensity: number,
  weekIndex: number,
  dayIndex: number,
  entranceDelay: number,
  reducedMotion: boolean | null,
) {
  if (reducedMotion || effect === "none") {
    return {
      animate: { opacity: 1, scale: 1 },
      transition: {
        opacity: { duration: 0.14, delay: entranceDelay },
        scale: { type: "spring" as const, stiffness: 900, damping: 32 },
      },
    };
  }

  const strength = Math.min(1, Math.max(0, intensity));
  const seed = ((weekIndex * 17 + dayIndex * 31) % 11) / 10;
  const isTide = effect === "tide";
  const isDrift = effect === "drift";
  const duration = isTide ? 3.2 : isDrift ? 3.8 + seed : 2 + seed * 1.4;
  const delay =
    entranceDelay +
    (isTide ? (weekIndex + dayIndex * 1.8) * 0.055 : seed * 0.85);
  const lowOpacity = 1 - (isTide ? 0.24 : isDrift ? 0.16 : 0.34) * strength;
  const smallScale = 1 - (isTide ? 0.07 : isDrift ? 0.04 : 0.08) * strength;

  return {
    animate: {
      opacity: isDrift
        ? [1, lowOpacity, 1 - 0.06 * strength, 1]
        : [1, lowOpacity, 1],
      scale: isDrift
        ? [1, smallScale, 1 + 0.025 * strength, 1]
        : [1, smallScale, 1],
    },
    transition: {
      opacity: {
        duration,
        delay,
        ease: "easeInOut" as const,
        repeat: Infinity,
      },
      scale: { duration, delay, ease: "easeInOut" as const, repeat: Infinity },
    },
  };
}

function LoadingGraph({
  cellSize,
  cellGap,
  cellRadius,
  months,
  autoFit,
  availableWidth,
}: Pick<
  GithubGraphProps,
  "cellSize" | "cellGap" | "cellRadius" | "months" | "autoFit"
> & { availableWidth: number }) {
  const weekCount = Math.max(
    4,
    Math.ceil((Math.max(1, months ?? 3) * 31 + 6) / 7),
  );
  const resolvedSize = cellSize ?? 18;
  const resolvedGap = cellGap ?? 4;
  const fittedGap =
    autoFit && availableWidth > 0 && availableWidth < 460
      ? Math.min(resolvedGap, 3)
      : resolvedGap;
  const fittedCellSize =
    autoFit && availableWidth > 0
      ? Math.max(
          8,
          Math.min(
            resolvedSize,
            Math.floor(
              (availableWidth - (weekCount - 1) * fittedGap) / weekCount,
            ),
          ),
        )
      : resolvedSize;
  const fittedRadius = Math.max(
    0,
    Math.min(cellRadius ?? 3, fittedCellSize / 2),
  );

  if (autoFit) {
    return (
      <div className="w-full overflow-hidden py-2">
        <div
          className="flex w-full justify-between"
          style={{ gap: fittedGap }}
          aria-label="Loading activity"
        >
          {Array.from({ length: weekCount }, (_, week) => (
            <div
              key={week}
              className="grid shrink-0 grid-rows-7"
              style={{ gap: fittedGap }}
            >
              {Array.from({ length: 7 }, (_, day) => (
                <span
                  key={day}
                  className="animate-pulse bg-muted"
                  style={{
                    width: fittedCellSize,
                    height: fittedCellSize,
                    borderRadius: fittedRadius,
                    animationDelay: `${(week + day) * 12}ms`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        className="flex min-w-max"
        style={{ gap: resolvedGap }}
        aria-label="Loading activity"
      >
        {Array.from({ length: weekCount }, (_, week) => (
          <div
            key={week}
            className="grid grid-rows-7"
            style={{ gap: resolvedGap }}
          >
            {Array.from({ length: 7 }, (_, day) => (
              <span
                key={day}
                className="animate-pulse bg-muted"
                style={{
                  width: resolvedSize,
                  height: resolvedSize,
                  borderRadius: cellRadius,
                  animationDelay: `${(week + day) * 12}ms`,
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Interactive activity heatmap grid modeled after GitHub's contribution calendar.
 * Note on CSS containment: hovered cells spawn a `position: fixed` tooltip positioned
 * from viewport `getBoundingClientRect()` coordinates; therefore parent glass panels
 * should isolate `backdrop-filter` onto a sibling backdrop div rather than wrapping
 * `<GithubGraph>` directly inside a `backdrop-filter` / `transform` containing block.
 */
export function GithubGraph({
  account = "codecollab",
  months = 6,
  variant = "tangerine",
  animation = "wave",
  animationSpeed = 1,
  cellSize = 18,
  cellGap = 4,
  cellRadius = 3,
  autoFit = false,
  showLegend = false,
  showAccount = true,
  ambientEffect = "twinkle",
  ambientIntensity = 0.65,
  data,
  loading = false,
  onSummaryChange,
  className,
}: GithubGraphProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const onSummaryChangeRef = React.useRef(onSummaryChange);
  onSummaryChangeRef.current = onSummaryChange;
  const reducedMotion = useReducedMotion();
  const isDark = useIsDarkTheme();
  const normalizedAccount = React.useMemo(
    () => normalizeGithubAccount(account),
    [account],
  );
  const [resource, setResource] = React.useState<ResourceState>({
    status: "loading",
  });
  const [availableWidth, setAvailableWidth] = React.useState(0);
  const [hoveredContribution, setHoveredContribution] = React.useState<{
    contribution: GithubContributionCell;
    left: number;
    top: number;
    originLeft: number;
    originTop: number;
    placement: "above" | "below";
    weekIndex: number;
    dayIndex: number;
  } | null>(null);

  const colors = isDark ? DARK_VARIANTS[variant] : VARIANTS[variant];

  React.useLayoutEffect(() => {
    if (!autoFit || !rootRef.current) return;

    const root = rootRef.current;
    const updateWidth = () => setAvailableWidth(root.clientWidth);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(root);
    return () => observer.disconnect();
  }, [autoFit]);

  React.useEffect(() => {
    if (loading) {
      setResource({ status: "loading" });
      return;
    }

    if (data) {
      setResource({ status: "ready", contributions: data });
      return;
    }

    if (!normalizedAccount) {
      setResource({
        status: "error",
        message: "Enter a valid GitHub username.",
      });
      return;
    }

    const controller = new AbortController();
    setResource({ status: "loading" });

    fetch(`${CONTRIBUTIONS_ENDPOINT}/${normalizedAccount}?y=last`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("GitHub account not found.");
        const payload = (await response.json()) as {
          contributions?: GithubContribution[];
        };
        if (!Array.isArray(payload.contributions)) {
          throw new Error("No public contributions were returned.");
        }
        return payload.contributions;
      })
      .then((contributions) => {
        if (!controller.signal.aborted) {
          setResource({ status: "ready", contributions });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResource({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Could not load contributions.",
        });
      });

    return () => controller.abort();
  }, [data, loading, normalizedAccount]);

  const recentWindow = React.useMemo(() => {
    if (resource.status !== "ready") return [];
    return selectRecentContributions(resource.contributions, months);
  }, [months, resource]);

  const weeks = React.useMemo(() => {
    if (recentWindow.length === 0) return [];
    return buildContributionWeeks(recentWindow);
  }, [recentWindow]);

  const weekColumnCount = Math.max(1, weeks.length);
  const activeGap =
    autoFit && availableWidth > 0 && availableWidth < 460
      ? Math.min(cellGap, 3)
      : cellGap;
  const activeCellSize =
    autoFit && availableWidth > 0 && weeks.length > 0
      ? Math.max(
          8,
          Math.min(
            cellSize,
            Math.floor(
              (availableWidth - (weekColumnCount - 1) * activeGap) /
                weekColumnCount,
            ),
          ),
        )
      : cellSize;
  const resolvedCellRadius = Math.max(
    0,
    Math.min(cellRadius, Math.max(0, activeCellSize) / 2),
  );

  // Emit aggregate summary stats for the visible calendar window without forcing parent re-subscriptions
  React.useEffect(() => {
    if (!onSummaryChangeRef.current) return;
    if (resource.status !== "ready") {
      onSummaryChangeRef.current(null);
      return;
    }

    const sorted = [...recentWindow]
      .filter((item) => dateFromISO(item.date) !== null && Number.isFinite(item.count))
      .sort((a, b) => a.date.localeCompare(b.date));

    let totalContributions = 0;
    let activeDays = 0;
    let peakCount = 0;
    let peakDate: string | null = null;

    for (const item of sorted) {
      const count = Math.max(0, item.count);
      totalContributions += count;
      if (count > 0) activeDays += 1;
      if (count >= peakCount && count > 0) {
        peakCount = count;
        peakDate = item.date;
      }
    }

    let currentStreak = 0;
    if (sorted.length > 0) {
      // Allow today (last item) to still be 0 if user hasn't pushed yet today
      let idx = sorted.length - 1;
      if ((sorted[idx]?.count ?? 0) === 0 && idx > 0) {
        idx -= 1;
      }
      while (idx >= 0 && (sorted[idx]?.count ?? 0) > 0) {
        currentStreak += 1;
        idx -= 1;
      }
    }

    onSummaryChangeRef.current({
      totalContributions,
      activeDays,
      currentStreak,
      peakCount,
      peakDate,
    });
  }, [recentWindow, resource.status]);

  const animationKey = `${normalizedAccount ?? account}-${months}-${variant}-${animation}-${cellSize}-${cellGap}-${autoFit}`;

  const showTooltip = React.useCallback(
    (
      element: HTMLButtonElement,
      contribution: GithubContributionCell,
      weekIndex: number,
      dayIndex: number,
      pointer?: { clientX: number; clientY: number },
    ) => {
      const cellRect = element.getBoundingClientRect();
      const placement = cellRect.top > 56 ? "above" : "below";
      const left = Math.min(
        Math.max(cellRect.left + cellRect.width / 2, 96),
        window.innerWidth - 96,
      );
      setHoveredContribution({
        contribution,
        left,
        top: placement === "above" ? cellRect.top - 9 : cellRect.bottom + 9,
        originLeft: pointer?.clientX ?? left,
        originTop: pointer?.clientY ?? cellRect.top + cellRect.height / 2,
        placement,
        weekIndex,
        dayIndex,
      });
    },
    [],
  );

  const renderContribution = (
    contribution: GithubContributionCell,
    columnIndex: number,
    rowIndex: number,
  ) => {
    const label = formatContributionLabel(contribution);
    const entranceDelay = reducedMotion
      ? 0
      : getCellDelay(animation, columnIndex, rowIndex, animationSpeed);
    const ambientMotion = getAmbientCellMotion(
      ambientEffect,
      ambientIntensity,
      columnIndex,
      rowIndex,
      entranceDelay,
      reducedMotion,
    );
    const distance = hoveredContribution
      ? Math.hypot(
          columnIndex - hoveredContribution.weekIndex,
          rowIndex - hoveredContribution.dayIndex,
        )
      : Infinity;
    const waveStrength = Math.max(0, 1 - distance / 3);
    const filter = `brightness(${1 + waveStrength * 0.45}) saturate(${1 + waveStrength * 0.2})`;
    const emptyCellBorder =
      contribution.level === 0
        ? isDark
          ? "1px solid rgba(255, 255, 255, 0.08)"
          : "1px solid rgba(15, 23, 42, 0.07)"
        : undefined;

    return (
      <motion.button
        key={`${animationKey}-${contribution.date}`}
        type="button"
        role="gridcell"
        aria-label={label}
        className="relative outline-none ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-foreground/60"
        style={{
          width: activeCellSize,
          height: activeCellSize,
          borderRadius: resolvedCellRadius,
        }}
        initial={
          reducedMotion || animation === "none"
            ? false
            : { opacity: 0, scale: 0.35, y: 4 }
        }
        animate={{ opacity: 1, scale: 1, y: 0, filter }}
        transition={{
          opacity: { duration: 0.14, delay: entranceDelay },
          y: {
            type: "spring",
            stiffness: 520,
            damping: 28,
            delay: entranceDelay,
          },
          scale: { type: "spring", stiffness: 900, damping: 32 },
          filter: { duration: 0.08, ease: "easeOut" },
        }}
        onMouseEnter={(event) =>
          showTooltip(
            event.currentTarget,
            contribution,
            columnIndex,
            rowIndex,
            event,
          )
        }
        onFocus={(event) =>
          showTooltip(event.currentTarget, contribution, columnIndex, rowIndex)
        }
        onBlur={() => setHoveredContribution(null)}
      >
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundColor: colors[contribution.level],
            border: emptyCellBorder,
            borderRadius: resolvedCellRadius,
          }}
          animate={ambientMotion.animate}
          transition={ambientMotion.transition}
        />
      </motion.button>
    );
  };

  return (
    <div
      ref={rootRef}
      className={cn(autoFit ? "w-full" : "w-fit max-w-full", className)}
      aria-busy={resource.status === "loading"}
    >
      {showAccount && (
        <p className="mb-5 text-lg font-medium tracking-tight text-foreground">
          @{normalizedAccount ?? account}
        </p>
      )}

      {resource.status === "loading" && (
        <LoadingGraph
          cellSize={cellSize}
          cellGap={cellGap}
          cellRadius={resolvedCellRadius}
          months={months}
          autoFit={autoFit}
          availableWidth={availableWidth}
        />
      )}

      {resource.status === "error" && (
        <p className="text-sm text-muted-foreground">{resource.message}</p>
      )}

      {resource.status === "ready" && weeks.length > 0 && (
        <div
          className={cn(
            "py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            autoFit ? "w-full overflow-hidden" : "overflow-x-auto",
          )}
        >
          <div
            className={cn(
              "relative flex",
              autoFit ? "w-full justify-between" : "min-w-max",
            )}
            style={{ gap: activeGap }}
            role="grid"
            aria-label={`Workspace cadence for ${normalizedAccount ?? account}`}
            onMouseLeave={() => setHoveredContribution(null)}
          >
            {weeks.map((week, weekIndex) => (
              <div
                key={`${animationKey}-${weekIndex}`}
                className="grid shrink-0 grid-rows-7"
                style={{ gap: activeGap }}
                role="row"
              >
                {week.map((contribution, dayIndex) =>
                  renderContribution(contribution, weekIndex, dayIndex),
                )}
              </div>
            ))}
            <AnimatePresence>
              {hoveredContribution && (
                <motion.span
                  role="tooltip"
                  className="pointer-events-none fixed z-50 whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 font-mono text-xs font-medium text-background ring-1 ring-foreground/15"
                  initial={{
                    opacity: 0,
                    scale: 0.92,
                    left: hoveredContribution.originLeft,
                    top: hoveredContribution.originTop,
                    x: "-50%",
                    y:
                      hoveredContribution.placement === "above"
                        ? "-100%"
                        : "0%",
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    left: hoveredContribution.left,
                    top: hoveredContribution.top,
                    x: "-50%",
                    y:
                      hoveredContribution.placement === "above"
                        ? "-100%"
                        : "0%",
                  }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{
                    opacity: { duration: 0.12 },
                    scale: { duration: 0.12 },
                    left: { type: "spring", stiffness: 620, damping: 42 },
                    top: { type: "spring", stiffness: 620, damping: 42 },
                    y: { duration: 0.12 },
                  }}
                >
                  {formatContributionLabel(hoveredContribution.contribution)}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {showLegend && resource.status === "ready" && (
        <div
          className="mt-4 flex items-center gap-1.5"
          aria-label="Activity intensity legend"
        >
          <span className="mr-1 font-mono text-[10px] text-muted-foreground">
            Less
          </span>
          {colors.map((color, level) => (
            <span
              key={`${variant}-${level}`}
              style={{
                width: Math.min(12, cellSize),
                height: Math.min(12, cellSize),
                backgroundColor: color,
                border:
                  level === 0
                    ? isDark
                      ? "1px solid rgba(255, 255, 255, 0.1)"
                      : "1px solid rgba(15, 23, 42, 0.08)"
                    : undefined,
                borderRadius: Math.min(3, resolvedCellRadius),
              }}
              aria-label={`Level ${level}`}
            />
          ))}
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
            More
          </span>
        </div>
      )}
    </div>
  );
}
