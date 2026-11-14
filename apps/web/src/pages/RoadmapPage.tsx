import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Code2,
  Cpu,
  Layers,
  MessageSquare,
  Network,
  Rocket,
  Search,
  Server,
  Shield,
  Terminal,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeedbackCategory, FeedbackItem } from '@codecollab/shared';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { useAuth } from '@/context/AuthContext';
import {
  createFeedback,
  fetchFeedback,
  queryKeys,
  voteFeedback,
} from '@/lib/queries';

// ============================================================================
// TYPES & STATUSES
// ============================================================================

export type FeatureStatus =
  | 'Completed'
  | 'In Progress'
  | 'Planned'
  | 'Exploring'
  | 'Temporarily Disabled';

export type RoadmapCategory = 'now' | 'next' | 'future';

interface RoadmapItem {
  id: string;
  title: string;
  category: RoadmapCategory;
  categoryLabel: string;
  status: FeatureStatus;
  summary: string;
  details: string[];
  techPills: string[];
  deferredNote?: string;
  verifiedStatus?: string;
}

interface TechCategory {
  id: string;
  title: string;
  icon: string;
  items: Array<{ name: string; version?: string; role: string }>;
}

type CommunityFeature = FeedbackItem;

// ============================================================================
// DATA SETS (VERIFIED CODECOLLAB DATA)
// ============================================================================

