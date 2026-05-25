/**
 * Owner-web HTTP client.
 *
 * Thin fetch wrapper around the BORJIE api-gateway. Resolves the base
 * URL from `NEXT_PUBLIC_API_GATEWAY_URL`; falls back to a localhost
 * default so the dev server runs out of the box. Every request is
 * routed under `/api/v1/owner/*` (or `/api/v1/mining/*`) — the gateway
 * applies tenant scoping from the session cookie.
 *
 * Errors are normalised to `ApiError` with the HTTP status preserved
 * so callers can branch on 401/403/404/5xx without parsing strings.
 */

export const API_BASE =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_API_GATEWAY_URL) ||
  'http://localhost:3000';

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

/**
 * Issue a JSON request against the gateway and parse the response.
 *
 * Throws ApiError for non-2xx. Returns parsed JSON body for 2xx.
 * Callers that want to gracefully degrade to mocks should catch
 * ApiError and check `.status === 0` (network) or branch on status.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (options.signal) init.signal = options.signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'network unreachable';
    throw new ApiError(message, 0);
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
  return (await response.json()) as T;
}

/**
 * Variant that swallows network/5xx errors and returns the provided
 * fallback. Use for screens where the user expects to see something
 * (mocked) even when the gateway is unreachable in dev.
 */
export async function apiRequestOrFallback<T>(
  path: string,
  fallback: T,
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      throw err;
    }
    return fallback;
  }
}
