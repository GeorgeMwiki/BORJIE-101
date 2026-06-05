/**
 * In-memory {@link SleepRunStore} — the fallback the standalone pod uses when
 * no DB client is configured (LP-21).
 *
 * The Drizzle-backed {@link createDrizzleSleepRunStore} is the production path
 * (persists `brain_sleep_runs` / `brain_sleep_emissions`). When the pod boots
 * without a reachable DB — local dev, an isolated unit test, a smoke env with
 * no `DATABASE_URL` — this store keeps the EXACT same `SleepRunStore`
 * contract so `runSleepTick` behaves identically: single-flight skip on a
 * fresh `running` row, stale-row rescue ("presumed crash") past the rescue
 * window, and a durable-enough `lastRunAt` for min-interval skipping. The only
 * difference is durability: a process restart loses the in-memory history.
 *
 * State is held immutably — each mutation produces a new map — so there is no
 * aliasing of the internal run records.
 *
 * @module in-memory-sleep-run-store
 */

import type {
  IsoTimestamp,
  PassId,
  SleepEmission,
  SleepRunFinalize,
  SleepRunStatus,
  SleepRunStore,
} from './types.js';

interface InMemoryRun {
  readonly id: string;
  readonly passId: PassId;
  readonly status: SleepRunStatus;
  readonly startedAtMs: number;
  readonly emissions: ReadonlyArray<SleepEmission>;
}

export interface InMemorySleepRunStoreOpts {
  /** Stale-row rescue window. Default 30 min — above any single pass budget. */
  readonly rescueAgeMs?: number;
  /** Monotonic clock injection for tests. */
  readonly nowMs?: () => number;
}

const DEFAULT_RESCUE_AGE_MS = 30 * 60 * 1000;

/**
 * Build an in-memory {@link SleepRunStore}. Mirrors the durable store's
 * single-flight + rescue semantics so swapping stores never changes tick
 * behaviour — only whether the audit trail survives a restart.
 */
export function createInMemorySleepRunStore(
  opts: InMemorySleepRunStoreOpts = {},
): SleepRunStore {
  const rescueAgeMs = opts.rescueAgeMs ?? DEFAULT_RESCUE_AGE_MS;
  const nowMs = opts.nowMs ?? (() => Date.now());

  // Immutable map of runId → run record. Reassigned (never mutated) on write.
  let runs: ReadonlyMap<string, InMemoryRun> = new Map();
  let seq = 0;

  const freshestForPass = (passId: PassId): InMemoryRun | null => {
    let latest: InMemoryRun | null = null;
    for (const run of runs.values()) {
      if (run.passId !== passId) continue;
      if (latest === null || run.startedAtMs > latest.startedAtMs) {
        latest = run;
      }
    }
    return latest;
  };

  const put = (run: InMemoryRun): void => {
    const next = new Map(runs);
    next.set(run.id, run);
    runs = next;
  };

  return {
    async beginRun(passId: PassId): Promise<string | null> {
      const now = nowMs();
      // Single-flight: a still-fresh `running` row means another worker (or a
      // prior overlapping tick) is legitimately in flight → skip this tick.
      // A stale `running` row is reaped to `failed` (presumed crash) first.
      for (const run of runs.values()) {
        if (run.passId !== passId || run.status !== 'running') continue;
        const ageMs = now - run.startedAtMs;
        if (ageMs > rescueAgeMs) {
          put({ ...run, status: 'failed' });
        } else {
          return null;
        }
      }
      seq += 1;
      const id = `mem-run-${seq}`;
      put({
        id,
        passId,
        status: 'running',
        startedAtMs: now,
        emissions: [],
      });
      return id;
    },

    async recordEmissions(
      runId: string | null,
      emissions: ReadonlyArray<SleepEmission>,
    ): Promise<void> {
      if (!runId || emissions.length === 0) return;
      const run = runs.get(runId);
      if (!run) return;
      put({ ...run, emissions: [...run.emissions, ...emissions] });
    },

    async finalizeRun(
      runId: string | null,
      fin: SleepRunFinalize,
    ): Promise<void> {
      if (!runId) return;
      const run = runs.get(runId);
      if (!run) return;
      put({ ...run, status: fin.status });
    },

    async lastRunAt(passId: PassId): Promise<IsoTimestamp | null> {
      const latest = freshestForPass(passId);
      return latest ? new Date(latest.startedAtMs).toISOString() : null;
    },
  };
}
