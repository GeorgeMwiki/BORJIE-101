/**
 * Refutation client — TS adapter for the Python DoWhy sidecar.
 *
 * The sidecar contract is fixed in `sidecar/python-sidecar-spec.md`.
 * The Python implementation lives at `services/scientific-discovery-sidecar/`.
 * This file only knows how to speak HTTP to it; it does not parse
 * statistical results.
 *
 * Configuration:
 *   - `DISCOVERY_SIDECAR_URL` env var, default `http://localhost:8000`.
 *   - Override via `createRefutationClient({ baseUrl })`.
 *
 * Failure modes:
 *   - Network error → throws `SidecarUnavailableError`.
 *   - Non-2xx     → throws `SidecarHttpError` with status + body.
 *   - Schema fail → throws `SidecarSchemaError`.
 */

import { z } from 'zod';
import type {
  RefutationScores,
  SidecarRefuteRequest,
  SidecarRefuteResponse,
} from '../types.js';

export class SidecarUnavailableError extends Error {
  // `cause` is in the Error prototype in modern Node TS lib — mark `override`.
  override readonly cause: unknown;
  constructor(cause: unknown) {
    super('Scientific-discovery sidecar unavailable');
    this.name = 'SidecarUnavailableError';
    this.cause = cause;
  }
}

export class SidecarHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Sidecar HTTP ${status}: ${body.slice(0, 200)}`);
    this.name = 'SidecarHttpError';
  }
}

export class SidecarSchemaError extends Error {
  constructor(public readonly issue: string) {
    super(`Sidecar schema validation failed: ${issue}`);
    this.name = 'SidecarSchemaError';
  }
}

const ENV_VAR = 'DISCOVERY_SIDECAR_URL';
const DEFAULT_BASE_URL = 'http://localhost:8000';

/**
 * Resolve the sidecar base URL, refusing to fall back to localhost
 * when NODE_ENV === 'production'. Exported so the PCMCIplus client
 * (and any future causal-fusion clients) share one policy.
 */
export function resolveSidecarBaseUrl(explicit: string | undefined): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const fromEnv = process.env[ENV_VAR];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `scientific-discovery: ${ENV_VAR} must be set in production ` +
        '(no silent "http://localhost:8000" default).',
    );
  }
  return DEFAULT_BASE_URL;
}

export interface RefutationClientOptions {
  readonly baseUrl?: string;
  /** Fetch impl override (test injection). */
  readonly fetchImpl?: typeof fetch;
  /** Default 10s. */
  readonly timeoutMs?: number;
  /**
   * SEC-1 — shared-secret bearer token. When set, sent as
   * `Authorization: Bearer <token>` on every sidecar call. The gateway /
   * worker sources it from KMS via ESO; it is never hardcoded.
   */
  readonly authToken?: string;
}

/**
 * Build the request headers for a sidecar call, attaching the bearer
 * token when one is configured. Exported so the PCMCIplus client (and
 * any future causal-fusion clients) share one header policy.
 */
export function buildSidecarHeaders(authToken: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authToken && authToken.length > 0) {
    headers['authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

const RefutationScoresWire = z.object({
  placebo: z.number().min(0).max(1),
  bootstrap: z.number().min(0).max(1),
  unobservedConfounder: z.number().min(0).max(1),
  conditionalIndependence: z.number().min(0).max(1).optional(),
});

const RefuteResponseWire = z.object({
  scores: RefutationScoresWire,
  diagnostics: z.string(),
});

export interface RefutationClient {
  refute(req: SidecarRefuteRequest): Promise<SidecarRefuteResponse>;
}

export function createRefutationClient(opts: RefutationClientOptions = {}): RefutationClient {
  const baseUrl = resolveSidecarBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const headers = buildSidecarHeaders(opts.authToken);

  return {
    async refute(req) {
      const url = `${baseUrl.replace(/\/$/, '')}/dowhy/refute`;
      const res = await fetchWithTimeout(fetchImpl, url, req, timeoutMs, headers);
      const raw: unknown = await res.json().catch(() => ({}));
      const parsed = RefuteResponseWire.safeParse(raw);
      if (!parsed.success) {
        throw new SidecarSchemaError(parsed.error.message);
      }
      const scores: RefutationScores = parsed.data.scores;
      return { scores, diagnostics: parsed.data.diagnostics };
    },
  };
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new SidecarHttpError(res.status, text);
    }
    return res;
  } catch (err) {
    if (err instanceof SidecarHttpError) throw err;
    throw new SidecarUnavailableError(err);
  } finally {
    clearTimeout(timer);
  }
}
