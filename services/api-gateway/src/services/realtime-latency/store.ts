/**
 * Realtime latency store (RT-3).
 *
 * Holds an in-process ring of cockpit-event round-trip measurements
 * reported by SSE consumers. Each measurement is the difference
 * between the event's server-side `emittedAt` and the client-side
 * `Date.now()` at the moment the event landed.
 *
 * The store is per-tenant; a singleton ring caps memory at
 * MAX_PER_TENANT entries. We compute P50/P95/P99 + min/max/avg on
 * demand from the ring — no background aggregation needed at this
 * volume (a few thousand events per tenant per day at most).
 *
 * Why in-process and not Postgres / Prometheus?
 *   - Same logic as the cockpit-events bus: single-node MVP, swap
 *     seam later. When we shard, push aggregations to a Redis stream
 *     or the existing Prometheus collector.
 *   - The cockpit "Live sync" widget reads this directly; latency
 *     itself must not introduce more latency.
 *
 * Inputs are validated by the route handler (zod); the store trusts
 * its inputs to be finite non-negative integers ≤ 60_000.
 */

const MAX_PER_TENANT = 1_000;
const MAX_LATENCY_MS = 60_000;

interface TenantRing {
  readonly samples: number[];
}

const rings = new Map<string, TenantRing>();

/**
 * Record one latency measurement (ms) for a tenant. Discards values
 * outside the sane window so a misbehaving client cannot poison the
 * aggregates.
 */
export function recordLatency(tenantId: string, latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0 || latencyMs > MAX_LATENCY_MS) {
    return;
  }
  let ring = rings.get(tenantId);
  if (!ring) {
    ring = { samples: [] };
    rings.set(tenantId, ring);
  }
  ring.samples.push(latencyMs);
  if (ring.samples.length > MAX_PER_TENANT) {
    ring.samples.splice(0, ring.samples.length - MAX_PER_TENANT);
  }
}

export interface LatencyStats {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
}

const EMPTY_STATS: LatencyStats = {
  count: 0,
  p50: 0,
  p95: 0,
  p99: 0,
  min: 0,
  max: 0,
  avg: 0,
};

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((pct / 100) * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

/** Compute aggregated stats for the tenant ring. */
export function getStats(tenantId: string): LatencyStats {
  const ring = rings.get(tenantId);
  if (!ring || ring.samples.length === 0) {
    return EMPTY_STATS;
  }
  const sorted = [...ring.samples].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    avg: Math.round(sum / sorted.length),
  };
}

/** Test helper — clear every tenant ring. NEVER call from non-test code. */
export function __resetLatencyStoreForTests(): void {
  rings.clear();
}
