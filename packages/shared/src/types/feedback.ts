export type FeedbackCategory =
  | 'Editor'
  | 'AI'
  | 'Infrastructure'
  | 'Collaboration'
  | 'Competitive';

export type VoteDirection = 'up' | 'down';

export interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  category: FeedbackCategory;
  votes: number;
  userVoted?: boolean;
  userVoteDirection?: VoteDirection | null;
  authorName?: string;
  createdAt: string;
}

export interface CreateFeedbackInput {
  title: string;
  description: string;
  category: FeedbackCategory;
}

export interface VoteFeedbackResponse {
  id: string;
  votes: number;
  userVoted: boolean;
  userVoteDirection?: VoteDirection | null;
}
