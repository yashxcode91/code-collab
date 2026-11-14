import { z } from 'zod';
import { AGENT_LIMITS } from '../types/agent';

export const CreateAgentSessionSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, 'Prompt must be at least 3 characters')
    .max(
      AGENT_LIMITS.MAX_PROMPT_CHARS,
      `Prompt must be at most ${AGENT_LIMITS.MAX_PROMPT_CHARS} characters`
    ),
  title: z
    .string()
    .trim()
    .max(
      AGENT_LIMITS.MAX_TITLE_CHARS,
      `Title must be at most ${AGENT_LIMITS.MAX_TITLE_CHARS} characters`
    )
    .optional(),
  model: z.string().trim().optional(),
});

export type CreateAgentSessionInput = z.infer<typeof CreateAgentSessionSchema>;

export const ApplyStagedFilesSchema = z.object({
  filePaths: z.array(z.string().trim().min(1)).optional(),
});

export type ApplyStagedFilesInput = z.infer<typeof ApplyStagedFilesSchema>;

export const DiscardStagedFilesSchema = z.object({
  filePaths: z.array(z.string().trim().min(1)).optional(),
});

export type DiscardStagedFilesInput = z.infer<typeof DiscardStagedFilesSchema>;

// Tool input schemas
export const ReadFileToolInputSchema = z.object({
  path: z.string().trim().min(1, 'File path is required'),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
});

export type ReadFileToolInput = z.infer<typeof ReadFileToolInputSchema>;

export const WriteFileToolInputSchema = z.object({
  path: z.string().trim().min(1, 'File path is required'),
  content: z
    .string()
    .max(
      AGENT_LIMITS.MAX_FILE_WRITE_BYTES,
      `Content exceeds max file write bytes (${AGENT_LIMITS.MAX_FILE_WRITE_BYTES})`
    ),
});

export type WriteFileToolInput = z.infer<typeof WriteFileToolInputSchema>;

export const EditFileToolInputSchema = z.object({
  path: z.string().trim().min(1, 'File path is required'),
  target: z.string().min(1, 'Target text to replace is required'),
  replacement: z.string(),
});

export type EditFileToolInput = z.infer<typeof EditFileToolInputSchema>;

export const SearchCodebaseToolInputSchema = z.object({
  query: z.string().trim().min(2, 'Search query must be at least 2 characters'),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

export type SearchCodebaseToolInput = z.infer<typeof SearchCodebaseToolInputSchema>;

export const ListDirectoryToolInputSchema = z.object({
  path: z.string().trim().optional().default(''),
  recursive: z.boolean().optional().default(true),
});

export type ListDirectoryToolInput = z.infer<typeof ListDirectoryToolInputSchema>;

export const RunVerificationToolInputSchema = z.object({
  command: z.string().trim().optional().default('tsc --noEmit'),
});

export type RunVerificationToolInput = z.infer<typeof RunVerificationToolInputSchema>;
