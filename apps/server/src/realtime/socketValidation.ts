import type { z } from 'zod';
import type { RealtimeErrorDetail } from '@codecollab/shared';

export type SocketValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RealtimeErrorDetail };

/**
 * Parses an incoming Socket.IO payload with a shared Zod schema at runtime,
 * converting schema rejections into consistent machine-readable `RealtimeErrorDetail`.
 */
export const parseSocketPayload = <T>(
  schema: z.ZodType<T>,
  payload: unknown
): SocketValidationResult<T> => {
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const firstIssue = parsed.error.issues[0];
  const message = firstIssue?.message ?? 'Invalid real-time payload';
  const isSizeError = /exceed|limit|bytes/i.test(message);

  return {
    ok: false,
    error: {
      code: isSizeError ? 'PAYLOAD_TOO_LARGE' : 'INVALID_PAYLOAD',
      message,
    },
  };
};
