/**
 * Typed gateway-fetch substrate (owner-web).
 *
 * THE PROBLEM THIS KILLS
 * Both the server session resolver (`lib/session.ts`) and the client
 * superpower chips (`components/home-chat/SuperpowerChips.tsx`) used to fold
 * EVERY failure class — network-down, HTTP non-2xx, JSON parse-fail — into a
 * single untyped `null`, with no log. A `null` is then indistinguishable from
 * an honestly-empty payload, so a transient gateway blip renders as a
 * fake-empty estate (0 sites) or flips a write to its success affordance.
 * That collapses FAILURE into EMPTINESS and FAILURE into SUCCESS.
 *
 * THE SUBSTRATE
 * One typed result — `FetchResult<T>` — with three distinguishable failure
 * kinds plus the success case. Callers branch on `result.ok` (failure vs
 * data) and, when they care, on `result.kind` (which failure). The
 * `{ success, data }` gateway envelope is unwrapped in exactly one place.
 *
 * ISOMORPHIC + LOG-NEUTRAL
 * This module is server/client safe and imports no logger: the caller passes
 * an optional `log` sink (server session reads stay silent; client chips wire
 * the pino-backed `captureMessage`). The WIRE stays locale-neutral — every
 * `message` here is an internal diagnostic string, NEVER user-facing copy.
 * The RENDER (localised "could not load") lives in the consuming surface.
 */

/** A failure the caller can distinguish from an empty-but-valid payload. */
export type FetchFailureKind =
  /** The request never reached the gateway (DNS, offline, abort, CORS). */
  | 'network'
  /** The gateway answered with a non-2xx status. */
  | 'http'
  /** A 2xx body could not be parsed / unwrapped into the expected shape. */
  | 'parse';

export interface FetchOk<T> {
  readonly ok: true;
  readonly data: T;
}

export interface FetchErr {
  readonly ok: false;
  readonly kind: FetchFailureKind;
  /** HTTP status when known (`http` kind always; otherwise `undefined`). */
  readonly status?: number;
  /** Internal diagnostic only — never rendered to a user. */
  readonly message: string;
}

/**
 * Discriminated result of a gateway call. `ok === true` carries the parsed
 * payload; `ok === false` carries the failure kind so a transient failure is
 * never mistaken for an empty success.
 */
export type FetchResult<T> = FetchOk<T> | FetchErr;

/** Structured-log sink the caller wires (server: silent; client: captureMessage). */
export type FetchLog = (
  message: string,
  detail: { readonly path: string; readonly kind: FetchFailureKind; readonly status?: number },
) => void;

export interface GatewayFetchOptions {
  /** Absolute gateway URL to call (caller resolves base + path). */
  readonly url: string;
  /** Diagnostic path label for logs (relative path, never the full URL). */
  readonly path: string;
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly headers?: Record<string, string>;
  /** Pre-serialised JSON body (caller stringifies). */
  readonly body?: string;
  readonly credentials?: RequestCredentials;
  /** RSC reads pass 'no-store'; mutations leave it undefined. */
  readonly cache?: RequestCache;
  readonly signal?: AbortSignal;
  /** Optional structured-log sink for the FAILURE branches. */
  readonly log?: FetchLog;
}

/**
 * Unwrap the gateway's `{ success, data }` envelope. Returns the inner
 * payload when the envelope is present, otherwise the value verbatim. Pure —
 * shared by every caller so the envelope contract lives in one place.
 */
export function unwrapEnvelope<T>(parsed: unknown): T {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'success' in parsed &&
    'data' in parsed
  ) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

/**
 * Issue a JSON request against the gateway and fold the outcome into a typed
 * `FetchResult<T>`. The three failure classes are kept DISTINCT:
 *   - the `fetch` itself rejecting        → `{ ok:false, kind:'network' }`
 *   - a non-2xx response                   → `{ ok:false, kind:'http', status }`
 *   - a 2xx body that will not JSON-parse  → `{ ok:false, kind:'parse', status }`
 * Every failure is reported once through the optional `log` sink. Never
 * throws; never returns a bare `null`.
 */
export async function gatewayFetch<T>(
  options: GatewayFetchOptions,
): Promise<FetchResult<T>> {
  const { url, path, log } = options;

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers: { Accept: 'application/json', ...(options.headers ?? {}) },
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.credentials ? { credentials: options.credentials } : {}),
    ...(options.cache ? { cache: options.cache } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'network unreachable';
    log?.(`gateway-fetch network failure: ${message}`, { path, kind: 'network' });
    return { ok: false, kind: 'network', message };
  }

  if (!res.ok) {
    const message = `gateway responded HTTP ${res.status}`;
    log?.(message, { path, kind: 'http', status: res.status });
    return { ok: false, kind: 'http', status: res.status, message };
  }

  if (res.status === 204) {
    return { ok: true, data: undefined as T };
  }

  try {
    const parsed = (await res.json()) as unknown;
    return { ok: true, data: unwrapEnvelope<T>(parsed) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'response body was not valid JSON';
    log?.(`gateway-fetch parse failure: ${message}`, {
      path,
      kind: 'parse',
      status: res.status,
    });
    return { ok: false, kind: 'parse', status: res.status, message };
  }
}
