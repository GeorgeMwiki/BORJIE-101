/**
 * Sensor failover — multi-provider routing with rolling-window health
 * + 3-strike circuit breaker.
 *
 * LITFIN-parity surface (`.planning/parity-litfin/04-sensors-routing.md`
 * section 3): the brain is sensor-agnostic, but when a sensor misfires
 * (5xx, timeout, rate-limit, malformed response) the kernel must fail
 * over to the next-ready sensor without surfacing the error to the
 * caller. Tone may shift slightly; intelligence does not.
 *
 * Health is tracked per sensor with a 60 s rolling sliding window:
 *
 *   - successes / failures observed in the last 60 s
 *   - consecutive-failure counter
 *   - breaker state machine — 'closed' (normal) → 'open' (cooling)
 *     → 'half-open' (one probe allowed) → 'closed' (recovered)
 *
 * Breaker tuning:
 *   - 3 consecutive failures open the breaker (one bad flap doesn't
 *     trip the circuit)
 *   - 60 s cooldown puts the breaker into half-open and lets one probe
 *     attempt through (success closes it; another failure re-opens)
 *
 * The router walks sensors by priority + success-rate. Capability
 * filtering (vision / thinking / fast / batch) prunes the list before
 * health does, so a vision request never falls back to a text-only sensor.
 *
 * Pure orchestrator. Sensor implementations are injected by the
 * composition root; the router never imports a provider SDK.
 */

import type { Sensor, SensorCallArgs, SensorCallResult } from './kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_HEALTH_WINDOW_MS = 60_000;
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

export type SensorOutcome = 'ok' | 'fail';
export type BreakerState = 'closed' | 'open' | 'half-open';

export interface SensorHealthSnapshot {
  readonly id: string;
  readonly successCount: number;
  readonly failureCount: number;
  readonly consecutiveFailures: number;
  readonly breakerState: BreakerState;
  /** Wall-clock ms when the breaker last opened. 0 when never opened. */
  readonly openedAt: number;
  /** Remaining cooldown in ms (0 when breaker closed / half-open). */
  readonly cooldownRemainingMs: number;
  /** successes / (successes + failures); 1 when no data yet. */
  readonly successRate: number;
}

export class SensorFailoverError extends Error {
  constructor(
    public readonly attempts: ReadonlyArray<{ sensorId: string; error: string }>,
  ) {
    super(
      `all sensors failed: ${attempts.map((a) => `${a.sensorId}=${a.error}`).join('; ')}`,
    );
    this.name = 'SensorFailoverError';
  }
}

export interface SensorFailoverDeps {
  readonly sensors: ReadonlyArray<Sensor>;
  readonly coolDownMs?: number;
  readonly healthWindowMs?: number;
  readonly breakerThreshold?: number;
  readonly clock?: () => number;
}

/**
 * Public shape of the router's degraded-mode state. Surfaced to the
 * kernel so it can stamp a `DegradedDecisionMarker` on every decision
 * produced while ANY sensor breaker is open, and to the gateway's
 * `/healthz/dependencies` endpoint so ops sees which provider is
 * serving traffic.
 */
export interface DegradedState {
  /** `true` whenever at least one sensor breaker is open. */
  readonly degraded: boolean;
  /** Sensor ids whose breaker is currently open. */
  readonly openSensors: ReadonlyArray<string>;
  /**
   * The sensor that would serve a request right now — i.e. the first
   * eligible sensor by priority + success-rate. Null only when no
   * sensors at all are registered (composition-root misconfig).
   */
  readonly currentProvider: string | null;
  /** Wall-clock ms when the FIRST breaker opened in this degraded run. */
  readonly degradedAt: number | null;
  /** Wall-clock ms of the most recent failure observed across all sensors. */
  readonly lastFailedAt: number | null;
}

export interface SensorRouter {
  /**
   * Call the next-ready sensor that satisfies the required capabilities.
   * `preferred` pins one sensor to the front of the order (e.g. user
   * preference); ignored when the preferred sensor's breaker is open
   * AND alternatives are available.
   */
  call(
    args: SensorCallArgs,
    required: ReadonlyArray<Sensor['capabilities'][number]>,
    options?: { readonly preferred?: string },
  ): Promise<SensorCallResult>;
  /**
   * Public health snapshot — 5+ fields per sensor that an ops dashboard
   * can render directly. Computed against the rolling window so it
   * never returns stale data.
   */
  snapshotHealth(): ReadonlyArray<SensorHealthSnapshot>;
  /**
   * Snapshot of degraded-mode state — used by the kernel to stamp a
   * `DegradedDecisionMarker` on outgoing `BrainDecision`s and by the
   * gateway healthz endpoint for ops visibility.
   */
  getDegradedState(): DegradedState;
  /**
   * Backwards-compatible thin health summary (id / healthy / lastFailureAt).
   * `healthy` is `false` only when the breaker is `open`.
   */
  health(): ReadonlyArray<{
    id: string;
    healthy: boolean;
    lastFailureAt: number | null;
  }>;
  /** Wipe every sensor's health record. Test helper + ops escape hatch. */
  resetAll(): void;
}

