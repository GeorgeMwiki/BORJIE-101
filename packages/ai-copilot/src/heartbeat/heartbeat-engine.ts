/**
 * BORJIE AI heartbeat engine — Wave-11 + Wave 27 (Part B.8 expansion).
 *
 * Pure, testable tick loop. Every active Brain instance calls `tick()` at a
 * configurable cadence (default 30 s). Wave-11 shipped five baked-in duties
 * (junior-sleep, LLM health, cost-ledger roll, telemetry, memory-decay).
 *
 * Wave 27 (Part B.8) amplification: the engine now accepts an extensible
 * **duty registry**. Each duty declares its own cadence (`fast` 5 s /
 * `medium` 60 s / `slow` 5 min) and idempotency key. The engine decides on
 * every tick which duties are due, runs them fail-soft, and reports per-duty
 * telemetry. The original five duties are preserved; the 15 new duties listed
 * in phM-platform-blueprint Part B.8 are registered as optional duties
 * injected by the composition root.
 *
 * Design invariants:
 *   - The engine is purely clock-driven (`deps.now()`) so tests never wait.
 *   - A single duty's failure never skips siblings (try/catch per duty).
 *   - The engine's `tick()` still resolves with the legacy `HeartbeatTickResult`
 *     shape used by existing tests; new telemetry is accessed via
 *     `dutyTelemetry`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JuniorSession {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly lastActivityAt: number;
  readonly awake: boolean;
}

export interface HeartbeatTickInput {
  readonly juniors: readonly JuniorSession[];
  readonly activeTenantIds: readonly string[];
}

/** Per-duty telemetry record. One entry per duty evaluated on this tick. */
export interface DutyTelemetryEntry {
  readonly dutyId: string;
  readonly cadence: HeartbeatCadence;
  readonly tickedAt: number;
  readonly outcome: 'ok' | 'error' | 'skipped';
  readonly durationMs: number;
  readonly errorMessage?: string;
}

export interface HeartbeatTickResult {
  readonly tickAt: number;
  readonly juniorsPutToSleep: readonly string[];
  readonly juniorsKeptAwake: readonly string[];
  readonly llmHealthy: boolean;
  readonly ledgersRolled: number;
  readonly memorySweeps: number;
  /** Per-duty telemetry for the duty-registry (excludes legacy duties). */
  readonly dutyTelemetry: readonly DutyTelemetryEntry[];
  /** Count of duties that ran successfully. */
  readonly dutiesExecuted: number;
  /** Count of duties that threw. */
  readonly dutiesFailed: number;
}

/**
 * Cadence tiers the engine supports. Each tick considers every duty:
 *   - `fast`   → eligible every `FAST_CADENCE_MS` (default 5 s)
 *   - `medium` → eligible every `MEDIUM_CADENCE_MS` (default 60 s)
 *   - `slow`   → eligible every `SLOW_CADENCE_MS` (default 5 min)
 *
 * Individual duties may override via `cadenceMs` when they need a different
 * interval. When both `cadence` and `cadenceMs` are set, `cadenceMs` wins.
 */
export type HeartbeatCadence = 'fast' | 'medium' | 'slow';

export const FAST_CADENCE_MS = 5_000;
export const MEDIUM_CADENCE_MS = 60_000;
export const SLOW_CADENCE_MS = 5 * 60_000;

const CADENCE_DEFAULT_MS: Record<HeartbeatCadence, number> = {
  fast: FAST_CADENCE_MS,
  medium: MEDIUM_CADENCE_MS,
  slow: SLOW_CADENCE_MS,
};

/** A single heartbeat duty. The engine calls `run(ctx)` when it is due. */
export interface HeartbeatDuty {
  readonly id: string;
  readonly cadence: HeartbeatCadence;
  /** Override cadence period in ms. Falls back to `cadence` default. */
  readonly cadenceMs?: number | undefined;
  /** Human-readable description — surfaced in telemetry logs. */
  readonly description?: string | undefined;
  /** Default: true. Set to false to park the duty without removing it. */
  readonly enabled?: boolean | undefined;
  run(ctx: HeartbeatDutyContext): Promise<void>;
}

export interface HeartbeatDutyContext {
  readonly tickAt: number;
  readonly activeTenantIds: readonly string[];
}

export interface HeartbeatDeps {
  readonly now: () => number;
  readonly juniorIdleMs?: number;
  readonly probeLlmHealth?: () => Promise<boolean>;
  readonly rollLedger?: (tenantId: string) => Promise<void>;
  readonly sweepMemoryForTenant?: (tenantId: string) => Promise<void>;
  readonly onJuniorSleep?: (sessionId: string) => void;
  readonly onJuniorWake?: (sessionId: string) => void;
  readonly telemetry?: (event: HeartbeatTickResult) => void;
  /** Optional duty registry — NEW in Wave 27 (Part B.8). */
  readonly duties?: readonly HeartbeatDuty[];
}

