/**
 * Thin, hand-written client wrapper on top of the auto-generated types.
 *
 * Design goals:
 *   - Zero runtime deps beyond global fetch (Node 20+ / modern browsers).
 *   - Errors are structured (see `ApiSdkError`) — never raw Response objects.
 *   - Query params are serialised deterministically so tests can assert URLs.
 *   - Bearer token can be static or a lazy getter so SDK consumers can
 *     refresh JWTs without re-creating the client.
 */

import type { paths } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BossnyumbaClientConfig {
  /** Base URL of the gateway, e.g. `http://localhost:4001`. Trailing slash optional. */
  baseUrl: string;
  /** Bearer token (JWT) or a function returning one. */
  bearerToken?: string | (() => string | Promise<string>);
  /** Optional API key for the `X-API-Key` alt auth scheme. */
  apiKey?: string;
  /** Swap in a custom fetch (e.g. for retries, mocking). Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Default request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Extra headers merged into every request (after the SDK's auth/content-type). */
  defaultHeaders?: Record<string, string>;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiSdkErrorPayload {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export class ApiSdkError extends Error {
  public readonly status: number;
  public readonly code: string;
  // These two are genuinely optional — keep them as `T | undefined` (not
  // `?:`) so exactOptionalPropertyTypes doesn't reject a constructor arg
  // that explicitly sets the field to `undefined`.
  public readonly requestId: string | undefined;
  public readonly details: unknown;
  public readonly url: string;

  constructor(args: {
    status: number;
    url: string;
    message: string;
    code: string;
    requestId?: string | undefined;
    details?: unknown;
  }) {
    super(args.message);
    this.name = 'ApiSdkError';
    this.status = args.status;
    this.code = args.code;
    this.requestId = args.requestId;
    this.details = args.details;
    this.url = args.url;
  }
}

// ---------------------------------------------------------------------------
// URL + query-string helpers
// ---------------------------------------------------------------------------

/**
 * Build a URL from `baseUrl + path`, substituting any `{id}`-style path
 * params and appending deterministically-sorted query parameters.
 */
export function buildUrl(
  baseUrl: string,
  path: string,
  pathParams?: Record<string, string | number>,
  query?: Record<string, unknown>
): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const withPath = pathParams
    ? path.replace(/\{(\w+)\}/g, (_m, key) => {
        const v = pathParams[key];
        if (v === undefined || v === null) {
          throw new Error(`Missing path parameter "${key}" for ${path}`);
        }
        return encodeURIComponent(String(v));
      })
    : path;

  const qs = query ? encodeQuery(query) : '';
  const sep = qs ? (withPath.includes('?') ? '&' : '?') : '';
  return `${trimmedBase}${withPath}${sep}${qs}`;
}

function encodeQuery(query: Record<string, unknown>): string {
  const parts: string[] = [];
  // Sort keys so the generated URL is stable (tests + HTTP cache keys).
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

async function resolveBearer(
  t: BossnyumbaClientConfig['bearerToken']
): Promise<string | undefined> {
  if (!t) return undefined;
  if (typeof t === 'function') return await t();
  return t;
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

/**
 * Parse a failed Response into an `ApiSdkError`. Tolerant of empty bodies,
 * non-JSON bodies, and the gateway's `{ error: { code, message } }` envelope.
 */
export async function parseErrorResponse(response: Response, url: string): Promise<ApiSdkError> {
  const status = response.status;
  let payload: unknown = undefined;
  const contentType = response.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      payload = await response.json();
    } else {
      const text = await response.text();
      payload = text ? { message: text } : undefined;
    }
  } catch {
    payload = undefined;
  }

  const errEnvelope =
    payload && typeof payload === 'object' && 'error' in (payload as Record<string, unknown>)
      ? ((payload as { error: unknown }).error as Partial<ApiSdkErrorPayload>)
      : (payload as Partial<ApiSdkErrorPayload> | undefined);

  return new ApiSdkError({
    status,
    url,
    code: errEnvelope?.code ?? `HTTP_${status}`,
    message:
      errEnvelope?.message ??
      (typeof payload === 'string' ? payload : `Request failed with status ${status}`),
    requestId: errEnvelope?.requestId,
    details: errEnvelope?.details,
  });
}

// ---------------------------------------------------------------------------
// Core request function
// ---------------------------------------------------------------------------

export interface RequestArgs {
  method: HttpMethod;
  path: string;
  // These are genuinely optional; declaring `| undefined` lets callers pass
  // them through from their own (possibly undefined) locals without needing
  // a conditional spread (exactOptionalPropertyTypes compatibility).
  pathParams?: Record<string, string | number> | undefined;
  query?: Record<string, unknown> | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
}

export interface BossnyumbaClient {
  readonly baseUrl: string;
  readonly config: BossnyumbaClientConfig;
  request<T = unknown>(args: RequestArgs): Promise<T>;
  /** Typed helpers — one namespace per top-level OpenAPI tag we expose. */
  readonly marketplace: {
    listings: {
      list(query?: Record<string, unknown>): Promise<unknown>;
      get(id: string): Promise<unknown>;
    };
  };
  readonly health: {
    check(): Promise<unknown>;
  };
}

export function createBossnyumbaClient(config: BossnyumbaClientConfig): BossnyumbaClient {
  if (!config.baseUrl) {
    throw new Error('createBossnyumbaClient: baseUrl is required');
  }
  const fetchFn = config.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error(
      'createBossnyumbaClient: global fetch is not available. Provide config.fetchFn.'
    );
  }
  const timeoutMs = config.timeoutMs ?? 30_000;
  const defaultHeaders = config.defaultHeaders ?? {};

  async function request<T = unknown>(args: RequestArgs): Promise<T> {
    const url = buildUrl(config.baseUrl, args.path, args.pathParams, args.query);

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...defaultHeaders,
      ...(args.headers ?? {}),
    };

    if (args.body !== undefined && !('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/json';
    }

    const bearer = await resolveBearer(config.bearerToken);
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    if (config.apiKey) headers['X-API-Key'] = config.apiKey;

    // Wire a timeout via AbortController, folding in any caller-supplied signal.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const combinedSignal = args.signal
      ? mergeSignals(args.signal, ac.signal)
      : ac.signal;

    // Build the RequestInit conditionally so we never assign `undefined`
    // to a field typed as e.g. `BodyInit | null` (exactOptionalPropertyTypes).
    const init: RequestInit = {
      method: args.method,
      headers,
      signal: combinedSignal,
    };
    if (args.body !== undefined) {
      init.body = JSON.stringify(args.body);
    }

    let response: Response;
    try {
      response = await fetchFn(url, init);
    } catch (err) {
      clearTimeout(timer);
      throw new ApiSdkError({
        status: 0,
        url,
        code: 'NETWORK_ERROR',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw await parseErrorResponse(response, url);
    }

    // 204 / empty body
    if (response.status === 204) return undefined as unknown as T;
    const ct = response.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  // Namespaced helpers. We intentionally keep this small and add per-feature
  // namespaces as the spec grows. Every namespace uses `request` so auth /
  // timeouts / error parsing are all shared.
  const marketplace = {
    listings: {
      list: (query?: Record<string, unknown>) =>
        request<unknown>({ method: 'GET', path: '/api/v1/marketplace/listings', query }),
      get: (id: string) =>
        request<unknown>({
          method: 'GET',
          path: '/api/v1/marketplace/listings/{id}',
          pathParams: { id },
        }),
    },
  };

  const health = {
    check: () => request<unknown>({ method: 'GET', path: '/health' }),
  };

  return {
    baseUrl: config.baseUrl,
    config,
    request,
    marketplace,
    health,
  };
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const ac = new AbortController();
  const onAbortA = () => ac.abort((a as AbortSignal & { reason?: unknown }).reason);
  const onAbortB = () => ac.abort((b as AbortSignal & { reason?: unknown }).reason);
  a.addEventListener('abort', onAbortA, { once: true });
  b.addEventListener('abort', onAbortB, { once: true });
  return ac.signal;
}

// Re-export the generated namespace so SDK users can pull operation types
// directly, e.g. `import type { paths } from '@borjie/api-sdk'`.
export type { paths } from './types.js';

// Helper type aliases that consumers frequently want.
export type PathKeys = keyof paths;
