/**
 * Concrete SidecarClient — the single object the worker hands to
 * `runDiscovery`.
 *
 * Composes the two transport clients (`createRefutationClient` +
 * `createPcmciClient`) and adds the `health()` method the
 * orchestrator's `SidecarClient` port requires (`GET {baseUrl}/health`).
 *
 * SEC-1: the shared-secret bearer token is threaded through to BOTH
 * sub-clients here, so every `/dowhy/*` and `/tigramite/*` call carries
 * the `Authorization` header. `/health` is intentionally NOT
 * authenticated — it mirrors the sidecar's open probe routes.
 *
 * Degrade-graceful: `resolveSidecarBaseUrl` throws in production when no
 * URL is configured, so a misconfigured prod deploy fails loudly at
 * construction. In dev it falls back to localhost. Network failures
 * surface as `SidecarUnavailableError` — the consumer (proactive-triggers
 * worker) catches it and SKIPS the tick rather than crashing.
 */

import { z } from 'zod';
import type { SidecarClient } from '../types.js';
import {
  createRefutationClient,
  buildSidecarHeaders,
  resolveSidecarBaseUrl,
  SidecarHttpError,
  SidecarSchemaError,
  SidecarUnavailableError,
} from '../causal-fusion/refutation-client.js';
import { createPcmciClient } from '../causal-fusion/pcmciplus-client.js';

export interface SidecarClientOptions {
  /** Explicit base URL; falls back to `DISCOVERY_SIDECAR_URL` env. */
  readonly baseUrl?: string;
  /** SEC-1 — shared-secret bearer token for the inference routes. */
  readonly authToken?: string;
  /** Fetch impl override (test injection). */
  readonly fetchImpl?: typeof fetch;
  /** Per-call timeout for refute (default 10s). */
  readonly refuteTimeoutMs?: number;
  /** Per-call timeout for pcmciplus (default 30s). */
  readonly pcmciTimeoutMs?: number;
  /** Health-check timeout (default 5s). */
  readonly healthTimeoutMs?: number;
}

/**
 * Wire schema for `GET /health`. The sidecar returns a richer body
 * (service, checks) but the port only needs `{ ok, version }`.
 */
const HealthWire = z.object({
  ok: z.boolean(),
  version: z.string(),
});

const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;

/**
 * Build the concrete sidecar client. Throws in production when no URL is
 * resolvable (no silent localhost). The returned object is frozen so the
 * worker can treat it as an immutable port.
 */
export function createSidecarClient(opts: SidecarClientOptions = {}): SidecarClient {
  const baseUrl = resolveSidecarBaseUrl(opts.baseUrl);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const healthTimeoutMs = opts.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
  const headers = buildSidecarHeaders(opts.authToken);

  const refutation = createRefutationClient({
    baseUrl,
    fetchImpl,
    ...(opts.authToken !== undefined ? { authToken: opts.authToken } : {}),
    ...(opts.refuteTimeoutMs !== undefined ? { timeoutMs: opts.refuteTimeoutMs } : {}),
  });

  const pcmci = createPcmciClient({
    baseUrl,
    fetchImpl,
    ...(opts.authToken !== undefined ? { authToken: opts.authToken } : {}),
    ...(opts.pcmciTimeoutMs !== undefined ? { timeoutMs: opts.pcmciTimeoutMs } : {}),
  });

  const client: SidecarClient = {
    refute: (req) => refutation.refute(req),
    pcmciplus: (req) => pcmci.pcmciplus(req),
    async health() {
      const url = `${baseUrl.replace(/\/$/, '')}/health`;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), healthTimeoutMs);
      try {
        const res = await fetchImpl(url, {
          method: 'GET',
          headers,
          signal: ctl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new SidecarHttpError(res.status, text);
        }
        const raw: unknown = await res.json().catch(() => ({}));
        const parsed = HealthWire.safeParse(raw);
        if (!parsed.success) {
          throw new SidecarSchemaError(parsed.error.message);
        }
        return { ok: parsed.data.ok, version: parsed.data.version };
      } catch (err) {
        if (err instanceof SidecarHttpError || err instanceof SidecarSchemaError) throw err;
        throw new SidecarUnavailableError(err);
      } finally {
        clearTimeout(timer);
      }
    },
  };

  return Object.freeze(client);
}
