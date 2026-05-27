/**
 * 12-wire health probe.
 *
 * Each of the 12 cognitive subsystems is probed with a per-wire timeout
 * (`PROBE_TIMEOUT_MS = 2000ms`). The result classification:
 *
 *   ok        — probe resolved AND latency <= 800ms
 *   degraded  — probe resolved AND latency  > 800ms
 *   down      — probe rejected OR timed out
 *
 * Concurrency model (per ~/.claude/rules/coding-style.md + design §8.4):
 *   - All 12 probes are launched via `Promise.all` so total wall time
 *     never exceeds `PROBE_TIMEOUT_MS` regardless of subsystem latency.
 *   - Each probe runs inside an `Promise.race(probe, timeout)` to bound
 *     event-loop pressure (no probe holds the loop hostage).
 *   - Results are immutable: probes return new objects, never mutate.
 *
 * Persistence: every probe outcome is upserted to `cognitive_wiring_health`
 * via the injected {@link WireHealthStore}, keyed on (tenantId, wireName).
 *
 * @module @borjie/cognitive-composition/wire-health-probe
 */

import {
  PROBE_DEGRADED_LATENCY_MS,
  PROBE_TIMEOUT_MS,
  WIRE_NAMES,
  type CompositionDeps,
  type HealthReport,
  type WireHealth,
  type WireHealthStatus,
  type WireName,
  type WireProbeFn,
} from './types.js';

// ---------------------------------------------------------------------------
// Pure helpers
// ===========================================================================

/**
 * Race a probe against a hard timeout. The probe's own rejection still
 * surfaces (used to classify `down`). Returns a discriminated outcome that
 * downstream callers can pattern-match.
 */
export async function raceWithTimeout<T>(
  probe: () => Promise<T>,
  timeoutMs: number,
): Promise<
  | { readonly kind: 'ok'; readonly value: T; readonly elapsedMs: number }
  | { readonly kind: 'timeout'; readonly elapsedMs: number }
  | { readonly kind: 'error'; readonly error: Error; readonly elapsedMs: number }