export interface HeartbeatEngine {
  tick(input: HeartbeatTickInput): Promise<HeartbeatTickResult>;
  wake(sessionId: string): void;
  /** Cadence in ms suggested to schedulers wiring this engine. */
  readonly cadenceMs: number;
  /** Inspect: currently registered duty ids. */
  readonly dutyIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_JUNIOR_IDLE_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_HEARTBEAT_CADENCE_MS = 30 * 1000; // 30 seconds

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface HeartbeatEngineOptions {
  readonly cadenceMs?: number;
}

export function createHeartbeatEngine(
  deps: HeartbeatDeps,
  options: HeartbeatEngineOptions = {},
): HeartbeatEngine {
  const idleMs = deps.juniorIdleMs ?? DEFAULT_JUNIOR_IDLE_MS;
  const cadenceMs = options.cadenceMs ?? DEFAULT_HEARTBEAT_CADENCE_MS;
  const explicitlyWoken = new Set<string>();

  // Track last-fired ms per duty so we honour each duty's cadence.
  const duties = deps.duties ?? [];
  const lastFiredAt = new Map<string, number>();

  function isDutyDue(duty: HeartbeatDuty, tickAt: number): boolean {
    if (duty.enabled === false) return false;
    const periodMs = duty.cadenceMs ?? CADENCE_DEFAULT_MS[duty.cadence];
    const last = lastFiredAt.get(duty.id) ?? Number.NEGATIVE_INFINITY;
    return tickAt - last >= periodMs;
  }

  return {
    cadenceMs,
    dutyIds: duties.map((d) => d.id),

    wake(sessionId) {
      if (!sessionId) return;
      explicitlyWoken.add(sessionId);
      deps.onJuniorWake?.(sessionId);
    },

    async tick(input) {
      const tickAt = deps.now();

      const juniorsPutToSleep: string[] = [];
      const juniorsKeptAwake: string[] = [];

      for (const j of input.juniors) {
        if (explicitlyWoken.has(j.sessionId)) {
          juniorsKeptAwake.push(j.sessionId);
          explicitlyWoken.delete(j.sessionId);
          continue;
        }
        const idleFor = tickAt - j.lastActivityAt;
        if (j.awake && idleFor >= idleMs) {
          juniorsPutToSleep.push(j.sessionId);
          deps.onJuniorSleep?.(j.sessionId);
        } else if (j.awake) {
          juniorsKeptAwake.push(j.sessionId);
        }
      }

      // LLM health probe — never throws.
      let llmHealthy = true;
      if (deps.probeLlmHealth) {
        try {
          llmHealthy = await deps.probeLlmHealth();
        } catch {
          llmHealthy = false;
        }
      }

      // Roll ledgers per active tenant.
      let ledgersRolled = 0;
      if (deps.rollLedger) {
        for (const tenantId of input.activeTenantIds) {
          try {
            await deps.rollLedger(tenantId);
            ledgersRolled += 1;
          } catch {
            // Non-fatal; next tick retries.
          }
        }
      }

      // Memory decay sweep.
      let memorySweeps = 0;
      if (deps.sweepMemoryForTenant) {
        for (const tenantId of input.activeTenantIds) {
          try {
            await deps.sweepMemoryForTenant(tenantId);
            memorySweeps += 1;
          } catch {
            // Non-fatal; next tick retries.
          }
        }
      }

      // Wave 27 (Part B.8): run any duty whose cadence is due. Each duty
      // is isolated — a throw in one never blocks another.
      const dutyTelemetry: DutyTelemetryEntry[] = [];
      let dutiesExecuted = 0;
      let dutiesFailed = 0;
      for (const duty of duties) {
        if (!isDutyDue(duty, tickAt)) {
          dutyTelemetry.push({
            dutyId: duty.id,
            cadence: duty.cadence,
            tickedAt: tickAt,
            outcome: 'skipped',
            durationMs: 0,
          });
          continue;
        }
        const startedAt = deps.now();
        try {
          await duty.run({
            tickAt,
            activeTenantIds: input.activeTenantIds,
          });
          const durationMs = deps.now() - startedAt;
          lastFiredAt.set(duty.id, tickAt);
          dutiesExecuted += 1;
          dutyTelemetry.push({
            dutyId: duty.id,
            cadence: duty.cadence,
            tickedAt: tickAt,
            outcome: 'ok',
            durationMs,
          });
        } catch (error) {
          const durationMs = deps.now() - startedAt;
          dutiesFailed += 1;
          dutyTelemetry.push({
            dutyId: duty.id,
            cadence: duty.cadence,
            tickedAt: tickAt,
            outcome: 'error',
            durationMs,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          });
          // Still advance lastFiredAt so one failure does not spin-loop.
          lastFiredAt.set(duty.id, tickAt);
        }
      }

      const result: HeartbeatTickResult = {
        tickAt,
        juniorsPutToSleep,
        juniorsKeptAwake,
        llmHealthy,
        ledgersRolled,
        memorySweeps,
        dutyTelemetry,
        dutiesExecuted,
        dutiesFailed,
      };

      if (deps.telemetry) {
        try {
          deps.telemetry(result);
        } catch {
          // Telemetry must never crash the tick.
        }
      }

      return result;
    },
  };
}
