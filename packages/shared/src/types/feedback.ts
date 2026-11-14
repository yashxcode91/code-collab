export type FeedbackCategory =
  | 'Editor'
  | 'AI'
  | 'Infrastructure'
  | 'Collaboration'
  | 'Competitive';

export interface FeedbackItem {
  id: string;
  title: string;
  description: string;
  category: FeedbackCategory;
  votes: number;
  userVoted?: boolean;
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
}