const ROADMAP_ITEMS: RoadmapItem[] = [
  // NOW: Production Readiness
  {
    id: 'prod-deploy',
    title: 'Multi-Stage Production Containerization',
    category: 'now',
    categoryLabel: 'Now — Production Readiness',
    status: 'Completed',
    summary:
      'Ultra-lean multi-stage Alpine Dockerfiles for Web (Vite + Nginx <25MB), Server (Node 20 non-root), and Worker runner with automated health probes.',
    details: [
      'Multi-stage Dockerfile.web building static SPA assets served via Nginx Alpine',
      'Dockerfile.server running under unprivileged node:1000 with Docker Compose health probes',
      'Dockerfile.worker with Docker CLI integration for isolated sandbox provisioning',
      'Automated pre-flight verification scripts covering TypeScript strictness and test suites',
    ],
    techPills: ['Docker', 'Nginx', 'Node.js 20', 'Alpine Linux', 'Docker Compose'],
    verifiedStatus: 'Verified Day 12 Milestones (Dockerfiles & Compose Ready)',
  },
  {
    id: 'security-hardening',
    title: 'Security Hardening & Dual-Token Auth',
    category: 'now',
    categoryLabel: 'Now — Production Readiness',
    status: 'Completed',
    summary:
      'JWT Access + Refresh token rotation with cryptographic hashing, Helmet security headers, strict CORS origin controls, and seccomp container isolation.',
    details: [
      'Dual-token JWT architecture with auto-refresh rotation to prevent mid-session drops',
      'Helmet HTTP protection headers and fine-grained CORS domain whitelisting',
      'Container sandbox execution with network=none and memory/CPU quotas',
      'Zod request validation schema enforcement at all HTTP API boundaries',
    ],
    techPills: ['JWT', 'Bcrypt', 'Helmet', 'Zod', 'Seccomp'],
    verifiedStatus: 'Verified in Authentication and Docker modules',
  },
  {
    id: 'perf-optimization',
    title: 'Performance & Latency Optimization',
    category: 'now',
    categoryLabel: 'Now — Production Readiness',
    status: 'Completed',
    summary:
      'Nginx Gzip compression, immutable 1-year Vite static chunk caching, TanStack Query 30s stale times, and sub-25ms CRDT debouncing.',
    details: [
      'Nginx edge configuration with gzip level 6 for SVG, JS, CSS, and JSON payloads',
      'Cache-Control: public, max-age=31536000, immutable for hashed client assets',
      'TanStack React Query deduplication with single retry policy for transient blips',
      'Yjs document updates batched over WebSockets without blocking Monaco UI thread',
    ],
    techPills: ['Nginx', 'HTTP/1.1 Keepalive', 'TanStack Query', 'Yjs CRDT'],
    verifiedStatus: 'Verified Day 12 Production Gateway',
  },
  {
    id: 'monitoring-observability',
    title: 'Monitoring, Metrics & Observability',
    category: 'now',
    categoryLabel: 'Now — Production Readiness',
    status: 'In Progress',
    summary:
      'Structured telemetry across PostgreSQL, Redis, BullMQ job queues, and WebSocket connection heartbeats with health endpoint telemetry.',
    details: [
      'Active /api/health endpoint reporting PostgreSQL, Redis, and memory telemetry',
      'BullMQ job queue monitoring tracking active, completed, and failed container runs',
      'Live Studio activity graph recording user event frequencies in PostgreSQL',
      'Structured JSON logging with request correlation IDs across services',
    ],
    techPills: ['BullMQ Telemetry', 'PostgreSQL', 'Redis', 'Winston/Morgan'],
    verifiedStatus: 'In Active Deployment',
  },
  {
    id: 'backup-dr',
    title: 'Disaster Recovery & State Persistence',
    category: 'now',
    categoryLabel: 'Now — Production Readiness',
    status: 'In Progress',
    summary:
      'Automated PostgreSQL snapshot backups, Redis Append-Only File (AOF) persistence, and workspace branch rollback checkpoints.',
    details: [
      'Database snapshot restoration drills for project workspaces and commit trees',
      'Redis AOF persistence mode configured for zero message-queue loss during restarts',
      'Workspace branch version snapshots enabling instant rollbacks to clean states',
    ],
    techPills: ['PostgreSQL pg_dump', 'Redis AOF', 'Docker Volumes'],
    verifiedStatus: 'In Active Deployment',
  },

  // NEXT: Planned Features (Including Deferred Items)
  {
    id: 'ai-vector-search',
    title: 'AI Semantic Vector Search Reactivation',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Temporarily Disabled',
    summary:
      'High-dimensional pgvector cosine similarity search across branch codebases. Backend is 100% complete and intact; UI temporarily defaults to <5ms direct search.',
    details: [
      'Backend pgvector embeddings, AST chunking, and similarity ranking fully operational in server',
      'Temporarily prioritized offline deterministic text search (<5ms) for live stability',
      'Next step: Add segmented control toggle [ Exact Code Search | AI Semantic Search ✨ ] in modal',
    ],
    techPills: ['pgvector', 'Google Gemini Embeddings', 'AST Chunker', 'PostgreSQL'],
    deferredNote:
      'Backend 100% intact (apps/server/src/modules/ai/codebaseIndex.service.ts). Preserved in production database.',
    verifiedStatus: 'Deferred engineering item (docs/DEFERRED_TASKS.md)',
  },
  {
    id: 'agent-workstation',
    title: 'Autonomous Agent Workstation Reactivation',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Temporarily Disabled',
    summary:
      'Plan-and-solve agent that reads files, executes terminal tests, and creates multi-file staged diffs. Backend is 100% intact; UI currently displays maintenance banner.',
    details: [
      'Multi-file diff generator, Gemini agent loop, and tool registry fully functional in backend',
      'Temporarily disabled in StudioAgentDrawer.tsx to streamline live demo flows',
      'Next step: Re-enable goal textarea and execution button with automated Vitest coverage',
    ],
    techPills: ['Gemini 1.5 Pro', 'Autonomous Loop', 'Unified Diff', 'Optimistic Concurrency'],
    deferredNote:
      'Backend 100% intact (apps/server/src/modules/ai/agent.service.ts). Staged diff modal fully tested.',
    verifiedStatus: 'Deferred engineering item (docs/DEFERRED_TASKS.md)',
  },
  {
    id: 'ai-multithread-history',
    title: 'Multi-Thread AI Conversation Switcher',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Temporarily Disabled',
    summary:
      'Persistent multi-thread AI conversation history. Database models and REST APIs are 100% complete; UI streamlined to single session to eliminate dropdown race conditions.',
    details: [
      'Prisma schema models (AiConversation, AiMessage) and full CRUD endpoints live in production',
      'Temporarily converted to single-session workflow in StudioAiDrawer.tsx to eliminate dropdown UI glitches',
      'Next step: Implement a dedicated conversation history popover with explicit draft state machine',
    ],
    techPills: ['Prisma ORM', 'PostgreSQL', 'React Query', 'State Machine'],
    deferredNote:
      'Backend endpoints live (/api/v1/projects/:id/branches/:id/ai/conversations). Fully tested.',
    verifiedStatus: 'Deferred engineering item (docs/DEFERRED_TASKS.md)',
  },
  {
    id: 'cross-origin-isolation',
    title: 'Cross-Origin Isolation (COOP / COEP) Safeguards',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Temporarily Disabled',
    summary:
      'Isolated execution security headers for high-resolution SharedArrayBuffer timers. Headers deferred to ensure seamless cross-origin preview iframe embedding.',
    details: [
      'Evaluation of Cross-Origin-Opener-Policy (same-origin) and Cross-Origin-Embedder-Policy (require-corp)',
      'Temporarily deferred to allow sandbox web preview iframes to embed external HTTP/HTTPS assets without strict corp blocking',
      'Next step: Implement credentialless COEP or dedicated subdomain isolation for iframe sandboxes',
    ],
    techPills: ['COOP', 'COEP', 'SharedArrayBuffer', 'Nginx Security Headers', 'Iframe Sandboxing'],
    deferredNote:
      'Deferred architectural item (docs/day-09/CodeCollab_Day_09_Complete_Technical_Guide.md). Subdomain isolation planned for post-demo phase.',
    verifiedStatus: 'Deferred security architecture item',
  },
  {
    id: 'ai-code-review',
    title: 'Advanced AI Code Review & Security Audits',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Planned',
    summary:
      'Context-aware automated PR and branch diff analysis checking for memory leaks, type safety regressions, authorization bypasses, and algorithmic bottlenecks.',
    details: [
      'Multi-file AST inspection comparing base branch against active working tree',
      'Severity-ranked vulnerability reporting (Critical, High, Medium, Info)',
      'Automated fix recommendations with one-click inline patch application',
    ],
    techPills: ['Gemini 2.0', 'AST Parser', 'Unified Diff', 'Security Heuristics'],
  },
  {
    id: 'github-integration',
    title: 'GitHub Bi-Directional Integration',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Planned',
    summary:
      'OAuth2 GitHub linking allowing bidirectional repository import, live branch synchronization, pull request creation, and remote commit pushing.',
    details: [
      'OAuth2 app integration for repository read/write access',
      'One-click clone from GitHub repositories directly into isolated Studio workspaces',
      'Commit and push directly to GitHub branches with GPG signed authorship',
    ],
    techPills: ['GitHub REST & GraphQL API', 'OAuth2', 'Git CLI', 'SSH Keys'],
  },
  {
    id: 'workspace-templates',
    title: 'Custom User Workspace Templates',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Planned',
    summary:
      'Allow developers to publish reusable workspace blueprints including pre-configured dependencies, file trees, environment variables, and Docker run configurations.',
    details: [
      'Save any active workspace as an organization or public template blueprint',
      'Parameterizable environment files and container startup scripts',
      'Starter gallery with community ratings and dependency vulnerability scans',
    ],
    techPills: ['Prisma Schema', 'Dockerfiles', 'Package Registry', 'JSON Scaffolds'],
  },
  {
    id: 'team-orgs-rbac',
    title: 'Team Organizations & Advanced Permissions',
    category: 'next',
    categoryLabel: 'Next — Planned Features',
    status: 'Planned',
    summary:
      'Multi-user organizations with granular Role-Based Access Control (Owner, Admin, Member, Guest), audit logging, and domain SSO.',
    details: [
      'Organization workspaces with pooled resource quotas and billing',
      'Granular branch-level write locks and code review gate enforcement',
      'SAML 2.0 and OIDC Enterprise Single Sign-On (SSO)',
    ],
    techPills: ['RBAC', 'SAML 2.0', 'OIDC', 'Audit Logs', 'PostgreSQL'],
  },

  // FUTURE: Exploring
  {
    id: 'arena-pvp',
    title: 'Competitive Coding Arena & PvP Matchmaking',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Real-time head-to-head competitive coding battles with Elo matchmaking, automated online judge test validation, and anti-cheat analysis.',
    details: [
      'Synchronized 1v1 battle rooms with dual real-time Monaco editor views',
      'Sub-millisecond test case evaluation engine with hidden validation suites',
      'Dynamic Elo rating ladder and matchmaking queue powered by Redis sorted sets',
    ],
    techPills: ['Redis Sorted Sets', 'Seccomp Judge', 'Elo Engine', 'WebSockets'],
  },
  {
    id: 'live-contests',
    title: 'Live Contests, Tournaments & Global Leaderboards',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Scheduled global hackathons and timed algorithmic contests supporting thousands of concurrent competitors with live spectating.',
    details: [
      'High-throughput submission queue processing thousands of runs per minute',
      'Real-time scoreboard recalculations with penalty time logic',
      'Spectator mode with live syntax-highlighted code broadcast',
    ],
    techPills: ['BullMQ Cluster', 'Redis Pub/Sub', 'PostgreSQL', 'WebSockets'],
  },
  {
    id: 'webrtc-collab',
    title: 'WebRTC Audio/Video Collaboration',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Low-latency peer-to-peer voice huddles and crystal screen sharing built directly inside the Collaborative Studio.',
    details: [
      'Peer-to-peer mesh WebRTC audio channels for paired coding sessions',
      'Noise suppression and voice activity detection in the browser',
      'Selective forwarding unit (SFU) fallback for multi-user rooms',
    ],
    techPills: ['WebRTC', 'MediaSoup / Pion', 'DTLS-SRTP', 'Opus Audio'],
  },
  {
    id: 'webcontainers',
    title: 'WebContainers In-Browser Execution',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Run Node.js and client runtimes entirely within the browser via WebAssembly and shared array buffers, eliminating backend server container spin-up time.',
    details: [
      'Zero-latency compilation and execution inside WebAssembly micro-kernels',
      'Runs Node.js, npm, and dev servers entirely on client hardware',
      'Hybrid fallback to Docker containers for heavy C++, Python, and Java binaries',
    ],
    techPills: ['WebContainers API', 'WebAssembly', 'SharedArrayBuffer'],
  },
  {
    id: 'cloud-hosting',
    title: 'One-Click Cloud Deployment & Edge Hosting',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Deploy any web project from CodeCollab Studio to a globally distributed edge CDN with a custom domain and automated SSL certificates.',
    details: [
      'Instant container-to-static edge conversion with automated build detection',
      'Automated Let\'s Encrypt SSL provisioning and custom domain DNS routing',
      'Serverless function routing for dynamic API endpoints',
    ],
    techPills: ['Fly.io / Edge Clusters', 'Traefik', 'Let\'s Encrypt', 'Anycast DNS'],
  },
  {
    id: 'advanced-swarms',
    title: 'Autonomous Multi-Agent Swarms',
    category: 'future',
    categoryLabel: 'Future — Exploring',
    status: 'Exploring',
    summary:
      'Multi-agent collaborative pipelines where specialized agents (Architect, Implementer, Security Reviewer, Test Writer) collaborate concurrently on complex tasks.',
    details: [
      'Role-based agent division of labor with inter-agent message passing',
      'Parallel branch generation with automated consensus verification',
      'Comprehensive audit trails of every agent reasoning token and tool invocation',
    ],
    techPills: ['Gemini 2.0 Flash/Pro', 'Agent Swarm Protocol', 'Vector Memory'],
  },
];