interface HealthState {
  successes: number[];
  failures: number[];
  consecutiveFailures: number;
  breakerState: BreakerState;
  openedAt: number;
  lastFailureAt: number | null;
}

export function createSensorRouter(deps: SensorFailoverDeps): SensorRouter {
  const coolDownMs = deps.coolDownMs ?? DEFAULT_COOLDOWN_MS;
  const windowMs = deps.healthWindowMs ?? DEFAULT_HEALTH_WINDOW_MS;
  const breakerThreshold = deps.breakerThreshold ?? DEFAULT_BREAKER_THRESHOLD;
  const clock = deps.clock ?? Date.now;
  const state = new Map<string, HealthState>();

  function ensure(id: string): HealthState {
    let h = state.get(id);
    if (!h) {
      h = {
        successes: [],
        failures: [],
        consecutiveFailures: 0,
        breakerState: 'closed',
        openedAt: 0,
        lastFailureAt: null,
      };
      state.set(id, h);
    }
    return h;
  }

  function trim(buf: number[], now: number): void {
    const cutoff = now - windowMs;
    while (buf.length > 0 && buf[0] < cutoff) buf.shift();
  }

  /**
   * Advance the breaker FSM based on the wall clock — `open` may have
   * cooled down enough to move to `half-open`. Called on every read so
   * snapshots stay current without a background timer.
   */
  function adjustBreaker(h: HealthState, now: number): void {
    if (h.breakerState === 'open' && now - h.openedAt >= coolDownMs) {
      h.breakerState = 'half-open';
    }
  }

  function recordOutcome(id: string, outcome: SensorOutcome, now: number): void {
    const h = ensure(id);
    trim(h.successes, now);
    trim(h.failures, now);
    if (outcome === 'ok') {
      h.successes.push(now);
      h.consecutiveFailures = 0;
      // Any success closes the breaker — half-open probe succeeded.
      h.breakerState = 'closed';
      h.openedAt = 0;
    } else {
      h.failures.push(now);
      h.lastFailureAt = now;
      h.consecutiveFailures += 1;
      if (h.breakerState === 'half-open') {
        // Half-open probe failed → re-open the breaker.
        h.breakerState = 'open';
        h.openedAt = now;
      } else if (
        h.consecutiveFailures >= breakerThreshold &&
        h.breakerState === 'closed'
      ) {
        h.breakerState = 'open';
        h.openedAt = now;
      }
    }
  }

  function buildSnapshot(id: string, now: number): SensorHealthSnapshot {
    const h = state.get(id);
    if (!h) {
      return {
        id,
        successCount: 0,
        failureCount: 0,
        consecutiveFailures: 0,
        breakerState: 'closed',
        openedAt: 0,
        cooldownRemainingMs: 0,
        successRate: 1,
      };
    }
    trim(h.successes, now);
    trim(h.failures, now);
    adjustBreaker(h, now);
    const total = h.successes.length + h.failures.length;
    const successRate = total === 0 ? 1 : h.successes.length / total;
    const cooldownRemainingMs =
      h.breakerState === 'open'
        ? Math.max(0, h.openedAt + coolDownMs - now)
        : 0;
    return {
      id,
      successCount: h.successes.length,
      failureCount: h.failures.length,
      consecutiveFailures: h.consecutiveFailures,
      breakerState: h.breakerState,
      openedAt: h.openedAt,
      cooldownRemainingMs,
      successRate,
    };
  }

  /** Filter + order sensors for an attempt. */
  function pickOrder(
    required: ReadonlyArray<Sensor['capabilities'][number]>,
    preferred: string | undefined,
    now: number,
  ): { eligible: ReadonlyArray<Sensor>; lastResort: ReadonlyArray<Sensor> } {
    const capable = deps.sensors.filter((s) =>
      required.every((cap) => s.capabilities.includes(cap)),
    );
    // Update each capable sensor's breaker FSM so half-open probes
    // become eligible even though the snapshot was last read minutes
    // ago.
    for (const s of capable) {
      const h = state.get(s.id);
      if (h) adjustBreaker(h, now);
    }

    const ready: Sensor[] = [];
    const cooldown: Sensor[] = [];
    for (const s of capable) {
      const h = state.get(s.id);
      if (!h || h.breakerState !== 'open') ready.push(s);
      else cooldown.push(s);
    }

    const rateOf = (s: Sensor): number => buildSnapshot(s.id, now).successRate;
    const score = (a: Sensor, b: Sensor): number => {
      if (preferred && a.id === preferred && b.id !== preferred) return -1;
      if (preferred && b.id === preferred && a.id !== preferred) return 1;
      // Lower priority wins.
      if (a.priority !== b.priority) return a.priority - b.priority;
      // Then prefer higher success rate.
      const rateDelta = rateOf(b) - rateOf(a);
      if (Math.abs(rateDelta) > 1e-6) return rateDelta;
      return 0;
    };

    return {
      eligible: ready.sort(score),
      // If every sensor is cooled down, return them anyway — degraded
      // mode beats silent refusal.
      lastResort: cooldown.sort(score),
    };
  }

  return {
    async call(args, required, options) {
      const now = clock();
      const { eligible, lastResort } = pickOrder(
        required,
        options?.preferred,
        now,
      );
      const order =
        eligible.length > 0 ? eligible : (lastResort as ReadonlyArray<Sensor>);
      if (order.length === 0) {
        throw new SensorFailoverError([
          {
            sensorId: '__none__',
            error: `no sensor satisfies capabilities=${required.join(',')}`,
          },
        ]);
      }
      const attempts: Array<{ sensorId: string; error: string }> = [];
      for (const sensor of order) {
        try {
          const out = await sensor.call(args);
          recordOutcome(sensor.id, 'ok', clock());
          return out;
        } catch (err) {
          recordOutcome(sensor.id, 'fail', clock());
          attempts.push({
            sensorId: sensor.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      throw new SensorFailoverError(attempts);
    },

    snapshotHealth() {
      const now = clock();
      return deps.sensors.map((s) => buildSnapshot(s.id, now));
    },

    getDegradedState() {
      const now = clock();
      // Walk every registered sensor, advancing the breaker FSM so the
      // returned `openSensors` reflects "open RIGHT NOW" (not "open
      // when last polled").
      for (const s of deps.sensors) {
        const h = state.get(s.id);
        if (h) adjustBreaker(h, now);
      }
      const openSensors: string[] = [];
      let degradedAt: number | null = null;
      let lastFailedAt: number | null = null;
      for (const s of deps.sensors) {
        const h = state.get(s.id);
        if (!h) continue;
        if (h.breakerState === 'open') {
          openSensors.push(s.id);
          // First-open wins so `degradedAt` is the start of the run.
          if (degradedAt === null || h.openedAt < degradedAt) {
            degradedAt = h.openedAt;
          }
        }
        if (h.lastFailureAt !== null) {
          if (lastFailedAt === null || h.lastFailureAt > lastFailedAt) {
            lastFailedAt = h.lastFailureAt;
          }
        }
      }
      // currentProvider: the first sensor that would serve right now.
      // Includes last-resort routing so even an all-open state surfaces
      // the sensor we'd burn a probe on.
      let currentProvider: string | null = null;
      if (deps.sensors.length > 0) {
        const capable = [...deps.sensors];
        const ready = capable.filter((s) => {
          const h = state.get(s.id);
          return !h || h.breakerState !== 'open';
        });
        const pool = ready.length > 0 ? ready : capable;
        const sorted = [...pool].sort((a, b) => a.priority - b.priority);
        currentProvider = sorted[0]?.id ?? null;
      }
      return {
        degraded: openSensors.length > 0,
        openSensors,
        currentProvider,
        degradedAt,
        lastFailedAt,
      };
    },

    health() {
      const now = clock();
      return deps.sensors.map((s) => {
        const snap = buildSnapshot(s.id, now);
        return {
          id: s.id,
          healthy: snap.breakerState !== 'open',
          lastFailureAt: state.get(s.id)?.lastFailureAt ?? null,
        };
      });
    },

    resetAll() {
      state.clear();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Cascade routing — Haiku → Sonnet tier escalation.
//
// The cascade is a higher-level router that decides WHICH MODEL TIER to
// call first based on stakes + judge confidence. It composes WITH the
// failover above — provider-level health, breakers, and capability
// filtering remain the `SensorRouter`'s job. The cascade lives in
// `./sensor-failover-cascade.ts` (large enough to merit its own file)
// and is re-exported here so callers continue to import from a single
// `sensor-failover` barrel.
// ─────────────────────────────────────────────────────────────────────

export {
  cascadeRoute,
  type CascadeAttempt,
  type CascadeEscalationReason,
  type CascadeJudgeFn,
  type CascadeJudgeOutcome,
  type CascadeMetricsPort,
  type CascadeModelTier,
  type CascadeResult,
  type CascadeRouteDeps,
  type CascadeRouteOptions,
  type CascadeStakesLevel,
} from './sensor-failover-cascade.js';
