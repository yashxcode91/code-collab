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
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

// In-flight refresh promise singleton to prevent duplicate concurrent refresh calls
let activeRefreshPromise: Promise<boolean> | null = null;

/**
 * Resolves the backend API base origin:
 * - Empty string in local dev / Docker compose (same origin via reverse proxy)
 * - `https://<host>` when VITE_API_URL is injected at build time (e.g. Render)
 */
export function getApiBaseUrl(): string {
  const envUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL;
  if (!envUrl) return '';
  const trimmed = envUrl.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/$/, '');
  }
  return `https://${trimmed}`.replace(/\/$/, '');
}

async function requestTokenRefresh(): Promise<boolean> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Typed `fetch()` wrapper around our backend `ApiResponse<T>` envelope:
 * - Always attaches `credentials: 'include'` so HttpOnly auth cookies flow automatically.
 * - Unwraps `{ success: true, data }` on success or throws `ApiClientError` with parsed
 *   field-level validation messages on failure.
 * - Automatically performs silent token refresh & request retry on 401s so sessions never drop mid-work.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  const fullUrl =
    path.startsWith('http://') || path.startsWith('https://')
      ? path
      : `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;

  // Always send credentials so the browser includes our HttpOnly JWT cookies
  const res = await fetch(fullUrl, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // If 401 Unauthorized occurs on a non-auth endpoint, attempt a silent token refresh & retry once
  if (
    res.status === 401 &&
    !isRetry &&
    !path.startsWith('/api/auth/login') &&
    !path.startsWith('/api/auth/register') &&
    !path.startsWith('/api/auth/refresh') &&
    !path.startsWith('/api/auth/logout')
  ) {
    const refreshed = await requestTokenRefresh();
    if (refreshed) {
      return apiRequest<T>(path, options, true);
    }
  }

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

    throw new ApiClientError(
      message,
      res.status,
      code,
      fieldErrors,
      errObj?.details,
    );
  }

  return body.data as T;
}
