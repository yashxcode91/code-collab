import { Code2, Cpu, GitBranch, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

const TECH_NODES = [
  {
    id: 'yjs',
    title: 'Yjs CRDT',
    meta: 'Conflict-free',
    icon: GitBranch,
  },
  {
    id: 'ts',
    title: 'TypeScript',
    meta: 'Strict contracts',
    icon: Code2,
  },
  {
    id: 'ws',
    title: 'WebSockets',
    meta: '11ms sync',
    icon: Radio,
  },
  {
    id: 'sandbox',
    title: 'Sandbox',
    meta: 'Isolated worker',
    icon: Cpu,
  },
] as const;

export function CollabShowcasePanel() {
  return (
    <div
      aria-hidden="true"
      className="flex h-full w-full select-none flex-col items-center justify-center bg-slate-50 px-8 py-10 dark:bg-[#080a10]"
    >
      {/* 1. Soft Architectural Dot Grid (muted slate so it never overpowers text) */}
      <svg
        className="pointer-events-none absolute inset-0 z-0 h-full w-full text-slate-400/35 dark:text-slate-600/35"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="collab-dot-grid"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1.5" cy="1.5" r="1.1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#collab-dot-grid)" />
      </svg>

      {/* 2. Soft Ambient Glow Orbs Behind Glass Surfaces */}
      <div
        className="pointer-events-none absolute left-[12%] top-[10%] z-0 h-72 w-72 rounded-full bg-violet-400/25 blur-3xl dark:bg-indigo-500/20"
      />
      <div
        className="pointer-events-none absolute bottom-[10%] right-[12%] z-0 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl dark:bg-emerald-500/15"
      />

      {/* 3. Subtle Circuit / Node Connector Traces */}
      <svg
        viewBox="0 0 800 720"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      >
        <path
          d="M 40 120 L 185 120 L 230 165 L 230 240"
          className="stroke-slate-300/70 dark:stroke-white/[0.08]"
          strokeWidth="1.25"
        />
        <circle cx="40" cy="120" r="3.5" className="fill-violet-500/60 dark:fill-indigo-400/70" />

        <path
          d="M 760 120 L 615 120 L 570 165 L 570 240"
          className="stroke-slate-300/70 dark:stroke-white/[0.08]"
          strokeWidth="1.25"
        />
        <circle cx="760" cy="120" r="3.5" className="fill-emerald-500/60 dark:fill-emerald-400/70" />

        <path
          d="M 40 600 L 185 600 L 230 555 L 230 480"
          className="stroke-slate-300/70 dark:stroke-white/[0.08]"
          strokeWidth="1.25"
        />
        <circle cx="40" cy="600" r="3.5" className="fill-sky-500/60 dark:fill-sky-400/70" />

        <path
          d="M 760 600 L 615 600 L 570 555 L 570 480"
          className="stroke-slate-300/70 dark:stroke-white/[0.08]"
          strokeWidth="1.25"
        />
        <circle cx="760" cy="600" r="3.5" className="fill-violet-500/60 dark:fill-indigo-400/70" />
      </svg>

      {/* 4. Frosted Glass Composition (layered above the z-10 cursor trail) */}
      <div className="relative z-20 w-full max-w-[500px] space-y-5">
        {/* Session Presence Bar (Frosted Glass Pill) */}
        <div className="flex items-center justify-between px-0.5">
          <div className="glass-surface inline-flex items-center gap-2 rounded-full px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
              room/alpha
            </span>
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
              2 active
            </span>
          </div>

          {/* Overlapping Collaborator Avatars */}
          <div className="flex items-center -space-x-1.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-50 bg-violet-600 font-mono text-[10px] font-semibold text-white shadow-sm dark:border-[#080a10] dark:bg-indigo-500">
              YR
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-50 bg-emerald-600 font-mono text-[10px] font-semibold text-white shadow-sm dark:border-[#080a10]">
              MK
            </span>
          </div>
        </div>

        {/* Collaborative IDE Window (Mostly Opaque Frosted Glass Card) */}
        <div className="glass-surface overflow-hidden rounded-2xl">
          {/* File Tab Header */}
          <div className="flex items-center justify-between border-b border-slate-900/[0.06] bg-slate-900/[0.025] px-4 py-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/75 dark:bg-rose-400/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/75 dark:bg-amber-400/60" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/75 dark:bg-emerald-400/60" />
              </div>

              <div className="flex items-center gap-1 font-mono text-[11px]">
                <span className="rounded-md border border-slate-900/[0.08] bg-white/80 px-2.5 py-0.5 font-medium text-slate-900 shadow-sm dark:border-white/10 dark:bg-white/[0.08] dark:text-slate-100">
                  session.ts
                </span>
                <span className="px-2 py-0.5 text-slate-500 dark:text-slate-400">
                  presence.ts
                </span>
              </div>
            </div>

            <span className="rounded-md border border-violet-200/80 bg-violet-50/90 px-2 py-0.5 font-mono text-[10px] font-medium text-violet-700 dark:border-indigo-400/25 dark:bg-indigo-500/15 dark:text-indigo-300">
              CRDT Sync
            </span>
          </div>

          {/* Code Body (High Contrast Glass Surface — Zero Overlapping Carets) */}
          <div className="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.85]">
            <CodeLine num={1}>
              <Kw>import</Kw> {'{ '}
              <Fn>createRoom</Fn>
              {' } '}
              <Kw>from</Kw> <Str>&apos;@codecollab/sdk&apos;</Str>;
            </CodeLine>
            <CodeLine num={2}>&nbsp;</CodeLine>
            <CodeLine num={3}>
              <Kw>const</Kw> <Id>room</Id> = <Kw>await</Kw>{' '}
              <Fn>createRoom</Fn>(<Str>&apos;alpha&apos;</Str>, {'{'}
            </CodeLine>
            <CodeLine num={4}>
              {'  '}
              <Prop>crdt</Prop>:{' '}
              <span className="inline-flex items-center rounded bg-violet-500/15 px-1 ring-1 ring-violet-500/30 dark:bg-indigo-400/15 dark:ring-indigo-400/35">
                <Str>&apos;yjs&apos;</Str>
              </span>
              <InlineCaretBadge label="yash" tone="violet" />,
            </CodeLine>
            <CodeLine num={5}>
              {'  '}
              <Prop>transport</Prop>: <Str>&apos;websocket&apos;</Str>,
            </CodeLine>
            <CodeLine num={6}>{'}'});</CodeLine>
            <CodeLine num={7}>&nbsp;</CodeLine>
            <CodeLine num={8}>
              <Id>room</Id>.<Fn>onPresence</Fn>((<Prop>peers</Prop>) =&gt; {'{'}
            </CodeLine>
            <CodeLine num={9}>
              {'  '}
              <span className="inline-flex items-center rounded bg-emerald-500/15 px-1 ring-1 ring-emerald-500/35 dark:bg-emerald-400/15 dark:ring-emerald-400/35">
                <Fn>syncCursors</Fn>(<Prop>peers</Prop>)
              </span>
              <InlineCaretBadge label="maya" tone="emerald" />;
            </CodeLine>
            <CodeLine num={10}>{'}'});</CodeLine>
          </div>

          {/* Compact Terminal Strip */}
          <div className="space-y-1 border-t border-slate-900/[0.06] bg-slate-900/[0.03] px-4 py-3 font-mono text-[11px] leading-5 dark:border-white/[0.08] dark:bg-black/25">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-violet-600 dark:text-indigo-400">
                $
              </span>
              <span className="text-slate-800 dark:text-slate-200">
                pnpm collab connect --room alpha
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <span>✓</span>
                <span>Shared state hydrated in 11ms</span>
              </span>
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                UTF-8 · TS
              </span>
            </div>
          </div>
        </div>

        {/* Frosted Glass Tech Nodes */}
        <div className="grid grid-cols-4 gap-2.5">
          {TECH_NODES.map((node) => {
            const Icon = node.icon;
            return (
              <div
                key={node.id}
                className={cn(
                  'glass-surface group flex flex-col gap-1.5 rounded-xl p-3',
                  'transition-colors duration-150 hover:border-violet-300 dark:hover:border-indigo-400/40',
                )}
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-700 ring-1 ring-inset ring-violet-500/15 dark:bg-indigo-400/15 dark:text-indigo-300 dark:ring-indigo-400/20">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold leading-tight text-slate-900 dark:text-slate-100">
                    {node.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                    {node.meta}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Frosted Caption Pill */}
        <div className="flex justify-center">
          <span className="glass-surface rounded-full px-3 py-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
            Move cursor across the workspace preview
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Syntax & Collaborator Helpers ────────────────────────────────────────────

function CodeLine({
  num,
  children,
}: {
  num: number;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center whitespace-pre">
      <span className="mr-4 w-5 shrink-0 select-none text-right text-[11px] text-slate-400 dark:text-slate-600">
        {num}
      </span>
      <span className="text-slate-800 dark:text-slate-200">{children}</span>
    </div>
  );
}

function Kw({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-medium text-violet-700 dark:text-violet-400">
      {children}
    </span>
  );
}

function Fn({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-sky-700 dark:text-sky-300">{children}</span>
  );
}

function Str({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-emerald-700 dark:text-emerald-400">{children}</span>
  );
}

function Prop({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-amber-700 dark:text-amber-300">{children}</span>
  );
}

function Id({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-medium text-slate-900 dark:text-slate-100">
      {children}
    </span>
  );
}

/**
 * Inline cursor + collaborator badge rendered directly after the edited token
 * so it never collides with characters on adjacent lines.
 */
function InlineCaretBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'violet' | 'emerald';
}) {
  const barColor =
    tone === 'violet'
      ? 'bg-violet-600 dark:bg-indigo-400'
      : 'bg-emerald-600 dark:bg-emerald-400';
  const badgeColor =
    tone === 'violet'
      ? 'bg-violet-600 text-white dark:bg-indigo-500'
      : 'bg-emerald-600 text-white dark:bg-emerald-500';

  return (
    <span className="ml-0.5 inline-flex items-center align-middle">
      <span className={cn('h-4 w-[2px] animate-pulse-soft rounded-full', barColor)} />
      <span
        className={cn(
          'ml-1 rounded px-1.5 py-[1px] font-sans text-[9px] font-semibold leading-none shadow-sm',
          badgeColor,
        )}
      >
        {label}
      </span>
    </span>
  );
}

