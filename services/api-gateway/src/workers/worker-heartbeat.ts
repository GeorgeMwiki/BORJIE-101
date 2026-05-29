/**
 * worker-heartbeat — G6 robustness-audit closure (2026-05-29).
 *
 * Closes audit gap G6 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`.
 *
 * Tracks the last-tick timestamp + cumulative tick count for every
 * cron worker so /health/deep can surface stuck workers without
 * operators having to grep logs. A worker that hasn't ticked in
 * `2 * intervalMs` lights up the deep-health probe as `degraded`.
 *
 * Pure in-process state — each gateway replica tracks its own
 * workers (workers are pinned to the replica that scheduled them).
 * Reading the registry from /health/deep on the SAME replica gives
 * the operator an accurate "is this replica's worker still ticking"
 * answer.
 *
 * Usage from a worker:
 *
 *   registerWorker({
 *     name: 'outcome-reconciliation',
 *     intervalMs: 6 * 60 * 60 * 1000,
 *   });
 *   …
 *   workerHeartbeat('outcome-reconciliation');  // call inside tickOnce
 *
 * The first registration may happen at worker construction; the
 * heartbeat fires inside every successful tick (and ideally inside
 * the catch as well so a thrown tick still surfaces). Registration is
 * idempotent — re-registering the same name updates intervalMs.
 */

interface WorkerHeartbeatEntry {
  readonly name: string;
  intervalMs: number;
  registeredAt: number;
  lastTickAt: number | null;
  tickCount: number;
  lastError: string | null;
}

const registry = new Map<string, WorkerHeartbeatEntry>();

export interface RegisterWorkerInput {
  readonly name: string;
  readonly intervalMs: number;
}

/**
 * Register (or re-register) a worker. Idempotent — calling with the
 * same name updates the recorded `intervalMs` (useful when an env
 * override re-tunes the cron at construction time).
 */
export function registerWorker(input: RegisterWorkerInput): void {
  const existing = registry.get(input.name);
  if (existing) {
    existing.intervalMs = input.intervalMs;
    return;
  }
  registry.set(input.name, {
    name: input.name,
    intervalMs: input.intervalMs,
    registeredAt: Date.now(),
    lastTickAt: null,
    tickCount: 0,
    lastError: null,
  });
}

/**
 * Record a successful tick. Workers should call this exactly once per
 * tick, regardless of how many rows the tick processed.
 */
export function workerHeartbeat(name: string): void {
  const entry = registry.get(name);
  if (!entry) {
    // Defensive: if a worker forgot to register, auto-register with a
    // 60s default so it still surfaces on /health/deep. Operators can
    // see "this worker is ticking but never declared an interval".
    registry.set(name, {
      name,
      intervalMs: 60_000,
      registeredAt: Date.now(),
      lastTickAt: Date.now(),
      tickCount: 1,
      lastError: null,
    });
    return;
  }
  entry.lastTickAt = Date.now();
  entry.tickCount += 1;
  entry.lastError = null;
}

/**
 * Record a tick failure. Stores the error message so /health/deep can
 * surface it; the tickCount still increments so operators can tell
 * "the worker IS running, just failing" apart from "stuck".
 */
export function workerHeartbeatFailure(name: string, err: unknown): void {
  const entry = registry.get(name);
  const msg = err instanceof Error ? err.message : String(err);
  if (!entry) {
    registry.set(name, {
      name,
      intervalMs: 60_000,
      registeredAt: Date.now(),
      lastTickAt: Date.now(),
      tickCount: 1,
      lastError: msg,
    });
    return;
  }
  entry.lastTickAt = Date.now();
  entry.tickCount += 1;
  entry.lastError = msg;
}

export interface WorkerHeartbeatSnapshot {
  readonly name: string;
  readonly intervalMs: number;
  readonly registeredAt: string;
  readonly lastTickAt: string | null;
  readonly tickCount: number;
  readonly lastError: string | null;
  /**
   * Wall-clock ms since `lastTickAt`. `null` when the worker has
   * never ticked yet — most useful in the boot-stall scenario.
   */
  readonly msSinceLastTick: number | null;
  /**
   * `true` when the worker hasn't ticked in `2 * intervalMs`. The
   * 2x factor gives some slack for tick scheduling jitter without
   * silencing genuinely stuck workers.
   */
  readonly stuck: boolean;
}

/**
 * Capture a snapshot of every registered worker. Pure read — no
 * mutation. Use this from /health/deep + ops dashboards.
 */
export function snapshotWorkers(now: number = Date.now()): ReadonlyArray<WorkerHeartbeatSnapshot> {
  const out: WorkerHeartbeatSnapshot[] = [];
  for (const entry of registry.values()) {
    const msSinceLastTick =
      entry.lastTickAt !== null ? now - entry.lastTickAt : null;
    // First-tick grace: a freshly registered worker hasn't been
    // expected to tick yet, so we don't flag it stuck until the
    // first scheduled interval has elapsed since registration.
    const sinceRegistration = now - entry.registeredAt;
    const isStuck =
      entry.lastTickAt === null
        ? sinceRegistration > 2 * entry.intervalMs
        : msSinceLastTick! > 2 * entry.intervalMs;
    out.push({
      name: entry.name,
      intervalMs: entry.intervalMs,
      registeredAt: new Date(entry.registeredAt).toISOString(),
      lastTickAt:
        entry.lastTickAt !== null
          ? new Date(entry.lastTickAt).toISOString()
          : null,
      tickCount: entry.tickCount,
      lastError: entry.lastError,
      msSinceLastTick,
      stuck: isStuck,
    });
  }
  return out;
}

/** Test-only: reset the in-process registry between tests. */
export function __resetWorkerHeartbeatRegistry(): void {
  registry.clear();
}
