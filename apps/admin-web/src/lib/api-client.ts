/**
 * Borjie Console — internal admin API client.
 *
 * Wraps `fetch` against `${NEXT_PUBLIC_API_GATEWAY_URL}/api/v1/mining/internal/*`.
 *
 * Base URL resolved from `NEXT_PUBLIC_API_GATEWAY_URL` (defaults to
 * `http://localhost:3001` for the dev server).
 *
 * Auth: forwards the Supabase Auth access token as `Authorization:
 * Bearer ...`. The browser client owns the session via @supabase/ssr
 * cookies; we pull the current access token on each request so a
 * refreshed token is picked up without a page reload.
 *
 * LIVE-ONLY: there is no mock fallback. Failures propagate to the
 * react-query `error` channel; consumers render an empty state when
 * the gateway is unreachable.
 */

import { createSupabaseBrowserClient } from './supabase/client';

const DEFAULT_BASE = 'http://localhost:3001';
const MINING_INTERNAL_PATH = '/api/v1/mining/internal';
const REQUEST_TIMEOUT_MS = 5_000;

export interface ApiOk<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ApiErr {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

export function resolveBase(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()
      : undefined;
  const root = configured && configured.length > 0 ? configured.replace(/\/$/, '') : DEFAULT_BASE;
  return `${root}${MINING_INTERNAL_PATH}`;
}

async function authHeaders(): Promise<HeadersInit> {
  if (typeof window === 'undefined') return {};
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // Misconfigured env or auth client error — fail open and let the
    // gateway return 401 so the user is redirected to /sign-in.
    return {};
  }
}

interface CallOptions {
  readonly path: string;
  readonly init?: RequestInit;
  readonly attempt?: number;
}

async function call<T>({ path, init, attempt = 0 }: CallOptions): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const auth = await authHeaders();
    const res = await fetch(`${resolveBase()}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      // Server-side failure — retry once before bailing.
      if (res.status >= 500 && attempt < 1) {
        clearTimeout(timer);
        return call<T>({ path, ...(init !== undefined ? { init } : {}), attempt: attempt + 1 });
      }
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: text || `HTTP ${res.status}` };
    }

    const parsed = (await res.json().catch(() => null)) as
      | { readonly success?: boolean; readonly data?: T }
      | null;
    const data = (parsed?.data ?? parsed) as T;
    return { ok: true, data };
  } catch (error) {
    // Network / abort / timeout. Retry once before bailing.
    if (attempt < 1) {
      clearTimeout(timer);
      return call<T>({ path, ...(init !== undefined ? { init } : {}), attempt: attempt + 1 });
    }
    return {
      ok: false,
      status: 0,
      message: error instanceof Error ? error.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const apiClient = {
  get<T>(path: string): Promise<ApiResult<T>> {
    return call<T>({ path });
  },
  post<T>(
    path: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<ApiResult<T>> {
    return call<T>({
      path,
      init: {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
        ...(headers !== undefined ? { headers } : {}),
      },
    });
  },
  patch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return call<T>({
      path,
      init: { method: 'PATCH', body: JSON.stringify(body ?? {}) },
    });
  },
  delete<T>(path: string): Promise<ApiResult<T>> {
    return call<T>({ path, init: { method: 'DELETE' } });
  },
};

/**
 * Unwrap an ApiResult, throwing on failure. Used inside react-query
 * `queryFn`s where the hook's `error` state is the channel for failure.
 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data;
}
