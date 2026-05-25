/**
 * Deep health cascade — GET /api/v1/health/deep.
 *
 * Probes every upstream the gateway depends on in parallel, attaches
 * per-upstream latency, and returns a structured payload.
 *
 * Cached for DEEP_HEALTH_CACHE_MS (default 15_000 ms) to avoid hammering
 * upstreams — consecutive calls within the cache window reuse the last
 * result. The cache is in-memory; each gateway replica maintains its own.
 */

import type { Request, Response } from 'express';

export type ProbeStatus = 'healthy' | 'degraded' | 'unhealthy' | 'skipped';

export interface ProbeResult {
  readonly name: string;
  readonly status: ProbeStatus;
  readonly latencyMs: number;
  readonly error?: string;
  readonly lastChecked: string;
}

export interface DeepHealthPayload {
  readonly overall: ProbeStatus;
  readonly version: string;
  readonly timestamp: string;
  readonly upstreams: Readonly<Record<string, ProbeResult>>;
}

export interface ProbeDefinition {
  readonly name: string;
  readonly run: () => Promise<void>;
  readonly timeoutMs?: number;
  readonly optional?: boolean;
  /** When true, not running the probe (e.g. unset key) marks it `skipped`. */
  readonly skipIf?: () => boolean;
}

export interface DeepHealthOptions {
  readonly version: string;
  readonly cacheMs?: number;
  readonly now?: () => Date;
  readonly probes: readonly ProbeDefinition[];
}

async function runProbe(probe: ProbeDefinition, now: () => Date): Promise<ProbeResult> {
  const startedAt = Date.now();
  const lastChecked = now().toISOString();
  if (probe.skipIf && probe.skipIf()) {
    return { name: probe.name, status: 'skipped', latencyMs: 0, lastChecked };
  }
  const timeoutMs = probe.timeoutMs ?? 2_000;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      probe.run().then(() => { clearTimeout(timer); resolve(); })
                 .catch((err) => { clearTimeout(timer); reject(err); });
    });
    return {
      name: probe.name,
      status: 'healthy',
      latencyMs: Date.now() - startedAt,
      lastChecked,
    };
  } catch (err) {
    return {
      name: probe.name,
      status: probe.optional ? 'degraded' : 'unhealthy',
      latencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      lastChecked,
    };
  }
}

/**
 * Roll up individual probe results into an overall status. `unhealthy` in
 * any non-optional probe → overall `unhealthy`. `degraded` in any probe
 * (including optional-failed) → overall `degraded`. All healthy or skipped
 * → overall `healthy`.
 */
export function computeOverall(
  results: readonly ProbeResult[],
): ProbeStatus {
  if (results.some((r) => r.status === 'unhealthy')) return 'unhealthy';
  if (results.some((r) => r.status === 'degraded')) return 'degraded';
  return 'healthy';
}

export async function runDeepHealth(
  opts: DeepHealthOptions,
): Promise<DeepHealthPayload> {
  const now = opts.now ?? (() => new Date());
  const results = await Promise.all(opts.probes.map((p) => runProbe(p, now)));
  const upstreams: Record<string, ProbeResult> = {};
  for (const r of results) upstreams[r.name] = r;
  return {
    overall: computeOverall(results),
    version: opts.version,
    timestamp: now().toISOString(),
    upstreams,
  };
}

/**
 * Build an Express handler with 15s in-memory cache + admin-role gate.
 *
 * Admin check is delegated to `requireAdmin` so tests can inject a stub.
 * In the gateway we wire in the JWT-based middleware that every /api/v1
 * request already passes through; this route adds a role assertion on top.
 */
export function createDeepHealthHandler(
  opts: DeepHealthOptions & {
    readonly requireAdmin?: (req: Request) => boolean;
  },
): (req: Request, res: Response) => Promise<void> {
  const cacheMs = opts.cacheMs ?? 15_000;
  let cached: { at: number; payload: DeepHealthPayload } | null = null;
  return async (req, res) => {
    if (opts.requireAdmin && !opts.requireAdmin(req)) {
      res.status(403).json({ error: 'admin role required' });
      return;
    }
    const nowMs = Date.now();
    if (cached && nowMs - cached.at < cacheMs) {
      res.setHeader('X-Deep-Health-Cache', 'hit');
      res.status(statusCodeFor(cached.payload.overall)).json(cached.payload);
      return;
    }
    const payload = await runDeepHealth(opts);
    cached = { at: nowMs, payload };
    res.setHeader('X-Deep-Health-Cache', 'miss');
    res.status(statusCodeFor(payload.overall)).json(payload);
  };
}

function statusCodeFor(status: ProbeStatus): number {
  switch (status) {
    case 'healthy': return 200;
    case 'degraded': return 200;
    case 'skipped': return 200;
    case 'unhealthy': return 503;
    default: return 500;
  }
}

// ---------------------------------------------------------------------------
// Built-in probe factories. Call sites mix + match these with their own.
// ---------------------------------------------------------------------------

export function postgresProbe(
  query: () => Promise<unknown>,
  timeoutMs = 1_500,
): ProbeDefinition {
  return {
    name: 'postgres',
    run: async () => { await query(); },
    timeoutMs,
  };
}

export function redisProbe(
  ping: () => Promise<unknown>,
  timeoutMs = 1_000,
): ProbeDefinition {
  return {
    name: 'redis',
    run: async () => { await ping(); },
    timeoutMs,
  };
}

export function anthropicProbe(apiKey: string | undefined): ProbeDefinition {
  return {
    name: 'anthropic',
    skipIf: () => !apiKey,
    optional: true,
    timeoutMs: 3_000,
    run: async () => {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
    },
  };
}

export function openaiProbe(apiKey: string | undefined): ProbeDefinition {
  return {
    name: 'openai',
    skipIf: () => !apiKey,
    optional: true,
    timeoutMs: 3_000,
    run: async () => {
      const res = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
    },
  };
}

export function elevenLabsProbe(apiKey: string | undefined): ProbeDefinition {
  return {
    name: 'elevenlabs',
    skipIf: () => !apiKey,
    optional: true,
    timeoutMs: 3_000,
    run: async () => {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: { 'xi-api-key': apiKey ?? '' },
      });
      if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    },
  };
}

export function gepgProbe(url: string | undefined): ProbeDefinition {
  return {
    name: 'gepg',
    skipIf: () => !url,
    optional: true,
    timeoutMs: 3_000,
    run: async () => {
      const res = await fetch(url ?? '', { method: 'HEAD' });
      if (!res.ok && res.status !== 405) throw new Error(`gepg ${res.status}`);
    },
  };
}
