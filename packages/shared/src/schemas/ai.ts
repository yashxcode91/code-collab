import { z } from 'zod';
import { AI_LIMITS } from '../types/ai';
import { hasDisallowedChatControlChars } from './chat';
import { getUtf8ByteLength } from './execution';

export const AiActionKindSchema = z.enum([
  'chat',
  'explain',
  'debug',
  'generate_tests',
  'review',
  'refactor',
]);

export const AiPromptSelectionContextSchema = z
  .object({
    startLine: z
      .number()
      .int('Start line must be an integer')
      .min(1, 'Start line must be at least 1')
      .max(1_000_000),
    endLine: z
      .number()
      .int('End line must be an integer')
      .min(1, 'End line must be at least 1')
      .max(1_000_000),
    text: z.string().max(10_000, 'Selection text too large').optional(),
  })
  .refine((data) => data.endLine >= data.startLine, {
    message: 'End line must be greater than or equal to start line',
  });

export const AiPromptContextSchema = z
  .object({
    fileId: z.string().uuid('Invalid file ID').optional(),
    selection: AiPromptSelectionContextSchema.optional(),
    executionRunId: z.string().uuid('Invalid execution run ID').optional(),
    terminalError: z
      .string()
      .max(5_000, 'Terminal error output too large')
      .optional(),
  })
  .optional();

export const AiPromptRequestSchema = z.object({
  conversationId: z.string().uuid('Invalid conversation ID').optional(),
  actionKind: AiActionKindSchema.default('chat'),
  prompt: z
    .string()
    .trim()
    .min(1, 'Prompt cannot be empty')
    .max(
      AI_LIMITS.MAX_PROMPT_CHARS,
      `Prompt cannot exceed ${AI_LIMITS.MAX_PROMPT_CHARS} characters`
    )
    .refine(
      (value) => getUtf8ByteLength(value) <= AI_LIMITS.MAX_PROMPT_UTF8_BYTES,
      {
        message: `Prompt exceeds ${AI_LIMITS.MAX_PROMPT_UTF8_BYTES} UTF-8 byte limit`,
      }
    )
    .refine((value) => !hasDisallowedChatControlChars(value), {
      message: 'Prompt contains disallowed control characters',
    }),
  context: AiPromptContextSchema,
});

export const ListAiConversationsQuerySchema = z.object({
  cursor: z.string().uuid('Invalid cursor UUID').optional(),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(AI_LIMITS.MAX_PAGE_SIZE, `Limit cannot exceed ${AI_LIMITS.MAX_PAGE_SIZE}`)
    .default(AI_LIMITS.DEFAULT_PAGE_SIZE),
});

export const ListAiMessagesQuerySchema = z.object({
  cursor: z.string().uuid('Invalid cursor UUID').optional(),
  limit: z.coerce
    .number()
    .int('Limit must be an integer')
    .min(1, 'Limit must be at least 1')
    .max(AI_LIMITS.MAX_PAGE_SIZE, `Limit cannot exceed ${AI_LIMITS.MAX_PAGE_SIZE}`)
    .default(AI_LIMITS.DEFAULT_PAGE_SIZE),
});

export type AiPromptRequestInput = z.infer<typeof AiPromptRequestSchema>;
export type ListAiConversationsQueryInput = z.infer<
  typeof ListAiConversationsQuerySchema
>;
export type ListAiMessagesQueryInput = z.infer<
  typeof ListAiMessagesQuerySchema
>;