> {
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;

  try {
    const value = await Promise.race<
      | { readonly kind: 'ok'; readonly value: T }
      | { readonly kind: 'timeout' }
    >([
      probe().then((v) => ({ kind: 'ok' as const, value: v })),
      new Promise<{ readonly kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' as const }), timeoutMs);
      }),
    ]);

    const elapsedMs = Date.now() - start;
    if (value.kind === 'timeout') {
      return { kind: 'timeout', elapsedMs };
    }
    return { kind: 'ok', value: value.value, elapsedMs };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const error =
      err instanceof Error ? err : new Error(String(err ?? 'unknown'));
    return { kind: 'error', error, elapsedMs };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Classify a probe outcome by status + latency thresholds.
 */
export function evaluateProbeOutcome(
  wireName: WireName,
  outcome: Awaited<ReturnType<typeof raceWithTimeout>>,
  probedAtIso: string,
): WireHealth {
  if (outcome.kind === 'ok') {
    const status: WireHealthStatus =
      outcome.elapsedMs > PROBE_DEGRADED_LATENCY_MS ? 'degraded' : 'ok';
    return {
      wireName,
      status,
      latencyMs: outcome.elapsedMs,
      probedAt: probedAtIso,
    };
  }
  if (outcome.kind === 'timeout') {
    return {
      wireName,
      status: 'down',
      latencyMs: outcome.elapsedMs,
      lastError: `timeout after ${PROBE_TIMEOUT_MS}ms`,
      probedAt: probedAtIso,
    };
  }
  return {
    wireName,
    status: 'down',
    latencyMs: outcome.elapsedMs,
    lastError: outcome.error.message,
    probedAt: probedAtIso,
  };
}

/**
 * Reduce the per-wire statuses to a single overall report status.
 * Rules:
 *   - any `down`     → overall `down`
 *   - any `degraded` → overall `degraded`
 *   - otherwise      → `ok`
 */
export function rollupOverall(
  wires: ReadonlyArray<WireHealth>,
): WireHealthStatus {
  if (wires.some((w) => w.status === 'down')) {
    return 'down';
  }
  if (wires.some((w) => w.status === 'degraded')) {
    return 'degraded';
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// Probe table — maps each wire to its probe function (kept in deps order).
// ===========================================================================

export interface ProbeBinding {
  readonly wireName: WireName;
  readonly probe: WireProbeFn;
}

/**
 * Build the canonical 12-probe table from injected dependencies. Centralised
 * so tests can verify length === 12 and the order matches WIRE_NAMES.
 */
export function buildDefaultProbes(deps: CompositionDeps): ReadonlyArray<ProbeBinding> {
  return [
    { wireName: 'cognitive-engine.inference', probe: deps.inference.probe },
    { wireName: 'cognitive-memory.episodic', probe: deps.memoryTiers.episodic.probe },
    { wireName: 'cognitive-memory.semantic', probe: deps.memoryTiers.semantic.probe },
    { wireName: 'cognitive-memory.procedural', probe: deps.memoryTiers.procedural.probe },
    { wireName: 'cognitive-memory.reflective', probe: deps.memoryTiers.reflective.probe },
    { wireName: 'extended-reasoning.cot', probe: deps.cot.probe },
    { wireName: 'reasoning-substrate.compile', probe: deps.substrate.probe },
    { wireName: 'central-intelligence.kernel', probe: deps.kernel.probe },
    { wireName: 'calibration-monitor.confidence', probe: deps.calibration.probe },
    { wireName: 'conformal-calibration-online.update', probe: deps.conformal.probe },
    { wireName: 'audit-hash-chain.append', probe: deps.audit.probe },
    { wireName: 'brain-llm-router.cascade', probe: deps.brainRouter.probe },
  ];
}

// ---------------------------------------------------------------------------
// runWireHealth — the public entry point used by `createCognitiveComposition`
// ===========================================================================

export interface RunWireHealthArgs {
  readonly tenantId: string;
  readonly deps: CompositionDeps;
}

/**
 * Run the 12-wire probe end-to-end:
 *   1) Build the probe table from deps.
 *   2) Launch all probes concurrently (each bounded by PROBE_TIMEOUT_MS).
 *   3) Persist each result via deps.healthStore.upsert.
 *   4) Return the assembled {@link HealthReport}.
 *
 * Persistence failures are logged into the per-wire `lastError` but do not
 * abort the report — the operator dashboard MUST still receive the latest
 * snapshot even if the writer is the thing that broke.
 */
export async function runWireHealth(args: RunWireHealthArgs): Promise<HealthReport> {
  const { tenantId, deps } = args;
  const probedAt = (deps.clock?.nowIso ?? defaultNowIso)();
  const bindings = buildDefaultProbes(deps);

  if (bindings.length !== WIRE_NAMES.length) {
    throw new Error(
      `wire-health-probe: expected ${WIRE_NAMES.length} probes, got ${bindings.length}`,
    );
  }

  const wires = await Promise.all(
    bindings.map(async (binding) => {
      const outcome = await raceWithTimeout(binding.probe, PROBE_TIMEOUT_MS);
      const wire = evaluateProbeOutcome(binding.wireName, outcome, probedAt);

      // Persist — never mutate `wire`; we want the same shape echoed back.
      try {
        const row = wire.lastError !== undefined
          ? {
              tenantId,
              wireName: wire.wireName,
              status: wire.status,
              latencyMs: wire.latencyMs,
              lastError: wire.lastError,
              probedAt: wire.probedAt,
            }
          : {
              tenantId,
              wireName: wire.wireName,
              status: wire.status,
              latencyMs: wire.latencyMs,
              probedAt: wire.probedAt,
            };
        await deps.healthStore.upsert(row);
      } catch (err) {
        const persistErr =
          err instanceof Error ? err.message : String(err ?? 'unknown');
        return {
          ...wire,
          lastError:
            wire.lastError !== undefined
              ? `${wire.lastError}; persist failed: ${persistErr}`
              : `persist failed: ${persistErr}`,
        };
      }

      return wire;
    }),
  );

  return {
    wires,
    overall: rollupOverall(wires),
    probedAt,
  };
}

function defaultNowIso(): string {
  return new Date().toISOString();
}
