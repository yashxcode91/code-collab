import { z } from 'zod';
import { CHAT_LIMITS } from '../types/chat';
import { getUtf8ByteLength } from './execution';

/**
 * Rejects non-printable ASCII/C1 control bytes (NUL, ANSI ESC, DEL, CSI, etc.)
 * and Unicode BiDi override/isolate controls while preserving `\t`, `\n`, `\r`.
 */
export const hasDisallowedChatControlChars = (value: string): boolean => {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (
      code === 127 ||
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      (code >= 0x80 && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
};

const chatMessageBaseShape = {
  branchId: z.string().uuid('Invalid branch ID').nullable().optional(),
  content: z
    .string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(
      CHAT_LIMITS.MAX_MESSAGE_CHARS,
      `Message cannot exceed ${CHAT_LIMITS.MAX_MESSAGE_CHARS} characters`
    )
    .refine((value) => getUtf8ByteLength(value) <= 8_192, {
      message: 'Message exceeds 8192 UTF-8 byte limit',
    })
    .refine((value) => !hasDisallowedChatControlChars(value), {
      message: 'Message contains disallowed control or directional characters',
    }),
  fileId: z.string().uuid('Invalid file ID').nullable().optional(),
  lineNumber: z
    .number()
    .int('Line number must be an integer')
    .min(1, 'Line number must be at least 1')
    .max(1_000_000)
    .nullable()
    .optional(),
};

const validateLineReference = (data: {
  fileId?: string | null;
  lineNumber?: number | null;
}) => data.lineNumber == null || data.fileId != null;

export const CreateChatMessageSchema = z
  .object(chatMessageBaseShape)
  .refine(validateLineReference, {
    message: 'A file reference is required when specifying a line number',
    path: ['lineNumber'],
  });

export const ChatJoinLeaveSocketSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
});

export const ChatSendSocketSchema = z
  .object({
    projectId: z.string().uuid('Invalid project ID'),
    ...chatMessageBaseShape,
  })
  .refine(validateLineReference, {
    message: 'A file reference is required when specifying a line number',
    path: ['lineNumber'],
  });

export const ChatTypingSocketSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  isTyping: z.boolean(),
});

export const ChatHistoryQuerySchema = z.object({
  cursor: z.string().uuid('Invalid cursor message ID').optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CHAT_LIMITS.MAX_PAGE_SIZE)
    .default(CHAT_LIMITS.DEFAULT_PAGE_SIZE),
});

export type CreateChatMessageInput = z.infer<typeof CreateChatMessageSchema>;
export type ChatJoinLeaveSocketInput = z.infer<typeof ChatJoinLeaveSocketSchema>;
export type ChatSendSocketInput = z.infer<typeof ChatSendSocketSchema>;
export type ChatTypingSocketInput = z.infer<typeof ChatTypingSocketSchema>;
export type ChatHistoryQuery = z.infer<typeof ChatHistoryQuerySchema>;
