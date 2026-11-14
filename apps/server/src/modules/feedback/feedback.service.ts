import fs from 'node:fs';
import path from 'node:path';
import type {
  CreateFeedbackInput,
  FeedbackCategory,
  FeedbackItem,
  VoteFeedbackResponse,
} from '@codecollab/shared';

interface StoredFeedbackItem {
  id: string;
  title: string;
  description: string;
  category: FeedbackCategory;
  authorName?: string;
  createdAt: string;
  voterIds: string[];
}

interface StoredFeedbackData {
  items: StoredFeedbackItem[];
}

const DEFAULT_FEEDBACK_ITEMS: StoredFeedbackItem[] = [
  {
    id: 'f-1',
    title: 'WebContainers In-Browser Node.js Execution',
    description:
      'Run Node.js, npm, and dev servers 100% on client hardware without cloud container spin-up time.',
    category: 'Infrastructure',
    authorName: 'Core Architecture',
    createdAt: '2026-11-10T12:00:00.000Z',
    voterIds: [],
  },
  {
    id: 'f-2',
    title: 'GitHub Bi-Directional Commit & PR Sync',
    description:
      'Link your GitHub account to push commits, create pull requests, and pull remote updates directly inside Studio.',
    category: 'Collaboration',
    authorName: 'Core Architecture',
    createdAt: '2026-11-10T13:00:00.000Z',
    voterIds: [],
  },
  {
    id: 'f-3',
    title: 'Competitive Coding Arena 1v1 PvP Battles',
    description:
      'Challenge team members to timed algorithmic duels with live dual-editor views and automated test judges.',
    category: 'Competitive',
    authorName: 'Core Architecture',
    createdAt: '2026-11-11T09:00:00.000Z',
    voterIds: [],
  },
  {
    id: 'f-4',
    title: 'Multi-Thread AI Conversation Popover Drawer',
    description:
      'Restore multi-thread chat switching with a clean popover drawer, search history, and export capabilities.',
    category: 'AI',
    authorName: 'AI Subsystem',
    createdAt: '2026-11-11T14:30:00.000Z',
    voterIds: [],
  },
  {
    id: 'f-5',
    title: 'WebRTC In-Editor Audio Huddle Rooms',
    description:
      'Hop into low-latency voice channels and share screens with workspace collaborators without third-party apps.',
    category: 'Collaboration',
    authorName: 'Dev Experience',
    createdAt: '2026-11-12T10:15:00.000Z',
    voterIds: [],
  },
  {
    id: 'f-6',
    title: 'AI Automated Security Audits on Branch Diffs',
    description:
      'Receive instant vulnerability, memory leak, and SQL injection audits on any uncommitted branch changes.',
    category: 'AI',
    authorName: 'Security Ops',
    createdAt: '2026-11-12T16:00:00.000Z',
    voterIds: [],
  },
];

export class FeedbackService {
  private dataFilePath: string;
  private memoryCache: StoredFeedbackItem[] | null = null;

  constructor() {
    const dataDir = path.resolve(__dirname, '../../../data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {
        // Ignore if already exists or permissions handled
      }
    }
    this.dataFilePath = path.join(dataDir, 'feedback.json');
  }

  private loadItems(): StoredFeedbackItem[] {
    if (this.memoryCache) {
      return this.memoryCache;
    }

    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as StoredFeedbackData;
        if (Array.isArray(parsed?.items) && parsed.items.length > 0) {
          this.memoryCache = parsed.items;
          return this.memoryCache;
        }
      }
    } catch {
      // Fallback on corrupt or unreadable file
    }

    // Default initialization
    this.memoryCache = [...DEFAULT_FEEDBACK_ITEMS];
    this.saveItems(this.memoryCache);
    return this.memoryCache;
  }

  private saveItems(items: StoredFeedbackItem[]): void {
    this.memoryCache = items;
    try {
      const data: StoredFeedbackData = { items };
      fs.writeFileSync(this.dataFilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      // In constrained environments (e.g. read-only container), memoryCache retains state
      console.warn('[FeedbackService] Warning: Failed to persist to disk:', err);
    }
  }

  public resetData(): void {
    this.memoryCache = DEFAULT_FEEDBACK_ITEMS.map((it) => ({
      ...it,
      voterIds: [],
    }));
    this.saveItems(this.memoryCache);
  }

  public async getProposals(voterId?: string): Promise<FeedbackItem[]> {
    const items = this.loadItems();

    return items
      .map((item) => ({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        votes: item.voterIds.length,
        userVoted: voterId ? item.voterIds.includes(voterId) : false,
        authorName: item.authorName,
        createdAt: item.createdAt,
      }))
      .sort((a, b) => b.votes - a.votes);
  }

  public async createProposal(
    input: CreateFeedbackInput,
    authorName?: string,
    voterId?: string,
  ): Promise<FeedbackItem> {
    const items = this.loadItems();
    const id = `p_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const voterIds = voterId ? [voterId] : [];

    const newItem: StoredFeedbackItem = {
      id,
      title: input.title,
      description: input.description,
      category: input.category,
      authorName: authorName ?? 'Community Contributor',
      createdAt: new Date().toISOString(),
      voterIds,
    };

    const updated = [newItem, ...items];
    this.saveItems(updated);

    return {
      id: newItem.id,
      title: newItem.title,
      description: newItem.description,
      category: newItem.category,
      votes: newItem.voterIds.length,
      userVoted: Boolean(voterId),
      authorName: newItem.authorName,
      createdAt: newItem.createdAt,
    };
  }

  public async toggleVote(
    proposalId: string,
    voterId: string,
  ): Promise<VoteFeedbackResponse> {
    const items = this.loadItems();
    const target = items.find((it) => it.id === proposalId);

    if (!target) {
      throw new Error(`Proposal with ID "${proposalId}" not found`);
    }

    const hasVoted = target.voterIds.includes(voterId);
    if (hasVoted) {
      target.voterIds = target.voterIds.filter((id) => id !== voterId);
    } else {
      target.voterIds.push(voterId);
    }

    this.saveItems(items);

    return {
      id: target.id,
      votes: target.voterIds.length,
      userVoted: !hasVoted,
    };
  }
}

export const feedbackService = new FeedbackService();
