/**
 * Borjie Console — internal admin API client.
 *
 * Wraps `fetch` against `${NEXT_PUBLIC_API_GATEWAY_URL}/api/v1/mining/internal/*`.
 *
 * Behaviour controlled by two NEXT_PUBLIC env vars:
 *   NEXT_PUBLIC_API_GATEWAY_URL  base URL (default http://localhost:3001)
 *   NEXT_PUBLIC_USE_LIVE_API     'false' to force-mock; anything else (or unset)
 *                                attempts the live gateway and falls back to
 *                                the supplied mock on network/5xx errors.
 *
 * Auth: forwards the httpOnly platform-session cookie via
 * `credentials: 'include'`, plus the bearer token stashed in
 * `sessionStorage.platform_token` (set by the SSO callback for
 * non-cookie callers).
 *
 * Every helper accepts a `fallback` async function that returns a mock.
 * On `useLiveApi() === false` OR on a network / 5xx failure, the call
 * resolves to the mock with `source === 'mock'` and `__mockSource: true`.
 * That marker lets components flag the data-source badge without
 * re-checking env vars on every render.
 */

const DEFAULT_BASE = 'http://localhost:3001';
const MINING_INTERNAL_PATH = '/api/v1/mining/internal';
const REQUEST_TIMEOUT_MS = 5_000;

export interface ApiOk<T> {
  readonly ok: true;
  readonly data: T;
  readonly source: 'live' | 'mock';
}

export interface ApiErr {
  readonly ok: false;
  readonly status: number;
  readonly message: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

/**
 * Tag a mock payload so downstream consumers can distinguish without
 * passing source flags through every prop. Non-enumerable so the marker
 * does not leak into JSON serialisation.
 */
function tagMock<T>(value: T): T {
  if (value && typeof value === 'object') {
    try {
      Object.defineProperty(value, '__mockSource', {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      /* frozen mocks — caller already tagged or doesn't care. */
    }
  }
  return value;
}

export function resolveBase(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()
      : undefined;
  const root = configured && configured.length > 0 ? configured.replace(/\/$/, '') : DEFAULT_BASE;
  return `${root}${MINING_INTERNAL_PATH}`;
}

export function useLiveApi(): boolean {
  const flag =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_USE_LIVE_API?.trim().toLowerCase()
      : undefined;
  // Default is ON: the only way to force-mock is `NEXT_PUBLIC_USE_LIVE_API=false`.
  return flag !== 'false' && flag !== '0' && flag !== 'off';
}

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = window.sessionStorage.getItem('platform_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface CallOptions<T> {
  readonly path: string;
  readonly init?: RequestInit;
  readonly fallback?: () => Promise<T>;
  readonly attempt?: number;
}

async function call<T>({ path, init, fallback, attempt = 0 }: CallOptions<T>): Promise<ApiResult<T>> {
  // Hard short-circuit when the flag forces mock.
  if (!useLiveApi() && fallback) {
    return { ok: true, data: tagMock(await fallback()), source: 'mock' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${resolveBase()}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...init?.headers,
      },
    });

    if (!res.ok) {
      // Server-side failure — try one more time before falling back.
      if (res.status >= 500 && attempt < 1) {
        clearTimeout(timer);
        return call<T>({ path, init, fallback, attempt: attempt + 1 });
      }
      if (fallback && (res.status === 404 || res.status >= 500)) {
        return { ok: true, data: tagMock(await fallback()), source: 'mock' };
      }
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: text || `HTTP ${res.status}` };
    }

    const parsed = (await res.json().catch(() => null)) as
      | { readonly success?: boolean; readonly data?: T }
      | null;
    const data = (parsed?.data ?? parsed) as T;
    return { ok: true, data, source: 'live' };
  } catch (error) {
    // Network / abort / timeout. Retry once before bailing to mock.
    if (attempt < 1) {
      clearTimeout(timer);
      return call<T>({ path, init, fallback, attempt: attempt + 1 });
    }
    if (fallback) {
      return { ok: true, data: tagMock(await fallback()), source: 'mock' };
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
  get<T>(path: string, fallback?: () => Promise<T>): Promise<ApiResult<T>> {
    return call<T>({ path, fallback });
  },
  post<T>(
    path: string,
    body: unknown,
    fallback?: () => Promise<T>,
    headers?: Record<string, string>,
  ): Promise<ApiResult<T>> {
    return call<T>({
      path,
      init: { method: 'POST', body: JSON.stringify(body ?? {}), headers },
      fallback,
    });
  },
  patch<T>(path: string, body: unknown, fallback?: () => Promise<T>): Promise<ApiResult<T>> {
    return call<T>({
      path,
      init: { method: 'PATCH', body: JSON.stringify(body ?? {}) },
      fallback,
    });
  },
  delete<T>(path: string, fallback?: () => Promise<T>): Promise<ApiResult<T>> {
    return call<T>({ path, init: { method: 'DELETE' }, fallback });
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
