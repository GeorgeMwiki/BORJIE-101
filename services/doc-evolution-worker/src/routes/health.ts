/**
 * routes/health — health-probe surface for the worker.
 *
 * The worker is primarily cron-driven, but Kubernetes / Render / Fly
 * livens/readiness probes want a synchronous HTTP yes/no. We expose
 * two framework-agnostic handlers so the composition root can wire
 * them to either Fastify, Express, or Node's bare HTTP server.
 *
 * Health semantics:
 *   - liveness: process is up; returns `200 ok` always (cheap).
 *   - readiness: the last cron tick completed within `staleness_threshold_ms`.
 *     `LAST_AGGREGATION_AT` is mutated by the worker; tests inject a
 *     `Clock` and a `getLastRun` callback.
 */

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthSnapshot {
  readonly status: HealthStatus;
  readonly last_aggregation_at: string | null;
  readonly staleness_ms: number | null;
  readonly tier2_queue_polling: boolean;
}

export interface HealthCheckArgs {
  readonly getLastAggregationAt: () => string | null;
  readonly getTier2QueuePolling: () => boolean;
  readonly now: () => Date;
  readonly staleness_threshold_ms: number;
}

export function evaluateHealth(args: HealthCheckArgs): HealthSnapshot {
  const last = args.getLastAggregationAt();
  if (last === null) {
    return {
      status: 'degraded',
      last_aggregation_at: null,
      staleness_ms: null,
      tier2_queue_polling: args.getTier2QueuePolling(),
    };
  }
  const nowMs = args.now().getTime();
  const lastMs = Date.parse(last);
  if (!Number.isFinite(lastMs)) {
    return {
      status: 'down',
      last_aggregation_at: last,
      staleness_ms: null,
      tier2_queue_polling: args.getTier2QueuePolling(),
    };
  }
  const staleness = Math.max(0, nowMs - lastMs);
  const status: HealthStatus =
    staleness > args.staleness_threshold_ms ? 'degraded' : 'ok';
  return {
    status,
    last_aggregation_at: last,
    staleness_ms: staleness,
    tier2_queue_polling: args.getTier2QueuePolling(),
  };
}

/** HTTP-agnostic body — the composition root serialises to JSON. */
export function livenessBody(): Readonly<Record<string, string>> {
  return { status: 'ok' };
}

export function readinessBody(snapshot: HealthSnapshot): HealthSnapshot {
  return snapshot;
}
