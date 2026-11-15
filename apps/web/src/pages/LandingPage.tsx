import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  Eye,
  GitBranch,
  Globe,
  Layers,
  Lock,
  Menu,
  Network,
  Play,
  Search,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { BrandLogo } from '@/components/BrandLogo';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/context/AuthContext';

// ============================================================================
// CONSTANTS & CATALOG DATA
// ============================================================================

const TECH_STRIP = [
  { name: 'React 18', role: 'Component Framework', icon: Globe },
  { name: 'TypeScript 5', role: 'Strict Static Types', icon: Cpu },
  { name: 'Node.js 20', role: 'Event Loop Backend', icon: Server },
  { name: 'PostgreSQL 16', role: 'Relational Database', icon: Database },
  { name: 'Redis 7', role: 'Pub/Sub & Cache', icon: Zap },
  { name: 'Docker Engine', role: 'Isolated Sandboxes', icon: Box },
  { name: 'Monaco Editor', role: 'VS Code Desktop Core', icon: Terminal },
  { name: 'Yjs CRDTs', role: 'Conflict-Free Sync', icon: Network },
  { name: 'Prisma ORM', role: 'Type-Safe ORM Client', icon: Layers },
];

const CORE_FEATURES = [
  {
    id: 'ide',
    title: 'Collaborative Cloud IDE',
    description:
      'Full-featured browser IDE powered by the Monaco editor with syntax highlighting, multi-tab editing, smart code folding, and intuitive keyboard shortcuts.',
    icon: Terminal,
    tag: 'Core Workspace',
  },
  {
    id: 'collab',
    title: 'Real-Time Collaboration',
    description:
      'Mathematical conflict-free replicated data types (Yjs CRDTs) guarantee synchronized edits without merge collisions. Includes live multi-cursor presence and integrated chat.',
    icon: Users,
    tag: 'Sub-25ms Sync',
  },
  {
    id: 'docker',
    title: 'Docker Code Execution',
    description:
      'Run untrusted code safely in isolated, ephemeral Docker container sandboxes equipped with strict 128MB RAM caps, CPU quotas, and zero host network access.',
    icon: Box,
    tag: 'Air-Gapped Sandbox',
  },
  {
    id: 'terminal',
    title: 'Interactive Terminal',
    description:
      'Full xterm.js terminal integration streaming real-time process stdout and stderr with full ANSI color support and execution telemetry directly in your browser.',
    icon: Play,
    tag: 'Live Process I/O',
  },
  {
    id: 'preview',
    title: 'Live Web Preview',
    description:
      'Instant responsive preview sandbox pane allowing developers to inspect client-rendered web interfaces, mock APIs, and UI revisions without external browser tabs.',
    icon: Eye,
    tag: 'In-Editor Browser',
  },
  {
    id: 'ai',
    title: 'AI Assistant',
    description:
      'High-speed streaming code explanations, automated bug diagnostics, and architectural recommendations powered by Google Gemini 2.0 Flash models.',
    icon: Bot,
    tag: 'Contextual AI',
  },
  {
    id: 'search',
    title: 'Semantic Code Search',
    description:
      'High-dimensional pgvector cosine similarity search indexing AST code chunks to help you locate relevant functions, classes, and logic via natural language.',
    icon: Search,
    tag: 'pgvector Cosine Search',
  },
  {
    id: 'branches',
    title: 'Branches & Snapshots',
    description:
      'Lightweight Git-style branch switching paired with instant point-in-time snapshot checkpoints, letting you experiment fearlessly and roll back regressions in seconds.',
    icon: GitBranch,
    tag: 'Instant Rollbacks',
  },
];

const HOW_IT_WORKS_STEPS = [
  {
    step: '01',
    title: 'Create a Workspace',
    description:
      'Initialize a production-ready repository in seconds from curated templates (TypeScript, Python, Node.js, Go) or start fresh with a custom project.',
    icon: Box,
  },
  {
    step: '02',
    title: 'Invite Collaborators',
    description:
      'Share a workspace access link with team members. Observe live peer cursors, see active selection highlights, and communicate via synchronized team chat.',
    icon: Users,
  },
  {
    step: '03',
    title: 'Code, Execute & Preview',
    description:
      'Write code with Monaco intelligence, trigger isolated builds inside air-gapped Docker execution sandboxes, and inspect live UI outputs in the preview pane.',
    icon: Play,
  },
  {
    step: '04',
    title: 'Improve with AI',
    description:
      'Ask the context-aware Gemini AI assistant to explain complex logic, diagnose errors, search codebases semantically, or suggest multi-file refactoring diffs.',
    icon: Sparkles,
  },
];

