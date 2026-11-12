export type ChatMessageType = 'user' | 'system';

export const CHAT_LIMITS = {
  MAX_MESSAGE_CHARS: 2_000,
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  RATE_LIMIT_MAX_MESSAGES: 15,
  RATE_LIMIT_WINDOW_SEC: 10,
} as const;

export interface ChatMessageAuthorDto {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface ChatFileReferenceDto {
  fileId: string;
  fileName: string;
  branchId: string | null;
  lineNumber: number | null;
}

export interface ChatMessageDto {
  id: string;
  projectId: string;
  branchId: string | null;
  type: ChatMessageType;
  content: string;
  author: ChatMessageAuthorDto | null;
  fileRef: ChatFileReferenceDto | null;
  createdAt: string;
}

/** Canonical Socket.IO room identifier for workspace team chat. */
export const buildProjectChatRoomKey = (projectId: string): string =>
  `chat:project:${projectId}`;
