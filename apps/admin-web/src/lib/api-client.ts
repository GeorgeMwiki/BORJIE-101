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
import { requirePublicBaseUrl } from './env-guard';

const DEV_FALLBACK_BASE = 'http://localhost:3001';
const MINING_INTERNAL_PATH = '/api/v1/mining/internal';
const REQUEST_TIMEOUT_MS = 5_000;

export interface ApiOk<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ApiErr {
  readonly ok: false;
  readonly status: number;
  /**
   * The gateway's stable, locale-NEUTRAL error CODE (`UPPER_SNAKE`, e.g.
   * `LICENCE_EXPIRED`) when the response carried the canonical envelope
   * `{ success: false, error: { code, message } }`. Render through
   * `localizeApiError(err, locale)` from `@borjie/error-catalog` — NEVER show
   * `message` to the user (a raw English body under `sw` is language mixing).
   * `null` when the response had no parseable code (network / timeout / a bare
   * non-envelope body).
   */
  readonly code: string | null;
  /**
   * The raw, locale-NEUTRAL body/diagnostic from the wire. DEV / log channel
   * ONLY — never a user-facing render. Carried so a developer can inspect the
   * gateway's diagnostic without it ever reaching a localized surface.
   */
  readonly message: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

/**
 * A typed client error that CARRIES the gateway `code` so a render site can
 * localize it via `localizeApiError(err, locale)`. `unwrap` (and the query
 * layer, via `toApiError`) throw this so the thrown value satisfies the
 * catalog's `ApiErrorLike` ({ code, message }) shape — the localized copy is
 * resolved at the render site from `code`, NOT from this raw `message`.
 */
export class ApiClientError extends Error {
  readonly code: string | null;
  readonly status: number;
  constructor(err: Pick<ApiErr, 'code' | 'status' | 'message'>) {
    super(err.message);
    this.name = 'ApiClientError';
    this.code = err.code;
    this.status = err.status;
  }
}

/**
 * Build a code-carrying `ApiClientError` from a failed `ApiResult`. The query
 * layer throws THIS (not `new Error(res.message)`) so the gateway `code`
 * survives into react-query's `error` channel and the render site can localize
 * it. Replaces every `throw new Error(res.message)` in the query bindings.
 */
export function toApiError(err: ApiErr): ApiClientError {
  return new ApiClientError(err);
}

/**
 * Narrow ANY caught value (`unknown` in a `catch`, an `AuthError`, a thrown
 * `ApiClientError`) into the catalog's accepted `{ code, message }` shape. Use
 * at `catch (err)` render sites so `localizeApiError(toCatalogError(err), locale)`
 * type-checks AND stays runtime-safe — the localized copy is resolved from the
 * stable `code`, never this raw `message`. Returns `code: null` (→ the generic
 * localized fallback) when the value carries no string code.
 */
export function toCatalogError(
  err: unknown,
): { readonly code: string | null; readonly message: string } {
  if (err && typeof err === 'object') {
    const rec = err as { code?: unknown; message?: unknown };
    const code = typeof rec.code === 'string' && rec.code.trim() ? rec.code.trim() : null;
    const message = typeof rec.message === 'string' ? rec.message : '';
    return { code, message };
  }
  return { code: null, message: typeof err === 'string' ? err : '' };
}

export function resolveBase(): string {
  // requirePublicBaseUrl throws in production builds when the env var is
  // missing, so we never silently call localhost from a prod browser. The
  // dev fallback (next dev only) is the same as before this refactor.
  const root = requirePublicBaseUrl(
    'NEXT_PUBLIC_API_GATEWAY_URL',
    DEV_FALLBACK_BASE,
  ).replace(/\/$/, '');
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
      // Parse the canonical gateway envelope `{ error: { code, message } }`
      // so the stable, locale-NEUTRAL CODE survives to the render site (the
      // raw body stays dev-only). Falls back to the raw text when the body is
      // not the envelope shape.
      const { code, message } = await parseErrorBody(res);
      return { ok: false, status: res.status, code, message };
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
      code: null,
      message: error instanceof Error ? error.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull `{ code, message }` from a non-ok response body. The gateway emits
 * `c.json({ success: false, error: { code, message } }, status)`; we read the
 * stable `error.code` so render sites can localize. Tolerant of a non-JSON or
 * non-envelope body — falls back to the raw text (or `HTTP <status>`), with a
 * `null` code that drives the catalog's generic localized fallback.
 */
async function parseErrorBody(
  res: Response,
): Promise<{ readonly code: string | null; readonly message: string }> {
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const body = JSON.parse(text) as {
        readonly error?: { readonly code?: unknown; readonly message?: unknown };
        readonly code?: unknown;
        readonly message?: unknown;
      };
      const rawCode = body.error?.code ?? body.code;
      const rawMessage = body.error?.message ?? body.message;
      const code = typeof rawCode === 'string' && rawCode.trim() ? rawCode.trim() : null;
      const message =
        typeof rawMessage === 'string' && rawMessage.trim()
          ? rawMessage.trim()
          : text;
      return { code, message };
    } catch {
      // Non-JSON body — keep the raw text as the dev diagnostic, no code.
    }
  }
  return { code: null, message: text || `HTTP ${res.status}` };
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
 * Throws a code-carrying `ApiClientError` so the render site can localize via
 * `localizeApiError(err, locale)` — never a bare `Error(rawBody)` that would
 * surface an English diagnostic under `sw`.
 */
export function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw toApiError(result);
  }
  return result.data;
}