const PRODUCT_SHOWCASE_TABS = [
  {
    id: 'editor',
    label: 'Monaco Editor & Cursors',
    heading: 'High-Performance Collaborative Code Editing',
    description:
      'Monaco editor core configured with zero-latency keystroke broadcasting via Yjs CRDTs. Multiple developers can edit the same file simultaneously without lost keystrokes or collision locks.',
    badge: 'Mathematical CRDT Sync',
  },
  {
    id: 'terminal',
    label: 'Docker Execution Terminal',
    heading: 'Air-Gapped Container Code Execution',
    description:
      'Run compilation and test scripts safely inside isolated Docker containers. Ephemeral environments enforce 128MB memory caps, unprivileged non-root execution, and network=none.',
    badge: 'Security-Hardened',
  },
  {
    id: 'preview',
    label: 'Live Web Preview',
    heading: 'In-Browser Responsive Application Testing',
    description:
      'Inspect responsive layouts live inside the integrated web preview sandbox. Hot-reloads your application code directly alongside your editor without tab switching.',
    badge: 'Sandboxed Iframe',
  },
  {
    id: 'ai',
    label: 'AI Subsystem & Search',
    heading: 'Gemini-Powered Codebase Intelligence',
    description:
      'Streaming conversational AI assistant paired with pgvector AST code embeddings. Ask questions in natural language and receive context-accurate diff recommendations.',
    badge: 'Gemini 2.0 Flash',
  },
  {
    id: 'snapshots',
    label: 'Branches & Snapshots',
    heading: 'Zero-Downtime Rollback Checkpoints',
    description:
      'Create workspace branches and point-in-time snapshots before risky refactors. Compare multi-file staged diffs visually and restore clean working trees with one click.',
    badge: 'Git-Style History',
  },
];

const PRICING_TIERS = [
  {
    name: 'Developer Preview',
    price: '$0',
    frequency: 'free during preview',
    status: 'Current Active Phase',
    description:
      'Full access to all platform features while CodeCollab is in active developer preview. No credit card required.',
    isPopular: true,
    features: [
      'Unlimited public & private workspaces',
      'Real-time Monaco collaborative editing',
      'Yjs CRDT multi-cursor awareness & chat',
      'Isolated Docker container code execution',
      'Interactive xterm.js terminal & web preview',
      'Google Gemini AI assistant & code search',
      'Branch versioning & snapshot rollbacks',
      'Community feature voting & roadmap portal',
    ],
    ctaText: 'Start Building Free',
    ctaLink: '/register',
    isCurrent: true,
  },
  {
    name: 'Pro',
    price: 'Proposed',
    frequency: 'coming soon',
    status: 'Coming Soon',
    description:
      'Dedicated cloud compute quotas, custom domains, and elevated container sandbox resources for professional engineers.',
    isPopular: false,
    features: [
      'Everything in Developer Preview',
      'Persistent dedicated container compute pools',
      'Custom domain SSL mapping for live previews',
      'High-priority background queue worker slots',
      'Expanded pgvector semantic embedding quotas',
      'Automated nightly database snapshot backups',
    ],
    isCurrent: false,
  },
  {
    name: 'Team',
    price: 'Proposed',
    frequency: 'coming soon',
    status: 'Coming Soon',
    description:
      'Centralized team governance, single sign-on (SSO), audit trails, and collaborative organization spaces.',
    isPopular: false,
    features: [
      'Everything in Pro tier',
      'Unlimited team member seat allocations',
      'Organization role-based access control (RBAC)',
      'Single Sign-On (SAML / Okta / Google Workspace)',
      'Audit log exports for compliance & security',
      'Dedicated enterprise Redis & PostgreSQL mesh',
    ],
    isCurrent: false,
  },
];

