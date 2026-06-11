/**
 * createDrizzleSetPointStateStore — the durable `SetPointStateStore` port
 * (Wave-C C3 WIN-4: closed-loop set-point regulation memory).
 *
 * Round-trips the per-(tenant, driveId) regulation memory
 * (priorBreachSeverity + consecutiveWorseningTicks) through the DEDICATED
 * `set_point_state` table (migration 0330) so the EstateMind RECONCILE sweep's
 * delta-evaluator (reconcile-engine.ts: evaluateSetPointDelta) can compare last
 * tick's drive severity to this tick's and decide continuity-of-care.
 *
 * WHY A DEDICATED TABLE (NOT situational_model_entities): that table's `kind`
 * is a CLOSED enum (no `setpoint-state` member) AND it is the SAME store the
 * salience arena reads as its snapshot — a synthetic set-point entity would
 * both fail kind validation and pollute the arena. The set-point memory is its
 * own small organ.
 *
 * OUT-OF-BAND / RLS FORCE: the reconcile sweep runs with no request middleware
 * to bind the tenant GUC, so every read/write is wrapped in
 * `withServiceRoleContext` (the service-role-bypass policy on set_point_state
 * permits the system path while RLS FORCE isolates every request caller).
 * Every statement is ALSO explicitly tenant-scoped in SQL as defence in depth.
 *
 * FAIL-SAFE (hard rule): a store fault never throws on the hot path —
 * `read` degrades to `null` (treated as "first observation": the controller
 * still nudges) and `write` swallows + logs. No `console.*` (Pino shim only).
 * Immutable: the store never mutates a caller's object.
 */

import { and, eq, sql } from 'drizzle-orm';
import {
  withServiceRoleContext,
  setPointState,
  createDatabaseClient,
} from '@borjie/database';

import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type {
  SetPointState,
  SetPointStateStore,
} from './reconcile-engine.js';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace
// declaration when imported by name (TS2709). Derive the type locally from the
// factory return — the same pattern estate-mind-wiring.ts uses.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/** Clamp a stored numeric back into the [0,1] severity band. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Drizzle numeric columns surface as strings — coerce defensively. */
function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Build the durable set-point-state store over the `set_point_state` table.
 * Returns the `SetPointStateStore` port the reconcile engine consumes.
 */
export function createDrizzleSetPointStateStore(
  db: DatabaseClient,
  logger: PinoLikeLogger = createPinoLikeLogger('set-point-store'),
): SetPointStateStore {
  return {
    async read(
      tenantId: string,
      driveId: string,
    ): Promise<SetPointState | null> {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          const rows = await tx
            .select()
            .from(setPointState)
            .where(
              and(
                eq(setPointState.tenantId, tenantId),
                eq(setPointState.driveId, driveId),
              ),
            )
            .limit(1);
          const row = rows[0];
          if (!row) return null;
          return Object.freeze({
            priorBreachSeverity: clamp01(toNum(row.priorBreachSeverity)),
            consecutiveWorseningTicks: Math.max(
              0,
              Math.trunc(toNum(row.consecutiveWorseningTicks)),
            ),
          });
        });
      } catch (err) {
        // First-observation degrade: a read fault is treated as "no prior
        // tick" so the controller still nudges (never a hot-path throw).
        logger.warn(
          { tenantId, driveId, err: errMsg(err) },
          'set-point-store: read failed — degrading to null (first-observation)',
        );
        return null;
      }
    },

    async write(
      tenantId: string,
      driveId: string,
      next: SetPointState,
    ): Promise<void> {
      const priorBreachSeverity = clamp01(next.priorBreachSeverity);
      const consecutiveWorseningTicks = Math.max(
        0,
        Math.trunc(next.consecutiveWorseningTicks),
      );
      try {
        await withServiceRoleContext(db, async (tx) => {
          await tx
            .insert(setPointState)
            .values({
              tenantId,
              driveId,
              // Drizzle numeric inserts take a string.
              priorBreachSeverity: String(priorBreachSeverity),
              consecutiveWorseningTicks,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [setPointState.tenantId, setPointState.driveId],
              set: {
                priorBreachSeverity: String(priorBreachSeverity),
                consecutiveWorseningTicks,
                updatedAt: sql`now()`,
              },
            });
        });
      } catch (err) {
        // A write fault degrades the set-point arc to a no-op next tick (the
        // memory simply doesn't advance) — never a throw on the hot path.
        logger.warn(
          { tenantId, driveId, err: errMsg(err) },
          'set-point-store: write failed (swallowed — arc degrades to no-op)',
        );
      }
    },
  };
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
