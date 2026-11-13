export const AI_LIMITS = {
  MAX_PROMPT_CHARS: 4_000,
  MAX_PROMPT_UTF8_BYTES: 16_384, // 16 KB max prompt payload
  MAX_TITLE_CHARS: 120,
  MAX_CONTEXT_FILE_BYTES: 100 * 1024, // 100 KB max context per file
  MAX_MESSAGES_PER_CONVERSATION: 50,
  DEFAULT_PAGE_SIZE: 30,
  MAX_PAGE_SIZE: 100,
  RATE_LIMIT_WINDOW_SEC: 60,
  RATE_LIMIT_MAX_PROMPTS: 20, // 20 AI prompts per minute per user
} as const;

export type AiMessageRole = 'user' | 'assistant' | 'system';

export type AiActionKind =
  | 'chat'
  | 'explain'
  | 'debug'
  | 'generate_tests'
  | 'review'
  | 'refactor';

export interface AiCodeContextDto {
  fileId?: string;
  fileName?: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface AiMessageDto {
  id: string;
  conversationId: string;
  role: AiMessageRole;
  actionKind: AiActionKind;
  content: string;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  codeContext: AiCodeContextDto | null;
  suggestedCode: string | null;
  createdAt: string;
}

export interface AiConversationSummaryDto {
  id: string;
  projectId: string;
  branchId: string;
  userId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDetailDto {
  conversation: AiConversationSummaryDto;
  messages: AiMessageDto[];
}

export interface AiPromptSelectionContext {
  startLine: number;
  endLine: number;
  text?: string;
}

export interface AiPromptContext {
  fileId?: string;
  selection?: AiPromptSelectionContext;
  executionRunId?: string;
  terminalError?: string;
}

export interface AiPromptRequest {
  conversationId?: string;
  actionKind: AiActionKind;
  prompt: string;
  context?: AiPromptContext;
}

/**
 * Server-Sent Events (SSE) data frame payloads sent over `text/event-stream`.
 */
export type AiStreamChunkDto =
  | {
      type: 'start';
      conversationId: string;
      messageId: string;
      model: string;
      actionKind: AiActionKind;
    }
  | {
      type: 'token';
      token: string;
    }
  | {
      type: 'action';
      actionKind: AiActionKind;
      suggestedCode?: string;
      explanation?: string;
    }
  | {
      type: 'done';
      message: AiMessageDto;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };
