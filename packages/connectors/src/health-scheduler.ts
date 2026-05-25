/**
 * Health Scheduler — background loop that periodically pings each
 * registered connector and writes the rolled-up health snapshot back
 * into the registry. Mirrors LITFIN's `src/core/mcp/health-scheduler.ts`.
 *
 * Closes Gap C from `.planning/parity-litfin/09-tools-connectors-kg.md`.
 *
 * Strategy:
 *   - Every `intervalMs` (default 30s), iterate the registry's current
 *     `list()` and probe every entry that supplied a `healthProbe`.
 *   - The probe must return `true` for healthy; throwing or returning
 *     `false` flips the cached status to `unhealthy`.
 *   - The probe is also wrapped in `probeTimeoutMs` so a single hung
 *     dependency cannot stall the loop.
 *   - We also call `connector.health()` so circuit-breaker state
 *     transitions show up in the cache even if no traffic ran.
 *   - An optional `observability` sink receives every probe result so
 *     dashboards and OpenTelemetry can subscribe without polling.
 *
 * The scheduler is a pure factory: no global timer, no static state.
 * The caller drives the lifecycle via `start()` / `stop()`. Tests
 * inject a fake clock + fake `setInterval` so they run synchronously.
 */

import type {
  ConnectorEntry,
  ConnectorHealth,
  ConnectorRegistry,
} from './registry.js';

// ---------- Public types ----------

export interface HealthProbeResult {
  readonly connectorId: string;
  readonly status: ConnectorHealth['status'];
  readonly latencyMs: number;
  readonly error: string | null;
  readonly at: string;
}

export interface HealthObservabilitySink {
  /**
   * Called once per probe — successful, failed, or timed-out. Must not
   * throw; the scheduler swallows errors thrown by the sink so they
   * cannot disrupt the loop.
   */
  recordProbe(result: HealthProbeResult): void;
}

export interface HealthScheduler {
  /** Begin periodic probing. Idempotent — second call is a no-op. */
  start(): void;
  /** Halt periodic probing. Idempotent. */
  stop(): void;
  /** Run a single probing pass synchronously (test helper). */
  probeOnce(): Promise<ReadonlyArray<HealthProbeResult>>;
  /** Whether the scheduler is currently active. */
  isRunning(): boolean;
}

export interface HealthSchedulerDeps {
  readonly registry: ConnectorRegistry;
  /** Probe cadence in ms. Default 30_000. */
  readonly intervalMs?: number;
  /** Hard ceiling on a single probe before we mark it unhealthy. Default 5_000. */
  readonly probeTimeoutMs?: number;
  /** Optional sink the scheduler hands every probe result. */
  readonly observability?: HealthObservabilitySink;
  /** Injection point for tests. Default `setInterval`. */
  readonly setInterval?: (cb: () => void, ms: number) => unknown;
  /** Injection point for tests. Default `clearInterval`. */
  readonly clearInterval?: (handle: unknown) => void;
  readonly clock?: () => number;
}

// ---------- Helpers ----------

const DEFAULTS = Object.freeze({
  intervalMs: 30_000,
  probeTimeoutMs: 5_000,
});

function statusFromCircuit(circuit: ConnectorHealth['circuit']): ConnectorHealth['status'] {
  if (circuit.state === 'open') return 'unhealthy';
  if (circuit.state === 'half-open') return 'degraded';
  if (circuit.errorCount > 0) return 'degraded';
  return 'healthy';
}

async function runProbeWithTimeout(
  probe: () => Promise<boolean>,
  timeoutMs: number,
): Promise<{ ok: boolean; error: string | null }> {
  return await new Promise<{ ok: boolean; error: string | null }>((resolve) => {
    let settled = false;
    const handle = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: `probe timed out after ${timeoutMs}ms` });
    }, Math.max(1, timeoutMs));

    void Promise.resolve()
      .then(() => probe())
      .then(
        (val: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(handle);
          resolve({ ok: val === true, error: val === true ? null : 'probe returned false' });
        },
        (err: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(handle);
          resolve({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      );
  });
}

// ---------- Factory ----------

export function createHealthScheduler(deps: HealthSchedulerDeps): HealthScheduler {
  const { registry } = deps;
  const intervalMs = Math.max(1, deps.intervalMs ?? DEFAULTS.intervalMs);
  const probeTimeoutMs = Math.max(1, deps.probeTimeoutMs ?? DEFAULTS.probeTimeoutMs);
  const observability = deps.observability;
  const clock = deps.clock ?? Date.now;
  const setIntervalImpl =
    deps.setInterval ??
    ((cb: () => void, ms: number) =>
      setInterval(cb, ms) as unknown as ReturnType<typeof setInterval>);
  const clearIntervalImpl =
    deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

  let handle: unknown = null;

  async function probeEntry(entry: ConnectorEntry): Promise<HealthProbeResult> {
    const startedAt = clock();

    // 1. Pull current circuit state — even probe-less connectors get a
    //    cache refresh so dashboards reflect breaker transitions.
    const circuit = entry.connector.health();
    let status: ConnectorHealth['status'] = statusFromCircuit(circuit);

    let error: string | null = null;
    let latencyMs = 0;

    if (entry.healthProbe) {
      const before = clock();
      const probeResult = await runProbeWithTimeout(entry.healthProbe, probeTimeoutMs);
      latencyMs = clock() - before;
      if (!probeResult.ok) {
        status = 'unhealthy';
        error = probeResult.error;
      }
    }

    const at = new Date(startedAt).toISOString();
    const nextHealth: ConnectorHealth = {
      circuit,
      status,
      lastCheckedAt: at,
      lastError: error,
      probeLatencyMs: entry.healthProbe ? latencyMs : null,
    };
    registry.setHealth(entry.id, nextHealth);

    const result: HealthProbeResult = {
      connectorId: entry.id,
      status,
      latencyMs,
      error,
      at,
    };
    if (observability) {
      try {
        observability.recordProbe(result);
      } catch {
        // Sink must not break the scheduler.
      }
    }
    return result;
  }

  async function probeOnce(): Promise<ReadonlyArray<HealthProbeResult>> {
    const entries = registry.list();
    const results: HealthProbeResult[] = [];
    for (const entry of entries) {
      try {
        const result = await probeEntry(entry);
        results.push(result);
      } catch (err) {
        // Last-resort safety net — should not happen given probeEntry
        // already swallows probe errors.
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          connectorId: entry.id,
          status: 'unhealthy',
          latencyMs: 0,
          error: message,
          at: new Date(clock()).toISOString(),
        });
      }
    }
    return Object.freeze(results);
  }

  function tick(): void {
    void probeOnce();
  }

  function start(): void {
    if (handle !== null) return;
    handle = setIntervalImpl(tick, intervalMs);
  }

  function stop(): void {
    if (handle === null) return;
    clearIntervalImpl(handle);
    handle = null;
  }

  function isRunning(): boolean {
    return handle !== null;
  }

  return {
    start,
    stop,
    probeOnce,
    isRunning,
  };
}
