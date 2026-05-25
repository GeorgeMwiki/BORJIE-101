/**
 * Borjie Console — internal admin API client.
 *
 * Wraps `fetch` against `${NEXT_PUBLIC_API_GATEWAY_URL}/api/v1/internal/*`.
 * Auth: forwards the httpOnly platform-session cookie via
 * `credentials: 'include'`, and the optional bearer token stashed in
 * `sessionStorage.platform_token` (set by the SSO callback for
 * non-cookie callers).
 *
 * Mock fallback: every helper accepts a `fallback` async function that
 * is invoked when the API is unreachable (network error) or returns a
 * 404 / 5xx — this lets every screen demo today against
 * `src/lib/mocks/*.ts` even before the gateway is live.
 */

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

function resolveBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim();
  if (configured) {
    const trimmed = configured.replace(/\/$/, '');
    return `${trimmed}/api/v1/internal`;
  }
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:4000/api/v1/internal';
  }
  return '/api/v1/internal';
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
}

/**
 * Five-second budget on every internal-admin request. The gateway sits
 * behind SSO + IP allow-list inside the data-centre, so anything slower
 * than this is the wrong answer.
 */
const REQUEST_TIMEOUT_MS = 5_000;

async function call<T>({ path, init, fallback }: CallOptions<T>): Promise<ApiResult<T>> {
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
      if (fallback && (res.status === 404 || res.status >= 500)) {
        const data = await fallback();
        return { ok: true, data, source: 'mock' };
      }
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        message: text || `HTTP ${res.status}`,
      };
    }

    const parsed = (await res.json().catch(() => null)) as
      | { readonly data?: T }
      | null;
    const data = (parsed?.data ?? parsed) as T;
    return { ok: true, data, source: 'live' };
  } catch (error) {
    if (fallback) {
      const data = await fallback();
      return { ok: true, data, source: 'mock' };
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
  post<T>(path: string, body: unknown, fallback?: () => Promise<T>): Promise<ApiResult<T>> {
    return call<T>({
      path,
      init: { method: 'POST', body: JSON.stringify(body ?? {}) },
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