const TECH_CATEGORIES: TechCategory[] = [
  {
    id: 'frontend',
    title: 'Frontend & Client Architecture',
    icon: 'Layout',
    items: [
      { name: 'React', version: 'v18.3.1', role: 'Component-driven UI architecture & hooks' },
      { name: 'TypeScript', version: 'v5.4.5', role: 'Strict end-to-end static type verification' },
      { name: 'Vite', version: 'v5.2.0', role: 'Sub-second ESM build tooling & HMR' },
      { name: 'Monaco Editor', version: 'v0.47.0', role: 'Flagship IDE code editor & diff viewer' },
      { name: 'Tailwind CSS', version: 'v3.4.1', role: 'Utility-first styling & Solar Tangerine tokens' },
      { name: 'Motion', version: 'v12.4.7', role: 'Fluid spring physics & layout transitions' },
      { name: 'TanStack React Query', version: 'v5.28.4', role: 'Declarative async data caching & mutations' },
      { name: 'Lucide React', version: 'v0.363.0', role: 'Crisp SVG iconography & telemetry glyphs' },
    ],
  },
  {
    id: 'backend',
    title: 'Backend & Application Tier',
    icon: 'Server',
    items: [
      { name: 'Node.js', version: 'v20.x Alpine', role: 'LTS asynchronous runtime environment' },
      { name: 'Express', version: 'v4.19.2', role: 'Modular REST API & middleware routing' },
      { name: 'Socket.IO', version: 'v4.7.5', role: 'Low-latency bidirectional WebSocket transport' },
      { name: 'BullMQ', version: 'v5.7.0', role: 'Distributed job orchestration & background workers' },
      { name: 'node-pty', version: 'v1.0.2', role: 'Native Linux pseudoterminal terminal bindings' },
      { name: 'Zod', version: 'v3.22.4', role: 'Strict schema validation at all API boundaries' },
      { name: 'JSON Web Tokens', version: 'v9.0.2', role: 'Dual-token access & refresh rotation' },
    ],
  },
  {
    id: 'database',
    title: 'Database & Persistent Storage',
    icon: 'Database',
    items: [
      { name: 'PostgreSQL', version: 'v16.2', role: 'ACID relational database & document snapshots' },
      { name: 'Prisma ORM', version: 'v5.12.1', role: 'Type-safe database migrations & query client' },
      { name: 'Redis', version: 'v7.2.4', role: 'Pub/sub collaboration mesh, BullMQ, & caching' },
      { name: 'pgvector Extension', version: 'v0.6.0', role: 'High-dimensional vector similarity indexing' },
    ],
  },
  {
    id: 'collab',
    title: 'Real-Time Collaboration Mesh',
    icon: 'Network',
    items: [
      { name: 'Yjs', version: 'v13.6.14', role: 'Mathematical CRDT document model' },
      { name: 'y-monaco', version: 'v0.1.4', role: 'Live Monaco multi-cursor awareness binding' },
      { name: 'y-websocket', version: 'v1.5.0', role: 'Binary update serialization over WebSockets' },
      { name: 'Redis Pub/Sub Adapter', version: 'v4.6.0', role: 'Multi-node server message broadcast mesh' },
    ],
  },
  {
    id: 'ai-ml',
    title: 'AI & Machine Learning Engine',
    icon: 'Brain',
    items: [
      { name: 'Google Gemini 1.5 Pro', version: 'Latest', role: 'High-context reasoning & autonomous agent loop' },
      { name: 'Google Gemini 2.0 Flash', version: 'Latest', role: 'Sub-second real-time streaming assistant' },
      { name: 'Gemini Embeddings', version: 'text-embedding-004', role: '768-dimensional semantic code representations' },
      { name: 'AST Code Chunker', version: 'Custom', role: 'Syntax-aware function & class parsing' },
    ],
  },
  {
    id: 'devops',
    title: 'Infrastructure & Container DevOps',
    icon: 'Boxes',
    items: [
      { name: 'Docker Engine', version: 'v26.0.0', role: 'Multi-stage container execution sandboxes' },
      { name: 'Docker Compose', version: 'v2.26.1', role: '6-service production mesh orchestration' },
      { name: 'Nginx Reverse Proxy', version: 'v1.25.4-alpine', role: 'Edge gateway, rate limiting, & preview routing' },
      { name: 'Alpine Linux', version: 'v3.19', role: 'Minimalist secure base container distributions' },
    ],
  },
  {
    id: 'testing',
    title: 'Testing & Quality Assurance',
    icon: 'ShieldCheck',
    items: [
      { name: 'Vitest', version: 'v1.5.0', role: 'Ultra-fast Vite-native unit test runner' },
      { name: 'React Testing Library', version: 'v15.0.1', role: 'Accessible DOM-based user interaction tests' },
      { name: 'ESLint', version: 'v8.57.0', role: 'Strict code style and invariant linting' },
      { name: 'TypeScript Strict', version: 'v5.4.5', role: 'Zero-any compiler configuration' },
    ],
  },
];

