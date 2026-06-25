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

import { localizeApiError, type CatalogLocale } from '@borjie/error-catalog';

import { createSupabaseBrowserClient } from './supabase/client';
import { requirePublicBaseUrl } from './env-guard';
import { readLocaleFromDocument } from './locale-shared';

// Resolved at module load. In production builds requirePublicBaseUrl
// throws when NEXT_PUBLIC_API_GATEWAY_URL is unset — we want a loud boot
// failure rather than silent localhost fetches in a deployed owner
// cockpit. The dev fallback is unchanged for `next dev`.
export const API_BASE = requirePublicBaseUrl(
  'NEXT_PUBLIC_API_GATEWAY_URL',
  'http://localhost:3001',
);

/**
 * Default hard-abort for normal CRUD reads/writes. Kept tight so a wedged
 * gateway surfaces an error quickly instead of hanging the cockpit.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Long-running timeout for LLM / OCR / report-render paths. The brain turn,
 * executive brief, report-generate, and onboarding-ingest endpoints run
 * 10–60s server-side; the 5s default aborted them every time ("brain turn
 * failed"). Callers on those paths pass `{ timeoutMs: LLM_REQUEST_TIMEOUT_MS }`.
 */
export const LLM_REQUEST_TIMEOUT_MS = 90_000;

/**
 * Resolve the owner's active language as an `Accept-Language` header.
 *
 * LANGUAGE-ENGINEERING CANON (AI-OUTPUT-LOCALE): the gateway — and in
 * particular `POST /brain/turn` — must answer in the owner's CHOSEN locale,
 * not a server default. The browser owns the toggle via the `borjie_locale`
 * cookie; reading it per-request means a mid-session flip is honoured on the
 * very next call (e.g. the AI reply switches to `sw`) with no reload. SSR has
 * no document, so this is a no-op on the server (the gateway resolves the
 * locale from the authenticated session there instead).
 */
function localeHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  return { 'Accept-Language': readLocaleFromDocument() };
}

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

/**
 * Normalized gateway error.
 *
 * LANGUAGE-ENGINEERING CANON: the gateway emits a locale-NEUTRAL envelope
 * `{ success:false, error:{ code, message } }` where `code` is a stable
 * UPPER_SNAKE token and `message` is raw English DEV copy. Rendering that
 * English `message` under an `sw` session is language MIXING — so the
 * user-facing string is NEVER `err.message`; callers localize the stable
 * `code` through `localizeApiError(err, locale)` (@borjie/error-catalog).
 *
 * This class therefore CARRIES the parsed `code` (the thing callers
 * localize) and keeps the raw English body only as `message` (a
 * dev/Sentry field — surfaced to logs, never to the user). When the body
 * is the gateway JSON envelope we parse it; otherwise the raw text is
 * retained verbatim as the dev message with `code` left undefined (the
 * catalog then maps to its generic localized fallback).
 */
export class ApiError extends Error {
  readonly status: number;
  /**
   * The stable, locale-neutral gateway error code (UPPER_SNAKE) when the
   * body was the JSON envelope; `undefined` for a bare-text / network
   * error. THIS is what `localizeApiError` resolves — never `message`.
   */
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Assign only when present so the OPTIONAL `code` stays structurally
    // compatible with the catalog's `ApiErrorLike` under
    // `exactOptionalPropertyTypes` (a required `code: string | undefined`
    // would not be assignable to an optional `code?: string | null`).
    if (code !== undefined) this.code = code;
  }
}

/**
 * Localize an UNKNOWN caught error to user-safe copy in the active locale.
 *
 * The catch-binding in a `try/catch` is typed `unknown`; this narrows it to
 * the shape the shared catalog accepts and delegates to `localizeApiError`,
 * so call sites can write `setError(localizeError(err, locale))` without an
 * `instanceof ApiError` dance at every site. An `ApiError` keeps its stable
 * `code` (→ the localized catalog message); anything else resolves to the
 * generic localized fallback. NEVER returns the raw English `err.message`.
 */
export function localizeError(err: unknown, locale: CatalogLocale): string {
  if (err instanceof ApiError) return localizeApiError(err, locale);
  return localizeApiError(undefined, locale);
}

/**
 * Parse a non-2xx response body into `{ code, devMessage }`.
 *
 * Prefers the gateway JSON envelope `{ error: { code, message } }` so the
 * stable `code` reaches the catalog; falls back to the raw text body (kept
 * only as the dev/Sentry message) when the body is not that envelope.
 */
function parseErrorBody(
  rawBody: string,
  status: number,
): { readonly code: string | undefined; readonly devMessage: string } {
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as {
        error?: { code?: unknown; message?: unknown };
      };
      const errEnvelope = parsed?.error;
      if (errEnvelope && typeof errEnvelope === 'object') {
        const code =
          typeof errEnvelope.code === 'string' ? errEnvelope.code : undefined;
        const devMessage =
          typeof errEnvelope.message === 'string'
            ? errEnvelope.message
            : rawBody;
        return { code, devMessage };
      }
    } catch {
      // Not JSON — fall through to the raw-text branch.
    }
  }
  return {
    code: undefined,
    devMessage: rawBody || `request failed with HTTP ${status}`,
  };
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
  /**
   * Per-call hard-abort override (ms). Defaults to
   * `DEFAULT_REQUEST_TIMEOUT_MS`. LLM/OCR/report paths pass
   * `LLM_REQUEST_TIMEOUT_MS` so a slow generation is not aborted as a
   * false failure.
   */
  readonly timeoutMs?: number;
}

function withTimeout(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  const { signal, cancel } = withTimeout(
    options.signal,
    options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const auth = await authHeaders();
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'include',
    signal,
    headers: {
      Accept: 'application/json',
      // AI-OUTPUT-LOCALE: carry the owner's active language on EVERY gateway
      // call so the brain turn (and any localized gateway copy) answers in
      // the chosen locale. An explicit per-call `options.headers` override
      // still wins (spread last).
      ...localeHeaders(),
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
    // Network-layer failure (DNS / offline / abort). Carry a stable code so
    // the render localizes through the catalog rather than showing the raw
    // English fetch message under `sw`. The raw message stays dev-only.
    const message = err instanceof Error ? err.message : 'network unreachable';
    throw new ApiError(message, 0, 'NETWORK_UNREACHABLE');
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
    // Carry the stable gateway `code` (what callers localize) and keep the
    // raw English body only as the dev/Sentry message — never the rendered
    // string. See ApiError / parseErrorBody above for the canon.
    const { code, devMessage } = parseErrorBody(body, response.status);
    throw new ApiError(devMessage, response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json()) as { success?: boolean; data?: T } | T;
  if (parsed && typeof parsed === 'object' && 'success' in parsed && 'data' in parsed) {
    return parsed.data as T;
  }
  return parsed as T;
}