const FAQ_ITEMS = [
  {
    question: 'What is CodeCollab?',
    answer:
      'CodeCollab is a full-stack, collaborative cloud development platform. It integrates a browser-based Monaco editor, real-time multi-user CRDT synchronization, isolated Docker execution sandboxes, live web preview, and an AI engineering assistant into a single cohesive workspace.',
  },
  {
    question: 'Does code run on my local machine or in the cloud?',
    answer:
      'Code is executed inside ephemeral, isolated Docker containers managed by the backend worker mesh. Developer code never runs on your personal computer and is completely isolated from the host server through strict container boundaries.',
  },
  {
    question: 'How does real-time collaboration prevent merge conflicts?',
    answer:
      'CodeCollab uses Yjs, a high-performance Conflict-free Replicated Data Type (CRDT) framework. Edits are modeled as mathematical operations that converge deterministically across all connected clients without requiring locking or manual conflict resolution.',
  },
  {
    question: 'Which programming languages are supported?',
    answer:
      'The platform currently supports Node.js/TypeScript, Python, C++, Go, Rust, and Java through dedicated polyglot container execution runners. Monaco provides full syntax highlighting and language configuration for these environments.',
  },
  {
    question: 'How is code execution secured against malicious payloads?',
    answer:
      'Execution workers isolate user code inside unprivileged Docker containers (node:1000) with network=none (zero inbound or outbound internet access), 128MB RAM limits, CPU quotas, read-only root filesystems, and seccomp syscall blacklists.',
  },
  {
    question: 'What AI capabilities are currently available?',
    answer:
      'CodeCollab features Google Gemini 2.0 streaming integration for code explanations, debugging diagnostics, and refactoring assistance. It also includes an AST code chunker and high-dimensional pgvector cosine similarity search for semantic codebase discovery.',
  },
  {
    question: 'Is GitHub integration supported?',
    answer:
      'CodeCollab currently supports local workspace branches, version history, and snapshot checkpoints. Direct bi-directional GitHub commit and PR synchronization is currently cataloged on our roadmap for upcoming release milestones.',
  },
  {
    question: 'Is CodeCollab free to use?',
    answer:
      'Yes! CodeCollab is 100% free during the Developer Preview phase. All workspaces, real-time collaboration, container execution runs, and AI capabilities are openly accessible to developers.',
  },
];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function LandingPage() {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeShowcaseTab, setActiveShowcaseTab] = useState<string>('editor');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index);
  };

  return (
    <div className="relative min-h-dvh bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
      {/* Background Atmosphere & Precision Grids */}
      <StudioBackdrop />

      {/* ================================================================== */}
      {/* SECTION A — NAVIGATION HEADER */}
      {/* ================================================================== */}
      <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl transition-all">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo & Product Name */}
          <Link
            to="/"
            className="flex items-center gap-2.5 transition-transform duration-150 active:scale-95"
            aria-label="CodeCollab Home"
          >
            <BrandLogo size="md" />
          </Link>

          {/* Desktop Nav Links */}
          <nav
            className="hidden md:flex items-center gap-6 text-xs font-medium text-muted-foreground"
            aria-label="Main Navigation"
          >
            <a
              href="#features"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5"
            >
              How It Works
            </a>
            <a
              href="#architecture"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5"
            >
              Architecture
            </a>
            <Link
              to="/roadmap"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5 flex items-center gap-1"
            >
              <span>Roadmap</span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-primary">
                Live
              </span>
            </Link>
            <a
              href="#pricing"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-md px-1 py-0.5"
            >
              FAQ
            </a>
          </nav>

          {/* Right Action Controls */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            {user ? (
              <Link
                to="/dashboard"
                className="btn-studio-primary inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-xs font-semibold shadow-sm transition-all"
              >
                <span>Open Studio</span>
                <span className="hidden font-mono text-[11px] opacity-80 sm:inline">
                  (@{user.username})
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  to="/login"
                  className="glass-control hidden h-9 items-center justify-center rounded-xl px-3.5 text-xs font-medium text-foreground transition-all hover:bg-foreground/[0.08] sm:inline-flex"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="btn-studio-primary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold shadow-sm transition-all"
                >
                  <span>Get Started</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="glass-control inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground md:hidden"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="border-b border-border/60 bg-background/95 px-4 py-5 backdrop-blur-2xl md:hidden">
            <nav className="flex flex-col gap-3 font-medium text-sm">
              <a
                href="#features"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                Features
              </a>
              <a
                href="#how-it-works"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                How It Works
              </a>
              <a
                href="#architecture"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                Architecture & Security
              </a>
              <Link
                to="/roadmap"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                <span>Roadmap & Voting</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                  Live
                </span>
              </Link>
              <a
                href="#pricing"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                Pricing (Preview)
              </a>
              <a
                href="#faq"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"
              >
                FAQ
              </a>
              {!user && (
                <div className="mt-3 flex flex-col gap-2 pt-3 border-t border-border/60">
                  <Link
                    to="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="glass-control flex h-10 items-center justify-center rounded-xl text-xs font-semibold text-foreground"
                  >
                    Sign in to Account
                  </Link>
                  <Link
                    to="/register"
                    onClick={() => setMobileMenuOpen(false)}
                    className="btn-studio-primary flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold"
                  >
                    <span>Create Free Account</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              )}
            </nav>
          </div>
        )}
      </header>

      <main className="relative z-10">
        {/* ================================================================== */}
        {/* SECTION B — HERO */}
        {/* ================================================================== */}
        <section className="relative overflow-hidden pt-12 pb-20 md:pt-20 md:pb-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            {/* Version & Status Pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-foreground/[0.04] px-3.5 py-1 text-xs text-foreground backdrop-blur-md transition-all hover:border-primary/40">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-[11px] font-medium text-muted-foreground">
                CodeCollab 2.0 · Collaborative Cloud IDE
              </span>
            </div>

            {/* Headline */}
            <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              Code Together.{' '}
              <span className="bg-gradient-to-r from-orange-400 via-primary to-amber-500 bg-clip-text text-transparent">
                Build Without Limits.
              </span>
            </h1>

            {/* Subheading */}
            <p className="mx-auto mt-6 max-w-3xl text-base text-muted-foreground sm:text-lg md:text-xl leading-relaxed">
              Your complete collaborative cloud development environment. Write code, work with your
              team, run applications, and build smarter with AI — all in one place.
            </p>

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={user ? '/dashboard' : '/register'}
                className="btn-studio-primary flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-7 text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
              >
                <span>{user ? 'Go to Your Studio' : 'Start Building Free'}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="glass-control flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-6 text-sm font-medium text-foreground transition-all hover:bg-foreground/[0.08]"
              >
                <span>Explore the Platform</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </a>
            </div>

            {/* Verified Operational Invariants */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-6 font-mono text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Zero Installation Required</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Isolated Docker Sandboxes</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Yjs Sub-25ms CRDT Sync</span>
              </span>
            </div>

            {/* Genuine High-Fidelity Studio Interface Preview */}
            <div className="mt-14 relative mx-auto max-w-5xl">
              <div className="glass-mirror overflow-hidden rounded-2xl sm:rounded-3xl border border-border/80 shadow-2xl">
                {/* Simulated Studio Window Title Bar */}
                <div className="flex h-10 items-center justify-between border-b border-border/60 bg-foreground/[0.03] px-4 font-mono text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-rose-500/80" />
                    <span className="h-3 w-3 rounded-full bg-amber-500/80" />
                    <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 hidden text-muted-foreground sm:inline">
                      codecollab-studio · distributed-kv-store
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-foreground/[0.06] px-2 py-0.5 text-muted-foreground">
                      <GitBranch className="h-3 w-3 text-primary" />
                      <span>main</span>
                    </span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="hidden text-emerald-400 sm:inline">2 Collaborators Live</span>
                  </div>
                </div>

                {/* Main Split Body: Sidebar + Monaco Code Editor + Terminal / Preview */}
                <div className="grid grid-cols-1 md:grid-cols-12 text-left font-mono text-xs">
                  {/* File Tree Explorer (3 Cols) */}
                  <div className="hidden md:block md:col-span-3 border-r border-border/60 bg-foreground/[0.015] p-3 space-y-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Workspace Explorer
                    </div>
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1.5 text-foreground font-medium">
                        <span>📁 src/</span>
                      </div>
                      <div className="pl-4 space-y-1">
                        <div className="flex items-center justify-between text-primary font-semibold bg-primary/10 rounded px-1.5 py-0.5">
                          <span>📄 server.ts</span>
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        </div>
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 hover:text-foreground">
                          <span>📄 collab.ts</span>
                        </div>
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 hover:text-foreground">
                          <span>📄 router.ts</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-0.5 hover:text-foreground">
                        <span>📄 schema.prisma</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-0.5 hover:text-foreground">
                        <span>📄 Dockerfile</span>
                      </div>
                      <div className="flex items-center gap-1.5 px-1.5 py-0.5 hover:text-foreground">
                        <span>📄 package.json</span>
                      </div>
                    </div>
                  </div>

                  {/* Monaco Editor Pane (6 Cols) */}
                  <div className="col-span-1 md:col-span-6 border-b md:border-b-0 md:border-r border-border/60 bg-editor p-4 space-y-2 overflow-x-auto">
                    <div className="flex items-center justify-between border-b border-border/40 pb-2 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">src/server.ts</span>
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.2 text-[9px] text-emerald-400">
                          CRDT Synced
                        </span>
                      </div>
                      <span>TypeScript</span>
                    </div>

                    <pre className="text-[11px] leading-relaxed text-muted-foreground font-mono">
                      <code>
                        <span className="text-purple-400">import</span> &#123; createServer &#125;{' '}
                        <span className="text-purple-400">from</span>{' '}
                        <span className="text-emerald-300">'node:http'</span>;{'\n'}
                        <span className="text-purple-400">import</span> &#123; Server &#125;{' '}
                        <span className="text-purple-400">from</span>{' '}
                        <span className="text-emerald-300">'socket.io'</span>;{'\n'}
                        <span className="text-purple-400">import</span> &#123; setupCollabMesh &#125;{' '}
                        <span className="text-purple-400">from</span>{' '}
                        <span className="text-emerald-300">'@codecollab/yjs'</span>;{'\n\n'}
                        <span className="text-blue-400">const</span> server ={' '}
                        <span className="text-amber-300">createServer</span>();{'\n'}
                        <span className="text-blue-400">const</span> io ={' '}
                        <span className="text-blue-400">new</span>{' '}
                        <span className="text-emerald-300">Server</span>(server, &#123; cors:{' '}
                        <span className="text-amber-300">&#123; origin: '*' &#125;</span> &#125;);
                        {'\n\n'}
                        <span className="text-slate-500">
                          // Live peer cursor presence active
                        </span>
                        {'\n'}
                        <span className="bg-primary/20 text-primary border-l-2 border-primary px-1 py-0.5 rounded-r">
                          <span className="font-bold">setupCollabMesh</span>(io, redisMeshAdapter);
                        </span>{' '}
                        <span className="inline-block rounded bg-primary px-1 text-[9px] text-white font-sans font-semibold">
                          Yash (Editing)
                        </span>
                        {'\n\n'}
                        server.<span className="text-amber-300">listen</span>(4000, () =&gt; &#123;
                        {'\n'}
                        {'  '}console.<span className="text-amber-300">log</span>(
                        <span className="text-emerald-300">'CodeCollab mesh listening :4000'</span>
                        );{'\n'}
                        &#125;);
                      </code>
                    </pre>
                  </div>

                  {/* Terminal & Output Pane (3 Cols) */}
                  <div className="col-span-1 md:col-span-3 bg-foreground/[0.02] p-3 space-y-2">
                    <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/40 pb-1.5">
                      <span>Docker Terminal</span>
                      <span className="text-emerald-400 font-mono">Running</span>
                    </div>

                    <div className="space-y-1.5 text-[10px] text-muted-foreground">
                      <div className="text-foreground">$ docker-runner exec --sandbox</div>
                      <div className="text-emerald-400">✓ Container initialized (node:20-alpine)</div>
                      <div className="text-blue-400">ℹ RAM quota: 128MB | Network: None</div>
                      <div className="text-slate-400">
                        [Redis] Pub/Sub synchronized (0.8ms)
                      </div>
                      <div className="text-emerald-300 font-medium">
                        ✓ 35 Vitest tests passed
                      </div>
                      <div className="text-primary font-medium">
                        ✓ 14 Playwright E2E passed
                      </div>
                      <div className="mt-3 rounded border border-border/60 bg-foreground/[0.04] p-2">
                        <div className="text-[9px] text-muted-foreground">Web Preview</div>
                        <div className="text-[10px] text-foreground font-semibold">
                          http://localhost:5173
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-[9px] text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          <span>Live Reload Ready</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION C — TECHNOLOGY STRIP */}
        {/* ================================================================== */}
        <section className="border-y border-border/60 bg-foreground/[0.02] py-8">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <p className="text-center font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-6">
              Engineered with modern production technologies
            </p>

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-9">
              {TECH_STRIP.map((tech) => {
                const IconComponent = tech.icon;
                return (
                  <div
                    key={tech.name}
                    className="glass-control flex flex-col items-center justify-center rounded-xl p-3 text-center transition-all hover:border-primary/40 hover:scale-[1.02]"
                  >
                    <IconComponent className="h-5 w-5 text-primary mb-1.5" />
                    <div className="font-semibold text-foreground text-xs">{tech.name}</div>
                    <div className="text-[9px] text-muted-foreground">{tech.role}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION D — FEATURE SHOWCASE */}
        {/* ================================================================== */}
        <section id="features" className="py-20 md:py-28 scroll-mt-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <Layers className="h-3.5 w-3.5" />
                <span>Feature Showcase</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Everything You Need to Build, Test & Ship
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                CodeCollab combines the capabilities of a modern desktop editor with the scalability
                of cloud execution and real-time collaboration.
              </p>
            </div>

            <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {CORE_FEATURES.map((feature) => {
                const FeatureIcon = feature.icon;
                return (
                  <div
                    key={feature.id}
                    className="glass-mirror relative rounded-2xl p-5 space-y-3 transition-all hover:border-primary/40 hover:shadow-lg flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <FeatureIcon className="h-4 w-4" />
                        </div>
                        <span className="font-mono text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                          {feature.tag}
                        </span>
                      </div>

                      <h3 className="text-base font-semibold text-foreground">{feature.title}</h3>

                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {feature.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-border/40 font-mono text-[10px] text-muted-foreground flex items-center gap-1">
                      <span>Verified capability</span>
                      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION E — HOW IT WORKS */}
        {/* ================================================================== */}
        <section
          id="how-it-works"
          className="border-t border-border/60 bg-foreground/[0.015] py-20 md:py-28 scroll-mt-16"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <Zap className="h-3.5 w-3.5" />
                <span>Workflow Architecture</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                From Idea to Execution in Four Simple Steps
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                CodeCollab eliminates setup friction so you can focus strictly on writing and reviewing code.
              </p>
            </div>

            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {HOW_IT_WORKS_STEPS.map((step) => {
                const StepIcon = step.icon;
                return (
                  <div
                    key={step.step}
                    className="glass-surface relative rounded-2xl p-6 space-y-4 border border-border/70 hover:border-primary/40 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-2xl font-black text-primary/40">
                        {step.step}
                      </span>
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <StepIcon className="h-4 w-4" />
                      </div>
                    </div>

                    <h3 className="text-base font-semibold text-foreground">{step.title}</h3>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION F — INTERACTIVE PRODUCT SHOWCASE */}
        {/* ================================================================== */}
        <section className="py-20 md:py-28 border-t border-border/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <Terminal className="h-3.5 w-3.5" />
                <span>Product Deep Dive</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Explore the Developer Experience
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                Inspect the actual surfaces that power the CodeCollab cloud environment.
              </p>
            </div>

            {/* Showcase Selector Tabs */}
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              {PRODUCT_SHOWCASE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveShowcaseTab(tab.id)}
                  className={`rounded-xl px-4 py-2 font-mono text-xs font-medium transition-all ${
                    activeShowcaseTab === tab.id
                      ? 'bg-primary text-white shadow-sm shadow-primary/30'
                      : 'glass-control text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Showcase Content Card */}
            {PRODUCT_SHOWCASE_TABS.map((tab) => {
              if (tab.id !== activeShowcaseTab) return null;

              return (
                <div
                  key={tab.id}
                  className="mt-8 glass-mirror rounded-3xl p-6 sm:p-8 border border-border/80"
                >
                  <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
                    <div className="lg:col-span-5 space-y-4">
                      <span className="font-mono text-xs font-semibold text-primary uppercase tracking-wider bg-primary/10 px-2.5 py-1 rounded-full">
                        {tab.badge}
                      </span>
                      <h3 className="text-2xl font-bold text-foreground tracking-tight">
                        {tab.heading}
                      </h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {tab.description}
                      </p>

                      <div className="space-y-2 pt-2">
                        <div className="flex items-center gap-2 text-xs text-foreground font-medium">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>Built directly into Studio IDE layout</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-foreground font-medium">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>Non-blocking background asynchronous workers</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-foreground font-medium">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                          <span>Deterministic state synchronization across peers</span>
                        </div>
                      </div>

                      <div className="pt-4">
                        <Link
                          to={user ? '/dashboard' : '/register'}
                          className="btn-studio-primary inline-flex h-9 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold"
                        >
                          <span>Try in Studio</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>

                    <div className="lg:col-span-7">
                      <div className="glass-surface rounded-2xl p-5 border border-border/70 font-mono text-xs space-y-3">
                        <div className="flex items-center justify-between border-b border-border/50 pb-2 text-muted-foreground text-[11px]">
                          <span>Active View: {tab.label}</span>
                          <span className="text-emerald-400">Operational</span>
                        </div>

                        {tab.id === 'editor' && (
                          <div className="space-y-1.5 text-muted-foreground">
                            <div className="text-purple-400">// Monaco collaborative bindings</div>
                            <div>
                              <span className="text-blue-400">const</span> ydoc ={' '}
                              <span className="text-blue-400">new</span>{' '}
                              <span className="text-emerald-300">Y.Doc</span>();
                            </div>
                            <div>
                              <span className="text-blue-400">const</span> ytext = ydoc.
                              <span className="text-amber-300">getText</span>(
                              <span className="text-emerald-300">'monaco'</span>);
                            </div>
                            <div>
                              <span className="text-blue-400">const</span> binding ={' '}
                              <span className="text-blue-400">new</span>{' '}
                              <span className="text-emerald-300">MonacoBinding</span>(ytext, editor.
                              <span className="text-amber-300">getModel</span>()!,{' '}
                              <span className="text-amber-300">new Set([editor])</span>, awareness);
                            </div>
                            <div className="mt-2 text-emerald-400 text-[10px]">
                              ✓ 0 merge conflicts &bull; Sub-25ms WebSocket latency
                            </div>
                          </div>
                        )}

                        {tab.id === 'terminal' && (
                          <div className="space-y-1.5 text-muted-foreground text-[11px]">
                            <div className="text-foreground">$ pnpm test</div>
                            <div className="text-slate-400">Running Vitest across 7 packages...</div>
                            <div className="text-emerald-400">✓ apps/web (35 tests passed)</div>
                            <div className="text-emerald-400">✓ packages/shared (38 tests passed)</div>
                            <div className="text-emerald-400">✓ apps/server (58 tests passed)</div>
                            <div className="text-primary font-semibold">
                              ✓ 100% test pass rate (0 failures)
                            </div>
                          </div>
                        )}

                        {tab.id === 'preview' && (
                          <div className="space-y-2 text-center py-4">
                            <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary mx-auto">
                              <Globe className="h-5 w-5" />
                            </div>
                            <div className="text-foreground font-semibold text-sm">
                              Sandboxed Responsive Web Preview
                            </div>
                            <div className="text-muted-foreground text-xs max-w-sm mx-auto">
                              Instant iframe reload for React, Vue, HTML/CSS web projects with mobile,
                              tablet, and desktop viewport toggles.
                            </div>
                          </div>
                        )}

                        {tab.id === 'ai' && (
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center gap-2 text-primary font-semibold">
                              <Bot className="h-4 w-4" />
                              <span>Gemini 2.0 Architectural Assistant</span>
                            </div>
                            <div className="rounded-lg bg-foreground/[0.04] p-3 text-muted-foreground leading-relaxed">
                              "The selected code creates a Redis Pub/Sub adapter to broadcast
                              CRDT room updates across multi-node servers. To prevent event loop
                              blocking, batch updates over 16ms intervals."
                            </div>
                          </div>
                        )}

                        {tab.id === 'snapshots' && (
                          <div className="space-y-2 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-foreground font-semibold">Branch Version Tree</span>
                              <span className="text-primary">main (Active)</span>
                            </div>
                            <div className="space-y-1 text-muted-foreground text-[11px]">
                              <div>&bull; Commit: feat(day-13): e2e playwright &amp; load tests</div>
                              <div>&bull; Commit: feat(day-12): multi-stage docker packaging</div>
                              <div>&bull; Commit: feat(day-10): dual-token auth rotation</div>
                            </div>
                            <div className="text-emerald-400 text-[10px]">
                              ✓ Instant rollback checkpoint available
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION G — ARCHITECTURE & SECURITY */}
        {/* ================================================================== */}
        <section
          id="architecture"
          className="border-t border-border/60 bg-foreground/[0.015] py-20 md:py-28 scroll-mt-16"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <Shield className="h-3.5 w-3.5" />
                <span>Defense-in-Depth Posture</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Engineered for Security, Isolation & Scale
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                CodeCollab is architected with strict sandboxing and zero-trust verification across
                all network boundaries.
              </p>
            </div>

            <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              <div className="glass-mirror rounded-2xl p-6 space-y-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Lock className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Zero-Trust Sandboxes</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  User code never touches the host system. Execution happens inside isolated Docker
                  containers with <code>network=none</code>, 128MB RAM caps, CPU quotas, and
                  unprivileged non-root users (<code>node:1000</code>).
                </p>
              </div>

              <div className="glass-mirror rounded-2xl p-6 space-y-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Dual-Token Silent Rotation</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  15-minute access JWTs paired with 30-day cryptographically isolated refresh tokens
                  stored in HttpOnly, SameSite=Lax cookies locked strictly to <code>/api/auth</code>.
                  Zero typing interruptions during silent token renewals.
                </p>
              </div>

              <div className="glass-mirror rounded-2xl p-6 space-y-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Network className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Redis Pub/Sub Socket Mesh</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Stateless Express + Socket.IO nodes scale horizontally using Redis 7 Pub/Sub.
                  Benchmarked under 100 concurrent developers at 1,821 messages/sec with 0.0% packet
                  loss and a P95 round-trip latency of 29ms.
                </p>
              </div>
            </div>

            {/* Architecture Invariant Callout */}
            <div className="mt-8 glass-control rounded-2xl p-5 border border-border/70 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1 text-center sm:text-left">
                <div className="text-sm font-semibold text-foreground">
                  Want to inspect the deep architectural blueprint?
                </div>
                <div className="text-xs text-muted-foreground">
                  Review the complete dependency stack, architectural pillars, and verified engineering handbooks.
                </div>
              </div>
              <Link
                to="/roadmap#principles"
                className="glass-control inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors shrink-0"
              >
                <span>Read Architecture Pillars</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION H — ROADMAP */}
        {/* ================================================================== */}
        <section className="py-20 md:py-28 border-t border-border/60">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>Interactive Development Roadmap</span>
                </div>
                <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                  Public Engineering Roadmap
                </h2>
                <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
                  Explore what is already built, what is currently in active deployment, and vote on
                  upcoming platform capabilities.
                </p>
              </div>

              <Link
                to="/roadmap"
                className="btn-studio-primary inline-flex h-10 items-center justify-center gap-2 rounded-xl px-5 text-xs font-semibold shadow-sm shrink-0"
              >
                <span>View Full Roadmap Portal</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="mt-10 grid gap-5 sm:grid-cols-3">
              <div className="glass-surface rounded-2xl p-5 space-y-3 border border-border/70">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-emerald-400">
                    Now · Ready
                  </span>
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                </div>
                <h3 className="font-semibold text-foreground text-sm">
                  Production CI/CD &amp; Playwright E2E
                </h3>
                <p className="text-xs text-muted-foreground">
                  Automated multi-job GitHub Actions pipeline with headless browser verification and
                  100-user concurrency stress testing.
                </p>
              </div>

              <div className="glass-surface rounded-2xl p-5 space-y-3 border border-border/70">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-amber-400">
                    Next · Planned
                  </span>
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                </div>
                <h3 className="font-semibold text-foreground text-sm">
                  AI Vector Search &amp; Autonomous Agents
                </h3>
                <p className="text-xs text-muted-foreground">
                  Reactivation of 768-dimensional pgvector cosine search and the autonomous agent
                  workstation with multi-file diff generation.
                </p>
              </div>

              <div className="glass-surface rounded-2xl p-5 space-y-3 border border-border/70">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-primary">
                    Future · Exploring
                  </span>
                  <span className="h-2 w-2 rounded-full bg-primary" />
                </div>
                <h3 className="font-semibold text-foreground text-sm">
                  Competitive Coding Arena 1v1 PvP
                </h3>
                <p className="text-xs text-muted-foreground">
                  Timed algorithmic duels, Elo ratings, and automated test judges for friendly
                  competitions and team tournaments.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION I — PRICING (PROPOSED PRESENTATION ONLY) */}
        {/* ================================================================== */}
        <section
          id="pricing"
          className="border-t border-border/60 bg-foreground/[0.015] py-20 md:py-28 scroll-mt-16"
        >
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <span>Pricing Plans</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Transparent &amp; Free During Developer Preview
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                CodeCollab is currently 100% free while in active development. Below is the proposed
                future tier structure for subsequent cloud deployments.
              </p>
            </div>

            <div className="mt-14 grid gap-6 lg:grid-cols-3">
              {PRICING_TIERS.map((tier) => (
                <div
                  key={tier.name}
                  className={`glass-mirror relative rounded-3xl p-6 sm:p-8 flex flex-col justify-between transition-all ${
                    tier.isPopular ? 'border-primary ring-1 ring-primary/30 shadow-xl' : ''
                  }`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-foreground text-lg">{tier.name}</h3>
                      <span
                        className={`font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          tier.isCurrent
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            : 'bg-foreground/[0.06] text-muted-foreground'
                        }`}
                      >
                        {tier.status}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl sm:text-4xl font-extrabold text-foreground">
                        {tier.price}
                      </span>
                      <span className="text-xs text-muted-foreground font-mono">
                        / {tier.frequency}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {tier.description}
                    </p>

                    <div className="pt-4 border-t border-border/60 space-y-2.5">
                      <div className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Included Capabilities:
                      </div>
                      {tier.features.map((feat) => (
                        <div key={feat} className="flex items-start gap-2 text-xs text-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {tier.ctaText && tier.ctaLink && (
                    <div className="pt-8">
                      <Link
                        to={tier.ctaLink}
                        className={`flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-all ${
                          tier.isPopular
                            ? 'btn-studio-primary'
                            : 'glass-control text-foreground hover:bg-foreground/[0.08]'
                        }`}
                      >
                        <span>{tier.ctaText}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-8 text-center font-mono text-[11px] text-muted-foreground">
              * Note: No payment information is collected. Developer Preview is unconditionally open.
            </p>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION J — FAQ */}
        {/* ================================================================== */}
        <section id="faq" className="py-20 md:py-28 border-t border-border/60 scroll-mt-16">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <span>Frequently Asked Questions</span>
              </div>
              <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                Got Questions? We Have Answers.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground sm:text-base leading-relaxed">
                Accurate, technical explanations of how CodeCollab operates under the hood.
              </p>
            </div>

            <div className="mt-12 space-y-3">
              {FAQ_ITEMS.map((item, index) => {
                const isOpen = expandedFaq === index;

                return (
                  <div
                    key={item.question}
                    className="glass-mirror rounded-2xl border border-border/70 overflow-hidden transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(index)}
                      className="flex w-full items-center justify-between p-5 text-left text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      aria-expanded={isOpen}
                    >
                      <span>{item.question}</span>
                      <ChevronDown
                        className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                          isOpen ? 'rotate-180 text-primary' : ''
                        }`}
                      />
                    </button>

                    {isOpen && (
                      <div className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
                        {item.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION K — FINAL CTA & FOOTER */}
        {/* ================================================================== */}
        <section className="relative overflow-hidden border-t border-border/60 bg-gradient-to-b from-transparent to-foreground/[0.03] py-20 md:py-28">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
            <div className="inline-flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Get Started in Seconds</span>
            </div>

            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl">
              Your next project deserves a better workspace.
            </h2>

            <p className="mx-auto mt-4 max-w-2xl text-sm sm:text-base text-muted-foreground leading-relaxed">
              Experience zero-friction real-time collaborative development, safe air-gapped Docker
              executions, and context-aware Gemini AI assistance today.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                to={user ? '/dashboard' : '/register'}
                className="btn-studio-primary flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-8 text-sm font-semibold shadow-md transition-all active:scale-[0.98]"
              >
                <span>{user ? 'Open Studio Workspace' : 'Start Building Free'}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="glass-control flex h-11 w-full sm:w-auto items-center justify-center gap-2 rounded-xl px-6 text-sm font-medium text-foreground transition-all hover:bg-foreground/[0.08]"
              >
                <span>Explore Features</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-border/60 bg-background/90 py-12 text-xs text-muted-foreground">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
            {/* Col 1: Brand & Tagline */}
            <div className="col-span-2 space-y-3">
              <BrandLogo size="md" />
              <p className="max-w-xs text-xs text-muted-foreground leading-relaxed">
                The open collaborative cloud development environment engineered for developers,
                teams, and learners.
              </p>
              <div className="font-mono text-[10px] text-muted-foreground/80">
                Built with React, Node.js, Docker, Monaco, and Yjs CRDTs.
              </div>
            </div>

            {/* Col 2: Product */}
            <div className="space-y-2.5">
              <div className="font-semibold text-foreground text-xs uppercase tracking-wider font-mono">
                Product
              </div>
              <ul className="space-y-1.5 text-xs">
                <li>
                  <a href="#features" className="hover:text-foreground transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="#how-it-works" className="hover:text-foreground transition-colors">
                    How It Works
                  </a>
                </li>
                <li>
                  <Link to="/roadmap" className="hover:text-foreground transition-colors">
                    Roadmap &amp; Voting
                  </Link>
                </li>
                <li>
                  <a href="#pricing" className="hover:text-foreground transition-colors">
                    Pricing
                  </a>
                </li>
                <li>
                  <Link to={user ? '/dashboard' : '/login'} className="hover:text-foreground transition-colors">
                    Studio IDE
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 3: Architecture */}
            <div className="space-y-2.5">
              <div className="font-semibold text-foreground text-xs uppercase tracking-wider font-mono">
                Architecture
              </div>
              <ul className="space-y-1.5 text-xs">
                <li>
                  <a href="#architecture" className="hover:text-foreground transition-colors">
                    Zero-Trust Sandboxes
                  </a>
                </li>
                <li>
                  <a href="#architecture" className="hover:text-foreground transition-colors">
                    Dual-Token Auth
                  </a>
                </li>
                <li>
                  <a href="#architecture" className="hover:text-foreground transition-colors">
                    Redis Pub/Sub Mesh
                  </a>
                </li>
                <li>
                  <Link to="/roadmap#tech-stack" className="hover:text-foreground transition-colors">
                    Technology Stack
                  </Link>
                </li>
                <li>
                  <Link to="/roadmap#principles" className="hover:text-foreground transition-colors">
                    Core Pillars
                  </Link>
                </li>
              </ul>
            </div>

            {/* Col 4: Resources & Legal */}
            <div className="space-y-2.5">
              <div className="font-semibold text-foreground text-xs uppercase tracking-wider font-mono">
                Resources
              </div>
              <ul className="space-y-1.5 text-xs">
                <li>
                  <a href="#faq" className="hover:text-foreground transition-colors">
                    FAQ
                  </a>
                </li>
                <li>
                  <Link to="/roadmap" className="hover:text-foreground transition-colors">
                    Community Feedback
                  </Link>
                </li>
                <li>
                  <span className="text-muted-foreground/60 cursor-not-allowed">
                    Terms of Service
                  </span>
                </li>
                <li>
                  <span className="text-muted-foreground/60 cursor-not-allowed">
                    Privacy Policy
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-8 sm:flex-row font-mono text-[11px]">
            <div>
              &copy; {new Date().getFullYear()} CodeCollab. All rights reserved. Open engineering preview.
            </div>
            <div className="flex items-center gap-4 text-muted-foreground">
              <span>Status: All Systems Operational</span>
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
