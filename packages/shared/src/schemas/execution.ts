import { z } from 'zod';
import { EXECUTION_LIMITS } from '../types/execution';
import { SafeNodeNameSchema, SupportedLanguageSchema } from './project';

const utf8Encoder = new TextEncoder();

/** Browser- and Node-compatible UTF-8 byte length counter for exact payload budgets. */
export const getUtf8ByteLength = (value: string): number =>
  utf8Encoder.encode(value).byteLength;

export const ExecutionStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'TIMEOUT',
  'CANCELLED',
]);

export const ExecutionFailureKindSchema = z.enum([
  'COMPILE_ERROR',
  'RUNTIME_ERROR',
  'TIMEOUT',
  'CANCELLED',
  'INFRASTRUCTURE',
]);

/**
 * Validates a `POST /runs` request.
 * Collaborators specify a language and either a `fileId` inside the branch
 * or an optional `sourceCode` buffer (still verified against `fileId` ACLs if provided).
 */
export const CreateExecutionRunSchema = z.object({
  fileId: z.string().uuid('Invalid file ID').nullable().optional(),
  entryFileName: SafeNodeNameSchema.optional(),
  language: SupportedLanguageSchema,
  sourceCode: z
    .string()
    .max(
      EXECUTION_LIMITS.MAX_SOURCE_CHARS,
      `Source code cannot exceed ${EXECUTION_LIMITS.MAX_SOURCE_CHARS} characters`
    )
    .refine(
      (value) => getUtf8ByteLength(value) <= EXECUTION_LIMITS.MAX_SOURCE_BYTES,
      `Source code cannot exceed ${EXECUTION_LIMITS.MAX_SOURCE_BYTES} UTF-8 bytes`
    )
    .optional(),
  initialStdin: z
    .string()
    .refine(
      (value) =>
        getUtf8ByteLength(value) <= EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES,
      `Initial stdin cannot exceed ${EXECUTION_LIMITS.MAX_STDIN_TOTAL_BYTES} bytes`
    )
    .optional(),
});

export const ExecutionStdinSchema = z.object({
  runId: z.string().uuid('Invalid execution run ID'),
  data: z
    .string()
    .min(1, 'Stdin input cannot be empty')
    .refine(
      (value) =>
        getUtf8ByteLength(value) <= EXECUTION_LIMITS.MAX_STDIN_CHUNK_BYTES,
      `Stdin chunk cannot exceed ${EXECUTION_LIMITS.MAX_STDIN_CHUNK_BYTES} bytes`
    ),
});

export const ExecutionJoinSocketSchema = z.object({
  projectId: z.string().uuid('Invalid project ID'),
  runId: z.string().uuid('Invalid execution run ID'),
});

export const ExecutionLeaveSocketSchema = z.object({
  runId: z.string().uuid('Invalid execution run ID'),
});

const workerEventBaseShape = {
  runId: z.string().uuid(),
  projectId: z.string().uuid(),
  branchId: z.string().uuid(),
  fileId: z.string().uuid().nullable(),
  timestamp: z.number().finite(),
};

/**
 * Runtime Zod validator for worker -> server Redis Pub/Sub frames so the API gateway
 * never trusts unvalidated Redis pub/sub payloads or unbounded chunk sizes.
 */
export const WorkerExecutionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('started'),
    ...workerEventBaseShape,
    startedAt: z.string(),
  }),
  z.object({
    type: z.enum(['stdout', 'stderr']),
    ...workerEventBaseShape,
    seq: z.number().int().min(1),
    chunk: z
      .string()
      .refine(
        (value) =>
          getUtf8ByteLength(value) <= EXECUTION_LIMITS.MAX_STREAM_CHUNK_BYTES,
        'Worker stream chunk exceeds maximum byte limit'
      ),
    truncated: z.boolean(),
  }),
  z.object({
    type: z.enum(['completed', 'failed', 'timeout', 'cancelled']),
    ...workerEventBaseShape,
    status: z.enum(['COMPLETED', 'FAILED', 'TIMEOUT', 'CANCELLED']),
    exitCode: z.number().int().nullable(),
    failureKind: ExecutionFailureKindSchema.nullable(),
    errorMessage: z.string().max(1000).nullable(),
    durationMs: z.number().int().min(0).nullable(),
    startedAt: z.string().nullable(),
    endedAt: z.string(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  }),
]);

export const SignedWorkerEventEnvelopeSchema = z.object({
  event: WorkerExecutionEventSchema,
  sig: z.string().regex(/^[a-f0-9]{64}$/i, 'Invalid worker signature'),
});

export const WorkerStdinMessageSchema = z.object({
  data: z
    .string()
    .min(1)
    .refine(
      (value) =>
        getUtf8ByteLength(value) <= EXECUTION_LIMITS.MAX_STDIN_CHUNK_BYTES,
      'Worker stdin chunk exceeds maximum byte limit'
    ),
  sig: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional(),
});

export type CreateExecutionRunInput = z.infer<typeof CreateExecutionRunSchema>;
export type ExecutionStdinInput = z.infer<typeof ExecutionStdinSchema>;
export type ExecutionJoinSocketInput = z.infer<typeof ExecutionJoinSocketSchema>;
export type ExecutionLeaveSocketInput = z.infer<typeof ExecutionLeaveSocketSchema>;
