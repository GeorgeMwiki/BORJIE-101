/**
 * Production-shaped {@link SleepRunStore} backed by the `brain_sleep_runs` +
 * `brain_sleep_emissions` tables (migration 0276) — LP-21a.
 *
 * The orchestrator service deliberately does NOT take a hard dependency on
 * `@borjie/database` (it stays a thin, independently-deployable pod). Instead
 * this adapter is parameterised over a minimal `SleepRunDbClient` port that
 * the api-gateway composition root satisfies with the real Drizzle client +
 * `withServiceRoleContext` (these are SYSTEM rows — no per-tenant GUC).
 *
 * Resilience: every method swallows its own errors and logs via the injected
 * Pino logger. A persistence failure must NEVER crash the tick — passes still
 * run; we only lose the audit row. This matches the LITFIN `sleep-tick.ts`
 * best-effort persistence contract.
 *
 * Single-flight + stale-row rescue (ported from LITFIN SLEEP-LOCK/SLEEP-RESCUE,
 * HIGH iter-24):
 *   - `beginRun` first looks for a `running` row for the same pass. If found
 *     and OLDER than `rescueAgeMs`, it is reaped to `failed` ("presumed
 *     crash") and a fresh row is inserted. If found and still FRESH, another
 *     worker is legitimately in flight → return null (skip this tick).
 *
 * @module drizzle-sleep-run-store
 */

import type {
  IsoTimestamp,
  PassId,
  SleepEmission,
  SleepRunFinalize,
  SleepRunStore,
} from './types.js';

/** A `brain_sleep_runs` row as the store needs to read it. */
export interface SleepRunDbRow {
  readonly id: string;
  readonly startedAt: IsoTimestamp;
  readonly status: string;
}

/**
 * Minimal persistence port the production composition root satisfies with a
 * Drizzle client. Kept intentionally tiny so the orchestrator pod never has
 * to import the database package.
 */
export interface SleepRunDbClient {
  /** Freshest `running` row for a pass, or null. */
  findRunningRun(passId: PassId): Promise<SleepRunDbRow | null>;
  /** Flip a row to `failed` with a crash note (stale-row rescue). */
  reapStuckRun(runId: string, errorText: string): Promise<void>;
  /** Insert a `running` row; returns its uuid. */
  insertRunningRun(passId: PassId): Promise<string>;
  /** Bulk-insert emission rows. */
  insertEmissions(
    runId: string,
    emissions: ReadonlyArray<{ kind: string; payload: unknown }>,
  ): Promise<void>;
  /** Update a row to its terminal status. */
  updateRun(runId: string, fin: SleepRunFinalize): Promise<void>;
  /** Freshest `started_at` for a pass (drives min-interval skip). */
  latestStartedAt(passId: PassId): Promise<IsoTimestamp | null>;
}

/** Minimal logger port (the service's Pino wrapper satisfies this). */
export interface SleepRunStoreLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface DrizzleSleepRunStoreOpts {
  readonly client: SleepRunDbClient;
  readonly logger: SleepRunStoreLogger;
  /** Stale-row rescue window. Default 30 min — above any single pass budget. */
  readonly rescueAgeMs?: number;
  /** Monotonic clock injection for tests. */
  readonly nowMs?: () => number;
}

const DEFAULT_RESCUE_AGE_MS = 30 * 60 * 1000;

/**
 * Build a durable {@link SleepRunStore} over an injected DB client.
 */
export function createDrizzleSleepRunStore(
  opts: DrizzleSleepRunStoreOpts,
): SleepRunStore {
  const { client, logger } = opts;
  const rescueAgeMs = opts.rescueAgeMs ?? DEFAULT_RESCUE_AGE_MS;
  const nowMs = opts.nowMs ?? (() => Date.now());

  return {
    async beginRun(passId: PassId): Promise<string | null> {
      try {
        const stuck = await client.findRunningRun(passId);
        if (stuck) {
          const ageMs = nowMs() - Date.parse(stuck.startedAt);
          if (ageMs > rescueAgeMs) {
            await client.reapStuckRun(
              stuck.id,
              `presumed crash — 'running' for ${Math.round(
                ageMs / 60000,
              )}min, exceeded ${rescueAgeMs / 60000}min budget`,
            );
            // fall through to insert a fresh row
          } else {
            logger.warn(
              '[sleep-tick] concurrent run detected; skipping this tick',
              { passId, ageSec: Math.round(ageMs / 1000) },
            );
            return null;
          }
        }
        return await client.insertRunningRun(passId);
      } catch (err) {
        logger.error('[sleep-tick] beginRun failed', {
          passId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async recordEmissions(
      runId: string | null,
      emissions: ReadonlyArray<SleepEmission>,
    ): Promise<void> {
      if (!runId || emissions.length === 0) return;
      try {
        await client.insertEmissions(
          runId,
          emissions.map((e) => ({ kind: e.kind, payload: e.payload })),
        );
      } catch (err) {
        logger.error('[sleep-tick] recordEmissions failed', {
          runId,
          count: emissions.length,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async finalizeRun(
      runId: string | null,
      fin: SleepRunFinalize,
    ): Promise<void> {
      if (!runId) return;
      try {
        await client.updateRun(runId, fin);
      } catch (err) {
        logger.error('[sleep-tick] finalizeRun failed', {
          runId,
          status: fin.status,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async lastRunAt(passId: PassId): Promise<IsoTimestamp | null> {
      try {
        return await client.latestStartedAt(passId);
      } catch (err) {
        logger.warn('[sleep-tick] lastRunAt failed; treating as never-run', {
          passId,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  };
}
