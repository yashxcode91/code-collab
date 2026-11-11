import type { ApiResponse } from '@codecollab/shared';

interface ValidationDetail {
  field?: string;
  message?: string;
}

/**
 * Structured error thrown by `apiRequest` when the backend returns
 * an `ApiResponse` error envelope (`{ success: false, error: ... }`)
 * or when a network/HTTP failure occurs.
 */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string = 'UNKNOWN_ERROR',
    public readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/**
 * Typed `fetch()` wrapper around our backend `ApiResponse<T>` envelope:
 * - Always attaches `credentials: 'include'` so HttpOnly auth cookies flow automatically.
 * - Unwraps `{ success: true, data }` on success or throws `ApiClientError` with parsed
 *   field-level validation messages on failure.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Always send credentials so the browser includes our HttpOnly JWT cookie
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  // Safely attempt JSON parsing (reverse proxies or 502s can return HTML/empty bodies)
  let body: ApiResponse<T> | null = null;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    // Non-JSON or empty response body
  }

  // Normalize HTTP errors or `{ success: false }` API envelopes into a typed ApiClientError
  if (!res.ok || !body?.success) {
    const errObj = body?.error;
    const code = errObj?.code ?? `HTTP_${res.status}`;
    const message =
      errObj?.message ??
      (res.status >= 500
        ? 'Server error. Please try again in a moment.'
        : `Request failed (${res.status})`);

    const fieldErrors: Record<string, string> = {};

    // 1. Map Zod middleware details: [{ field, message }]
    if (Array.isArray(errObj?.details)) {
      for (const item of errObj.details as ValidationDetail[]) {
        if (item.field && item.message && !fieldErrors[item.field]) {
          fieldErrors[item.field] = item.message;
        }
      }
    }

    // 2. Map domain-level field conflicts onto specific inputs
    if (code === 'EMAIL_EXISTS' && !fieldErrors.email) {
      fieldErrors.email = message;
    } else if (code === 'USERNAME_EXISTS' && !fieldErrors.username) {
      fieldErrors.username = message;
    }

    throw new ApiClientError(message, res.status, code, fieldErrors);
  }

  return body.data as T;
}