const ENGINEERING_PRINCIPLES = [
  {
    title: 'Security-First Architecture',
    icon: 'Shield',
    highlight: 'Zero Trust & Hardened Sandboxes',
    desc: 'Every API request, WebSocket payload, and container execution is treated as untrusted. Dual-token JWTs, strict CORS, Zod validation, and unprivileged user execution are enforced across all layers.',
  },
  {
    title: 'Isolated Code Execution',
    icon: 'Terminal',
    highlight: 'Air-Gapped Container Runtimes',
    desc: 'Developer code never executes on the host application machine. All runs happen in ephemeral Docker sandboxes with network=none, 128MB RAM limits, and seccomp syscall blacklists.',
  },
  {
    title: 'Conflict-Free Real-Time Collaboration',
    icon: 'Network',
    highlight: 'Mathematical CRDT Guarantees',
    desc: 'Concurrent edits converge deterministically using Yjs CRDTs without merge conflicts or lost keystrokes. Sub-25ms latency with optional line-level collision prevention locks.',
  },
  {
    title: 'Modular Monorepo Architecture',
    icon: 'Layers',
    highlight: 'Clean Boundary Isolation',
    desc: 'Separation of concerns enforced by pnpm workspaces: @codecollab/shared houses validation schemas and types; @codecollab/database manages Prisma; web and server communicate strictly via typed contracts.',
  },
  {
    title: 'End-to-End Type Safety',
    icon: 'Code2',
    highlight: 'Zero Runtime Surprises',
    desc: 'Shared Zod schemas and TypeScript interfaces flow unbroken from PostgreSQL database models through Express REST endpoints down to React client components and Monaco buffers.',
  },
  {
    title: 'Scalable Infrastructure',
    icon: 'Server',
    highlight: 'Stateless Application Tier',
    desc: 'API servers are completely stateless, delegating coordination to Redis and persistent state to PostgreSQL. Nginx edge gateway delivers sub-second cached static assets with gzip compression.',
  },
  {
    title: 'User-Controlled AI Operations',
    icon: 'Brain',
    highlight: 'Human-in-the-Loop Verification',
    desc: 'AI agents propose structured multi-file diffs that developers must inspect and approve. Optimistic concurrency control (OCC) prevents race conditions and automated snapshots guarantee rollback.',
  },
];

