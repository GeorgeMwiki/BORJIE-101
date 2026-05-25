/**
 * Shared health-check primitives
 *
 * Every service exposes a consistent `/healthz` payload so the
 * api-gateway, scheduler and ECS healthchecks can rely on the same
 * shape:
 *
 * ```json
 * {
 *   "status": "ok" | "degraded" | "fail",
 *   "version": "abc123",
 *   "service": "notifications",
 *   "timestamp": "2026-04-18T09:12:03.000Z",
 *   "upstreams": {
 *     "postgres": { "status": "ok", "latencyMs": 4 },
 *     "redis":    { "status": "ok", "latencyMs": 1 }
 *   }
 * }
 * ```
 *
 * Consumers wire in a tiny handler map — one per upstream they care
 * about — and this module runs them in parallel with a per-probe
 * timeout. No framework dependency: returns a plain object so Hono,
 * Express, or a raw `http.Server` can all serialize it.
 */

export type UpstreamStatus = 'ok' | 'degraded' | 'fail';

export interface UpstreamResult {
  readonly status: UpstreamStatus;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface HealthPayload {
  readonly status: UpstreamStatus;
  readonly version: string;
  readonly service: string;
  readonly timestamp: string;
  readonly upstreams: Readonly<Record<string, UpstreamResult>>;
}

export interface UpstreamProbe {
  /** Probe name used as the key in the response `upstreams` map. */
  readonly name: string;
  /** Probe handler — rejecting or throwing marks the probe as `fail`. */
  readonly probe: () => Promise<void>;
  /** Per-probe timeout in ms. Defaults to 2 000. */
  readonly timeoutMs?: number;
  /**
   * If true, probe failure only degrades the overall status (not fail).
   * Use for optional upstreams (e.g. Neo4j when running in demo mode).
   */
  readonly optional?: boolean;
}

export interface HealthCheckOptions {
  readonly service: string;
  readonly version?: string;
  readonly probes?: readonly UpstreamProbe[];
}

async function runProbe(probe: UpstreamProbe): Promise<UpstreamResult> {
  const started = Date.now();
  const timeoutMs = probe.timeoutMs ?? 2_000;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`probe timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      probe
        .probe()
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (error) {
    return {
      status: probe.optional ? 'degraded' : 'fail',
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run every probe in parallel and roll up the worst status. Pure function:
 * the only side effect is the probes themselves — so a caller can cache
 * the payload, return it from multiple endpoints, etc.
 */
export async function runHealthCheck(
  options: HealthCheckOptions,
): Promise<HealthPayload> {
  const probes = options.probes ?? [];
  const results = await Promise.all(probes.map(runProbe));

  const upstreams: Record<string, UpstreamResult> = {};
  probes.forEach((probe, idx) => {
    upstreams[probe.name] = results[idx]!;
  });

  let overall: UpstreamStatus = 'ok';
  for (const r of results) {
    if (r.status === 'fail') {
      overall = 'fail';
      break;
    }
    if (r.status === 'degraded') overall = 'degraded';
  }

  return {
    status: overall,
    version: options.version ?? process.env.APP_VERSION ?? 'dev',
    service: options.service,
    timestamp: new Date().toISOString(),
    upstreams,
  };
}

/**
 * Convenience — HTTP status code mapping for the payload. 200 for ok /
 * degraded (still serving traffic), 503 for fail (take out of rotation).
 */
export function statusCodeFor(payload: HealthPayload): 200 | 503 {
  return payload.status === 'fail' ? 503 : 200;
}
