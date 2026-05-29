/**
 * Owner-web HTTP client.
 *
 * Thin fetch wrapper around the BORJIE api-gateway. Resolves the base
 * URL from `NEXT_PUBLIC_API_GATEWAY_URL`; falls back to a localhost
 * default so the dev server runs out of the box.
 *
 * Auth: forwards the Supabase Auth access token as `Authorization:
 * Bearer ...`. The browser client owns the session via @supabase/ssr
 * cookies; the access token is read per-request so refreshed tokens
 * are picked up without a page reload.
 *
 * Errors are normalised to `ApiError` with the HTTP status preserved
 * so callers can branch on 401/403/404/5xx without parsing strings.
 *
 * LIVE-ONLY: there is no mock fallback. Failures propagate to the
 * react-query `error` channel; consumers are expected to render an
 * empty-state when the data is unavailable.
 */

import { createSupabaseBrowserClient } from './supabase/client';
import { requirePublicBaseUrl } from './env-guard';

// Resolved at module load. In production builds requirePublicBaseUrl
// throws when NEXT_PUBLIC_API_GATEWAY_URL is unset — we want a loud boot
// failure rather than silent localhost fetches in a deployed owner
// cockpit. The dev fallback is unchanged for `next dev`.
export const API_BASE = requirePublicBaseUrl(
  'NEXT_PUBLIC_API_GATEWAY_URL',
  'http://localhost:3001',
);

const REQUEST_TIMEOUT_MS = 5_000;

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Misconfigured env or auth client error — fail open and let the
    // gateway respond 401 so middleware redirects to /sign-in.
    return {};
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
}

function withTimeout(externalSignal: AbortSignal | undefined): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/**
 * Issue a JSON request against the gateway and parse the response.
 *
 * Throws ApiError for non-2xx. Returns parsed JSON body for 2xx.
 * Unwraps the gateway's `{success, data}` envelope when present so
 * callers see the inner payload directly.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const { signal, cancel } = withTimeout(options.signal);
  const auth = await authHeaders();
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...auth,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network unreachable';
    throw new ApiError(message, 0);
  } finally {
    cancel();
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = response.statusText;
    }
    throw new ApiError(
      body || `request failed with HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json()) as { success?: boolean; data?: T } | T;
  if (parsed && typeof parsed === 'object' && 'success' in parsed && 'data' in parsed) {
    return parsed.data as T;
  }
  return parsed as T;
}
