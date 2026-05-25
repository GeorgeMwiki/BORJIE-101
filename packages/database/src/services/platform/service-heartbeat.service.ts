/**
 * Service heartbeat Drizzle adapter — backs the HQ-tier
 * `platform.system_health` tool (Central Command Phase B — B1, TIER 2).
 *
 * No `service_heartbeats` table exists in BORJIE yet. Per the B1
 * plan: when no DB-backed heartbeat table is present, synthesise the
 * health snapshot from:
 *   - `process.uptime()`              (api-gateway local liveness proxy)
 *   - `db.execute(sql\`SELECT 1\`)`   (primary DB connectivity probe)
 *
 * Composition root wires the same adapter into the HQ tool's
 * `ServiceHeartbeatPort.readSnapshot()`. Synthesised rows always
 * include `api-gateway` (uptime-derived) and `postgres-primary`
 * (probe-derived). Optional additional probes can be supplied via deps
 * for `redis` / `consolidation-worker` / `wake-loop` / `verify-cron`.
 *
 * Hard failures degrade gracefully:
 *   - readSnapshot       : on top-level error, returns an array of
 *                          `unknown`-state rows so the HQ tool still
 *                          renders something useful for the operator.
 */
import { sql } from 'drizzle-orm';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

export type ServiceHealthState =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown';

export interface ServiceHealthRow {
  readonly serviceName: string;
  readonly state: ServiceHealthState;
  readonly lastHeartbeatAt: string | null;
  readonly latencyMsP95: number | null;
  readonly notes: string | null;
}

export interface ServiceHeartbeatService {
  readSnapshot(): Promise<ReadonlyArray<ServiceHealthRow>>;
}

/**
 * Per-probe deps. Each probe is a fn returning `{ state, notes,
 * latencyMs }`. The adapter composes the rows.
 */
export interface ServiceHeartbeatDeps {
  /**
   * Resolves the local process uptime in milliseconds. Defaults to
   * `process.uptime() * 1000` when omitted. Tests inject a constant.
   */
  readonly uptimeMs?: () => number;
  /**
   * Additional probes (e.g. redis ping). Each returns the row directly
   * — the adapter wires them straight into `readSnapshot()` after the
   * synthesised api-gateway + postgres-primary rows.
   */
  readonly extraProbes?: ReadonlyArray<() => Promise<ServiceHealthRow>>;
  /**
   * Connection-test timeout in ms. The probe is bounded so an
   * unresponsive DB cannot block the HQ-tool call indefinitely.
   * Default: 1500 ms.
   */
  readonly dbProbeTimeoutMs?: number;
}

const MIN_HEALTHY_UPTIME_MS = 30_000;
const DEFAULT_DB_PROBE_TIMEOUT_MS = 1_500;

function uptimeToState(uptimeMs: number): ServiceHealthState {
  if (!Number.isFinite(uptimeMs) || uptimeMs <= 0) return 'unhealthy';
  if (uptimeMs < MIN_HEALTHY_UPTIME_MS) return 'degraded';
  return 'healthy';
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | { timedOut: true }> {
  return new Promise<T | { timedOut: true }>((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ timedOut: true });
      });
  });
}

export function createServiceHeartbeatService(
  db: DatabaseClient,
  deps?: ServiceHeartbeatDeps,
): ServiceHeartbeatService {
  return {
    async readSnapshot() {
      const rows: ServiceHealthRow[] = [];
      const nowIso = new Date().toISOString();

      // 1) api-gateway (process uptime).
      try {
        const upMs =
          deps?.uptimeMs?.() ??
          (typeof process !== 'undefined' && typeof process.uptime === 'function'
            ? Math.round(process.uptime() * 1000)
            : 0);
        rows.push({
          serviceName: 'api-gateway',
          state: uptimeToState(upMs),
          lastHeartbeatAt: nowIso,
          latencyMsP95: null,
          notes: `synthesised from process.uptime(): ${upMs}ms`,
        });
      } catch (error) {
        logger.error('service-heartbeat: api-gateway probe failed', { error: error });
        rows.push({
          serviceName: 'api-gateway',
          state: 'unknown',
          lastHeartbeatAt: nowIso,
          latencyMsP95: null,
          notes: 'uptime probe threw',
        });
      }

      // 2) postgres-primary (SELECT 1 probe with timeout).
      const dbTimeout = deps?.dbProbeTimeoutMs ?? DEFAULT_DB_PROBE_TIMEOUT_MS;
      const dbStarted = Date.now();
      try {
        const probe = (db as unknown as {
          execute(q: unknown): Promise<unknown>;
        }).execute(sql`SELECT 1`);
        const result = await withTimeout(probe, dbTimeout);
        const latencyMs = Date.now() - dbStarted;
        const timedOut = !!(result && typeof result === 'object' && 'timedOut' in result);
        rows.push({
          serviceName: 'postgres-primary',
          state: timedOut
            ? 'unhealthy'
            : latencyMs > 800
              ? 'degraded'
              : 'healthy',
          lastHeartbeatAt: nowIso,
          latencyMsP95: latencyMs,
          notes: timedOut
            ? `SELECT 1 timed out after ${dbTimeout}ms`
            : `SELECT 1 returned in ${latencyMs}ms`,
        });
      } catch (error) {
        logger.error('service-heartbeat: postgres probe failed', { error: error });
        rows.push({
          serviceName: 'postgres-primary',
          state: 'unhealthy',
          lastHeartbeatAt: nowIso,
          latencyMsP95: null,
          notes: 'SELECT 1 threw',
        });
      }

      // 3) optional probes.
      for (const probe of deps?.extraProbes ?? []) {
        try {
          const row = await probe();
          rows.push(row);
        } catch (error) {
          logger.error('service-heartbeat: extra probe failed', { error: error });
        }
      }

      return rows;
    },
  };
}