const INITIAL_COMMUNITY_FEATURES: CommunityFeature[] = [
  {
    id: 'f-1',
    title: 'WebContainers In-Browser Node.js Execution',
    description: 'Run Node.js, npm, and dev servers 100% on client hardware without needing cloud container spin-up time.',
    category: 'Infrastructure',
    votes: 0,
    createdAt: '2026-11-10T12:00:00.000Z',
  },
  {
    id: 'f-2',
    title: 'GitHub Bi-Directional Commit & PR Sync',
    description: 'Link your GitHub account to push commits, create pull requests, and pull remote updates directly inside Studio.',
    category: 'Collaboration',
    votes: 0,
    createdAt: '2026-11-10T13:00:00.000Z',
  },
  {
    id: 'f-3',
    title: 'Competitive Coding Arena 1v1 PvP Battles',
    description: 'Challenge team members to timed algorithmic duels with live dual-editor views and automated test judges.',
    category: 'Competitive',
    votes: 0,
    createdAt: '2026-11-11T09:00:00.000Z',
  },
  {
    id: 'f-4',
    title: 'Multi-Thread AI Conversation Popover Drawer',
    description: 'Restore multi-thread chat switching with a clean popover drawer, search history, and export capabilities.',
    category: 'AI',
    votes: 0,
    createdAt: '2026-11-11T14:30:00.000Z',
  },
  {
    id: 'f-5',
    title: 'WebRTC In-Editor Audio Huddle Rooms',
    description: 'Hop into low-latency voice channels and share screens with workspace collaborators without third-party apps.',
    category: 'Collaboration',
    votes: 0,
    createdAt: '2026-11-12T10:15:00.000Z',
  },
  {
    id: 'f-6',
    title: 'AI Automated Security Audits on Branch Diffs',
    description: 'Receive instant vulnerability, memory leak, and SQL injection audits on any uncommitted branch changes.',
    category: 'AI',
    votes: 0,
    createdAt: '2026-11-12T16:00:00.000Z',
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export function RoadmapPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Navigation State
  const [activeRoadmapCategory, setActiveRoadmapCategory] = useState<'all' | RoadmapCategory>('all');
  const [roadmapSearch, setRoadmapSearch] = useState('');

  // Persistent Client Voter ID for guest upvoting
  const [clientVoterId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'anon';
    let stored = localStorage.getItem('cc_feedback_voter_id');
    if (!stored) {
      stored = `voter_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('cc_feedback_voter_id', stored);
    }
    return stored;
  });

  // Live Community Proposals Query
  const feedbackQuery = useQuery({
    queryKey: [...queryKeys.feedback.all, clientVoterId, user?.id],
    queryFn: () => fetchFeedback(clientVoterId),
    initialData: INITIAL_COMMUNITY_FEATURES.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      category: f.category,
      votes: 0,
      userVoted: false,
      userVoteDirection: null,
      createdAt: '2026-11-12T00:00:00.000Z',
    })),
  });

  // Display only official curated roadmap features for community voting (user submissions are sent directly to backend)
  const features = (feedbackQuery.data ?? []).filter((f) => f.id.startsWith('f-'));

  // Live Upvote / Downvote Mutation with Optimistic Updates (Up = Green, Down = Red)
  const voteMutation = useMutation({
    mutationFn: ({ featureId, direction }: { featureId: string; direction: 'up' | 'down' }) =>
      voteFeedback(featureId, direction, clientVoterId),
    onMutate: async ({ featureId, direction }) => {
      const qk = [...queryKeys.feedback.all, clientVoterId, user?.id];
      await queryClient.cancelQueries({ queryKey: qk });
      const previous = queryClient.getQueryData<FeedbackItem[]>(qk);
      if (previous) {
        queryClient.setQueryData<FeedbackItem[]>(
          qk,
          previous.map((item) => {
            if (item.id !== featureId) return item;
            const currentDir = item.userVoteDirection ?? (item.userVoted ? 'up' : null);
            let nextDir: 'up' | 'down' | null = null;
            let voteDelta = 0;

            if (direction === 'up') {
              if (currentDir === 'up') {
                nextDir = null;
                voteDelta = -1;
              } else if (currentDir === 'down') {
                nextDir = 'up';
                voteDelta = 2;
              } else {
                nextDir = 'up';
                voteDelta = 1;
              }
            } else {
              if (currentDir === 'down') {
                nextDir = null;
                voteDelta = 1;
              } else if (currentDir === 'up') {
                nextDir = 'down';
                voteDelta = -2;
              } else {
                nextDir = 'down';
                voteDelta = -1;
              }
            }

            return {
              ...item,
              userVoted: nextDir !== null,
              userVoteDirection: nextDir,
              votes: item.votes + voteDelta,
            };
          }),
        );
      }
      return { previous, qk };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous && context.qk) {
        queryClient.setQueryData(context.qk, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.feedback.all });
    },
  });

  const handleVote = (featureId: string, direction: 'up' | 'down') => {
    voteMutation.mutate({ featureId, direction });
  };

  // Proposal Creation Mutation — sends directly to backend engineering backlog
  const createProposalMutation = useMutation({
    mutationFn: (input: { title: string; description: string; category: FeedbackCategory }) =>
      createFeedback(input, clientVoterId),
    onSuccess: () => {
      setSuggestTitle('');
      setSuggestDesc('');
      setSuggestSubmitted(true);
      setTimeout(() => setSuggestSubmitted(false), 4000);
    },
  });

  const [suggestTitle, setSuggestTitle] = useState('');
  const [suggestDesc, setSuggestDesc] = useState('');
  const [suggestCategory, setSuggestCategory] = useState<FeedbackCategory>('Editor');
  const [suggestSubmitted, setSuggestSubmitted] = useState(false);

  const handleSuggestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!suggestTitle.trim() || !suggestDesc.trim()) return;

    createProposalMutation.mutate({
      title: suggestTitle.trim(),
      description: suggestDesc.trim(),
      category: suggestCategory,
    });
  };

  // Filtered Roadmap Items
  const filteredRoadmapItems = ROADMAP_ITEMS.filter((item) => {
    const matchesCategory =
      activeRoadmapCategory === 'all' || item.category === activeRoadmapCategory;
    const matchesSearch =
      roadmapSearch.trim() === '' ||
      item.title.toLowerCase().includes(roadmapSearch.toLowerCase()) ||
      item.summary.toLowerCase().includes(roadmapSearch.toLowerCase()) ||
      item.techPills.some((p) => p.toLowerCase().includes(roadmapSearch.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  // Section A Horizontal Scroll Wheel & Progress Tracking
  const roadmapScrollRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const el = roadmapScrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Map vertical wheel scroll to horizontal scrolling across roadmap cards
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const canScrollLeft = el.scrollLeft > 0;
        const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;

        if ((e.deltaY > 0 && canScrollRight) || (e.deltaY < 0 && canScrollLeft)) {
          e.preventDefault();
          el.scrollBy({ left: e.deltaY * 1.25, behavior: 'auto' });
        }
      }
    };

    const updateProgress = () => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (maxScroll <= 0) {
        setScrollProgress(0);
      } else {
        setScrollProgress(Math.min(100, Math.max(0, (el.scrollLeft / maxScroll) * 100)));
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', updateProgress);
    };
  }, [filteredRoadmapItems.length]);

  useEffect(() => {
    if (roadmapScrollRef.current) {
      roadmapScrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
    }
  }, [activeRoadmapCategory]);

  const scrollRoadmap = (direction: 'left' | 'right') => {
    if (roadmapScrollRef.current) {
      const offset = direction === 'left' ? -350 : 350;
      roadmapScrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative min-h-dvh bg-background text-foreground selection:bg-primary/25 selection:text-foreground">
      {/* Dynamic Background Grid & Solar Glow Mesh */}
      <StudioBackdrop />

      {/* ==================================================================== */}
      {/* TOP NAVIGATION BAR */}
      {/* ==================================================================== */}
      <header className="sticky top-4 z-40 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="glass-mirror flex items-center justify-between rounded-2xl px-4 py-3">
          {/* Left: Brand + Back to Studio */}
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="group inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
              <span>Studio</span>
            </Link>
            <div className="h-4 w-px bg-border/60" />
            <BrandLogo size="sm" />
          </div>

          {/* Center: In-Page Quick Section Anchors */}
          <nav aria-label="Roadmap sections" className="hidden items-center gap-1 md:flex">
            <a
              href="#roadmap"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              Roadmap
            </a>
            <a
              href="#tech-stack"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              Tech Stack
            </a>
            <a
              href="#principles"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              Principles
            </a>
            <a
              href="#feedback"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              Voting
            </a>
          </nav>

          {/* Right: Theme Toggle + User Pill */}
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user && (
              <span className="glass-control hidden rounded-xl px-2.5 py-1 font-mono text-xs text-foreground sm:inline-flex">
                @{user.username}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* MAIN CONTENT CONTAINER */}
      {/* ==================================================================== */}
      <main className="relative z-10 mx-auto w-full max-w-7xl space-y-12 sm:space-y-14 px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        {/* ================================================================== */}
        {/* HERO SECTION */}
        {/* ================================================================== */}
        <section className="glass-mirror relative overflow-hidden rounded-2xl p-6 sm:p-8 lg:p-10">
          {/* Subtle Ambient Radial Highlight */}
          <div
            className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-primary/15 blur-3xl"
            aria-hidden="true"
          />

          <div className="relative z-10 max-w-3xl space-y-4">
            {/* Architectural Status Pills */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="glass-control inline-flex items-center gap-2 rounded-full px-3 py-1 font-mono text-xs font-medium text-foreground">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Devora / CodeCollab Engine v0.12.0
              </span>
              <span className="glass-control rounded-full px-3 py-1 font-mono text-xs text-muted-foreground">
                Solar Tangerine Design System
              </span>
              <span className="glass-control rounded-full px-3 py-1 font-mono text-xs text-primary">
                Production-Ready
              </span>
            </div>

            {/* Required Hero Heading & Description */}
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
              The Future of Collaborative Development
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Explore what's coming next, the technologies we're building with, and the architecture powering the next generation of developer collaboration.
            </p>
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION A — PRODUCT ROADMAP */}
        {/* ================================================================== */}
        <section id="roadmap" className="space-y-6 scroll-mt-20">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <Rocket className="h-3.5 w-3.5" />
                <span>Section A · Product Roadmap</span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Engineering Horizons & Milestones
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                Track production readiness, active feature iterations, and long-term research initiatives.
              </p>
            </div>

            {/* Category Filter Pills & Search & Carousel Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="glass-control flex items-center rounded-xl p-0.5">
                {(
                  [
                    { id: 'all', label: 'All Horizons' },
                    { id: 'now', label: 'Now · Ready' },
                    { id: 'next', label: 'Next · Planned' },
                    { id: 'future', label: 'Future · Exploring' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveRoadmapCategory(tab.id)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeRoadmapCategory === tab.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Quick Search */}
              <div className="glass-control flex items-center rounded-xl px-2.5 py-0.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Filter features…"
                  value={roadmapSearch}
                  onChange={(e) => setRoadmapSearch(e.target.value)}
                  className="w-24 bg-transparent px-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none sm:w-32"
                />
              </div>

              {/* Left / Right Carousel Navigation Buttons */}
              <div className="hidden sm:flex items-center gap-1 glass-control rounded-xl p-0.5">
                <button
                  type="button"
                  onClick={() => scrollRoadmap('left')}
                  title="Scroll left"
                  aria-label="Scroll left"
                  className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollRoadmap('right')}
                  title="Scroll right"
                  aria-label="Scroll right"
                  className="rounded-lg p-1 text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground transition-colors"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Roadmap Horizontal Scroll Wheel / Rail */}
          <div className="relative group">
            {/* Horizontal Scroll Rail */}
            <div
              ref={roadmapScrollRef}
              className="flex gap-3.5 overflow-x-auto pb-2 pt-1 snap-x snap-mandatory scroll-smooth no-scrollbar"
              tabIndex={0}
              role="region"
              aria-label="Roadmap initiatives scroll rail"
            >
              {filteredRoadmapItems.map((item) => (
                <RoadmapCard key={item.id} item={item} />
              ))}
            </div>

            {/* Scroll Indicator & Progress Bar */}
            <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground px-1">
              <span className="font-mono text-[10px]">
                Scroll wheel / drag horizontally · {filteredRoadmapItems.length} initiatives
              </span>
              <div className="flex items-center gap-2">
                <div className="h-1 w-24 sm:w-36 rounded-full bg-foreground/[0.08] overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-150 rounded-full"
                    style={{ width: `${Math.max(8, scrollProgress)}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] w-8 text-right">
                  {Math.round(scrollProgress)}%
                </span>
              </div>
            </div>
          </div>

          {filteredRoadmapItems.length === 0 && (
            <div className="glass-mirror rounded-2xl p-6 text-center">
              <p className="font-mono text-xs text-muted-foreground">
                No roadmap initiatives match the current filter "{roadmapSearch}".
              </p>
            </div>
          )}
        </section>

        {/* ================================================================== */}
        {/* SECTION B — TECHNOLOGY STACK */}
        {/* ================================================================== */}
        <section id="tech-stack" className="space-y-6 scroll-mt-20">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              <Cpu className="h-3.5 w-3.5" />
              <span>Section B · Technology Stack</span>
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Production Stack & Libraries
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              Accurately cataloged framework dependencies, database engines, and runtime systems powering CodeCollab.
            </p>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {TECH_CATEGORIES.map((category) => (
              <div key={category.id} className="glass-mirror rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                  <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    {category.title}
                  </h3>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {category.items.length} Packages
                  </span>
                </div>

                <div className="space-y-1.5">
                  {category.items.map((item) => (
                    <div
                      key={item.name}
                      className="glass-control flex items-center justify-between rounded-xl px-2.5 py-1.5 text-xs"
                    >
                      <div>
                        <div className="font-medium text-foreground">{item.name}</div>
                        <div className="text-[10px] text-muted-foreground">{item.role}</div>
                      </div>
                      {item.version && (
                        <span className="font-mono text-[10px] font-semibold text-primary">
                          {item.version}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION C — ENGINEERING PRINCIPLES */}
        {/* ================================================================== */}
        <section id="principles" className="space-y-6 scroll-mt-20">
          <div>
            <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
              <Shield className="h-3.5 w-3.5" />
              <span>Section C · Engineering Principles</span>
            </div>
            <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Core Architectural Pillars
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
              The foundational design choices and non-negotiable guarantees governing every line of CodeCollab code.
            </p>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {ENGINEERING_PRINCIPLES.map((principle, index) => (
              <div
                key={principle.title}
                className="glass-mirror relative rounded-2xl p-4 sm:p-5 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {renderIcon(principle.icon)}
                  </div>
                  <span className="font-mono text-xs font-bold text-muted-foreground/50">
                    0{index + 1}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {principle.title}
                  </h3>
                  <div className="font-mono text-[11px] font-medium text-primary">
                    {principle.highlight}
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {principle.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ================================================================== */}
        {/* SECTION D — COMMUNITY FEEDBACK & FEATURE VOTING */}
        {/* ================================================================== */}
        <section id="feedback" className="space-y-6 scroll-mt-20">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-wider text-primary">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Section D · Community Feedback</span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Community Feature Voting & Proposals
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                Vote on upcoming capabilities or propose custom workflow tooling to guide development priority.
              </p>
            </div>

            {/* Live Voting Status Badge */}
            <div className="glass-control inline-flex items-center gap-2 rounded-xl px-2.5 py-1 text-xs text-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                Live Community Engine · Backed by Node & Express
              </span>
            </div>
          </div>

          {/* Voting Grid */}
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => {
              const userVoteDirection =
                feature.userVoteDirection ?? (feature.userVoted ? 'up' : null);

              return (
                <div
                  key={feature.id}
                  className="glass-mirror flex flex-col justify-between rounded-2xl p-4 space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="rounded-md bg-foreground/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {feature.category}
                      </span>
                      <span
                        className={`font-mono text-xs font-semibold ${
                          feature.votes > 0
                            ? 'text-emerald-400'
                            : feature.votes < 0
                              ? 'text-rose-400'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {feature.votes > 0 ? `+${feature.votes}` : feature.votes}{' '}
                        {Math.abs(feature.votes) === 1 ? 'vote' : 'votes'}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground text-sm">
                      {feature.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                    {feature.authorName && (
                      <div className="font-mono text-[10px] text-muted-foreground/70 pt-0.5">
                        By {feature.authorName}
                      </div>
                    )}
                  </div>

                  {/* Dual Action Voting: Upvote (Green) & Downvote (Red) */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => handleVote(feature.id, 'up')}
                      className={`flex-1 flex h-8.5 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-all border ${
                        userVoteDirection === 'up'
                          ? 'bg-emerald-600 border-emerald-500 text-white shadow-sm shadow-emerald-600/30'
                          : 'glass-control border-border/60 text-muted-foreground hover:text-emerald-400 hover:border-emerald-500/40 hover:bg-emerald-500/10'
                      }`}
                      title={userVoteDirection === 'up' ? 'Remove Upvote' : 'Upvote Feature'}
                      aria-label={userVoteDirection === 'up' ? 'Remove Upvote' : 'Upvote Feature'}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                      <span>Upvote</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleVote(feature.id, 'down')}
                      className={`flex-1 flex h-8.5 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-all border ${
                        userVoteDirection === 'down'
                          ? 'bg-rose-600 border-rose-500 text-white shadow-sm shadow-rose-600/30'
                          : 'glass-control border-border/60 text-muted-foreground hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10'
                      }`}
                      title={userVoteDirection === 'down' ? 'Remove Downvote' : 'Downvote Feature'}
                      aria-label={userVoteDirection === 'down' ? 'Remove Downvote' : 'Downvote Feature'}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                      <span>Downvote</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Feature Suggestion Form */}
          <div className="glass-mirror rounded-2xl p-5 sm:p-6 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-foreground">
                  Propose a Feature or Improvement
                </h3>
                <p className="text-xs text-muted-foreground">
                  Submit a new capability directly to the CodeCollab engineering backlog.
                </p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                Sent directly to backend
              </span>
            </div>

            <form onSubmit={handleSuggestSubmit} className="space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label
                    htmlFor="suggest-title"
                    className="block font-mono text-[11px] text-muted-foreground mb-1"
                  >
                    Feature Title
                  </label>
                  <input
                    id="suggest-title"
                    type="text"
                    required
                    placeholder="e.g. AI-assisted Git Conflict Resolver"
                    value={suggestTitle}
                    onChange={(e) => setSuggestTitle(e.target.value)}
                    className="w-full glass-control rounded-xl px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label
                    htmlFor="suggest-category"
                    className="block font-mono text-[11px] text-muted-foreground mb-1"
                  >
                    Category
                  </label>
                  <select
                    id="suggest-category"
                    value={suggestCategory}
                    onChange={(e) =>
                      setSuggestCategory(e.target.value as FeedbackCategory)
                    }
                    className="w-full glass-control rounded-xl px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="Editor">Editor & UI</option>
                    <option value="AI">AI & Agents</option>
                    <option value="Infrastructure">Infrastructure</option>
                    <option value="Collaboration">Collaboration</option>
                    <option value="Competitive">Competitive Arena</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  htmlFor="suggest-desc"
                  className="block font-mono text-[11px] text-muted-foreground mb-1"
                >
                  Feature Description & Impact
                </label>
                <textarea
                  id="suggest-desc"
                  required
                  rows={2}
                  placeholder="Explain why this feature matters and how developers would use it..."
                  value={suggestDesc}
                  onChange={(e) => setSuggestDesc(e.target.value)}
                  className="w-full glass-control rounded-xl p-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex items-center justify-between">
                {suggestSubmitted ? (
                  <span className="font-mono text-xs font-semibold text-primary">
                    ✓ Proposal submitted to the engineering team!
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Submissions are sent directly to the backend engineering team for review.
                  </span>
                )}
                <button
                  type="submit"
                  disabled={createProposalMutation.isPending}
                  className="btn-studio-primary inline-flex h-8.5 items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold disabled:opacity-50"
                >
                  <span>
                    {createProposalMutation.isPending
                      ? 'Submitting…'
                      : 'Submit Proposal'}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </form>
          </div>
        </section>

        {/* ================================================================== */}
        {/* FOOTER CALLOUT */}
        {/* ================================================================== */}
        <footer className="glass-mirror flex flex-col items-center justify-between gap-4 rounded-2xl p-4 sm:p-5 text-center sm:flex-row sm:text-left">
          <div className="space-y-0.5">
            <div className="font-semibold text-foreground text-sm">
              Ready to collaborate in real-time?
            </div>
            <div className="text-xs text-muted-foreground">
              Return to your Studio workspace to write, review, and test code live.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="btn-studio-primary inline-flex h-8.5 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Studio</span>
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}

// ============================================================================
// HELPER SUB-COMPONENTS
// ============================================================================

function RoadmapCard({ item }: { item: RoadmapItem }) {
  return (
    <div className="glass-mirror flex flex-col justify-between rounded-2xl p-4 space-y-3 w-[290px] sm:w-[330px] shrink-0 snap-start h-[340px]">
      <div className="space-y-2 overflow-hidden">
        {/* Top: Category Tag & Status Badge */}
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] text-muted-foreground truncate">
            {item.categoryLabel}
          </span>
          <StatusBadge status={item.status} />
        </div>

        {/* Title */}
        <h3 className="font-semibold text-foreground text-sm line-clamp-1" title={item.title}>
          {item.title}
        </h3>

        {/* Summary */}
        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
          {item.summary}
        </p>

        {/* Details list */}
        <ul className="space-y-1 text-[11px] text-muted-foreground/80 pt-0.5">
          {item.details.slice(0, 3).map((detail, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="mt-1 h-1 w-1 rounded-full bg-primary shrink-0" />
              <span className="line-clamp-1">{detail}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom: Tech Pills & Verification Tag */}
      <div className="space-y-2 pt-2 border-t border-border/50 shrink-0">
        <div className="flex flex-wrap gap-1">
          {item.techPills.slice(0, 4).map((pill) => (
            <span
              key={pill}
              className="rounded-md bg-foreground/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground"
            >
              {pill}
            </span>
          ))}
        </div>
        {item.verifiedStatus && (
          <div className="font-mono text-[10px] text-primary flex items-center gap-1 truncate" title={item.verifiedStatus}>
            <CheckCircle2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{item.verifiedStatus}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: FeatureStatus }) {
  switch (status) {
    case 'Completed':
      return (
        <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Completed
        </span>
      );
    case 'In Progress':
      return (
        <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          In Progress
        </span>
      );
    case 'Planned':
      return (
        <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-sky-400">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
          Planned
        </span>
      );
    case 'Exploring':
      return (
        <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-purple-400">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
          Exploring
        </span>
      );
    case 'Temporarily Disabled':
      return (
        <span className="glass-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-medium text-rose-400">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          Deferred
        </span>
      );
  }
}

function renderIcon(name: string) {
  switch (name) {
    case 'Code2':
      return <Code2 className="h-5 w-5" />;
    case 'Terminal':
      return <Terminal className="h-5 w-5" />;
    case 'Brain':
      return <Brain className="h-5 w-5" />;
    case 'Shield':
      return <Shield className="h-5 w-5" />;
    case 'Network':
      return <Network className="h-5 w-5" />;
    case 'Layers':
      return <Layers className="h-5 w-5" />;
    case 'Server':
      return <Server className="h-5 w-5" />;
    default:
      return <Cpu className="h-5 w-5" />;
  }
}
