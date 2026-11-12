import { z } from 'zod';
import { SNAPSHOT_LIMITS } from '../types/snapshot';
import { hasDisallowedChatControlChars } from './chat';
import { getUtf8ByteLength } from './execution';

const snapshotTitleField = z
  .string()
  .trim()
  .min(1, 'Snapshot title cannot be empty')
  .max(
    SNAPSHOT_LIMITS.MAX_TITLE_CHARS,
    `Snapshot title cannot exceed ${SNAPSHOT_LIMITS.MAX_TITLE_CHARS} characters`
  )
  .refine((value) => getUtf8ByteLength(value) <= 512, {
    message: 'Snapshot title exceeds 512 UTF-8 byte limit',
  })
  .refine((value) => !hasDisallowedChatControlChars(value), {
    message: 'Snapshot title contains disallowed control characters',
  });

const snapshotDescriptionField = z
  .string()
  .trim()
  .max(
    SNAPSHOT_LIMITS.MAX_DESCRIPTION_CHARS,
    `Description cannot exceed ${SNAPSHOT_LIMITS.MAX_DESCRIPTION_CHARS} characters`
  )
  .refine((value) => getUtf8ByteLength(value) <= 4_096, {
    message: 'Description exceeds 4096 UTF-8 byte limit',
  })
  .refine((value) => !hasDisallowedChatControlChars(value), {
    message: 'Description contains disallowed control characters',
  });

export const CreateSnapshotSchema = z.object({
  title: snapshotTitleField,
  description: snapshotDescriptionField.optional(),
});

export const ListSnapshotsQuerySchema = z.object({
  cursor: z.string().uuid('Invalid snapshot cursor ID').optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SNAPSHOT_LIMITS.MAX_PAGE_SIZE)
    .default(SNAPSHOT_LIMITS.DEFAULT_PAGE_SIZE),
});

export const SnapshotDiffQuerySchema = z.object({
  targetSnapshotId: z.string().uuid('Invalid target snapshot ID').optional(),
});

export const RestoreSnapshotSchema = z.object({
  createSafetySnapshot: z.boolean().default(true),
  safetySnapshotTitle: snapshotTitleField.optional(),
});

export type CreateSnapshotInput = z.infer<typeof CreateSnapshotSchema>;
export type ListSnapshotsQuery = z.infer<typeof ListSnapshotsQuerySchema>;
export type SnapshotDiffQuery = z.infer<typeof SnapshotDiffQuerySchema>;
export type RestoreSnapshotInput = z.infer<typeof RestoreSnapshotSchema>;
