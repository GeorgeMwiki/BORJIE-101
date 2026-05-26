/**
 * Owner-web HTTP client.
 *
 * Thin fetch wrapper around the BORJIE api-gateway. Resolves the base
 * URL from `NEXT_PUBLIC_API_GATEWAY_URL`; falls back to a localhost
 * default so the dev server runs out of the box. Live-vs-mock is
 * controlled by `NEXT_PUBLIC_USE_LIVE_API` (defaults to ON).
 *
 * Auth: forwards the session cookie via `credentials: 'include'`, plus
 * the bearer stashed in `sessionStorage.platform_token` when present
 * (set by the SSO callback for non-cookie callers).
 *
 * Errors are normalised to `ApiError` with the HTTP status preserved
 * so callers can branch on 401/403/404/5xx without parsing strings.
 * `apiRequestOrFallback` retries once on network / 5xx failure and
 * swallows the error into the supplied mock — tagged with the
 * non-enumerable `__mockSource` marker.
 */

export const API_BASE =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()) ||
  'http://localhost:3001';

const REQUEST_TIMEOUT_MS = 5_000;

export function useLiveApi(): boolean {
  const flag =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_USE_LIVE_API?.trim().toLowerCase()
      : undefined;
  return flag !== 'false' && flag !== '0' && flag !== 'off';
}

function tagMock<T>(value: T): T {
  if (value && typeof value === 'object') {
    try {
      Object.defineProperty(value, '__mockSource', {
        value: true,
        enumerable: false,
        configurable: true,
      });
    } catch {
      /* frozen — caller's mock has already been tagged or is immutable. */
    }
  }
  return value;
}

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.sessionStorage.getItem('platform_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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
 * callers see the same shape as the legacy mocks.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const { signal, cancel } = withTimeout(options.signal);
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      ...authHeaders(),
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

/**
 * Variant that swallows network/5xx errors and returns the provided
 * fallback. Retries once on transport failure before bailing. Use for
 * screens where the user expects to see something (mocked) even when
 * the gateway is unreachable in dev.
 */
export async function apiRequestOrFallback<T>(
  path: string,
  fallback: T,
  options: RequestOptions = {},
): Promise<T> {
  if (!useLiveApi()) return tagMock(fallback);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await apiRequest<T>(path, options);
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        throw err;
      }
      // 0 (network) or 5xx — retry once, then fall back.
      if (attempt === 1) return tagMock(fallback);
    }
  }
  return tagMock(fallback);
}
