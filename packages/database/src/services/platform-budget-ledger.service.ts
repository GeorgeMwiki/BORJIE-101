/**
 * Platform privacy-budget ledger — Drizzle/Postgres adapter for the
 * `PlatformBudgetLedger` port from `@borjie/graph-privacy`.
 *
 * Replaces the in-memory ledger so cohort DP-aggregator budget
 * consumption survives api-gateway restarts. The port itself is
 * duck-typed locally (see `PlatformBudgetLedgerShape`) so this
 * package does NOT compile-time-depend on `@borjie/graph-privacy`
 * — keep the shape in lock-step with
 * packages/graph-privacy/src/types.ts.
 *
 * Behaviour invariants (mirrors the in-memory ledger):
 *   1. Singleton row keyed `'singleton'` is created lazily with the
 *      configured totals. If the row already exists, totals on disk
 *      win (config drift goes through a separate admin tool, not a
 *      silent overwrite at boot).
 *   2. `reserve()` is atomic: SELECT … FOR UPDATE → check budget →
 *      UPDATE spent counters → INSERT audit row. A row that would
 *      exhaust the budget throws `PrivacyBudgetExhaustedError` (name-
 *      compatible with the upstream class) and the row is unchanged.
 *   3. `snapshot()` returns the on-disk totals. Initialises the row
 *      lazily so a first-call snapshot reflects the configured
 *      totals.
 */

import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  platformPrivacyBudget,
  platformPrivacyBudgetReservations,
} from '../schemas/platform-privacy-budget.schema.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Port surface — duck-typed copy of @borjie/graph-privacy's
// `PlatformBudgetLedger`. Keep in sync with
// packages/graph-privacy/src/types.ts.
// ─────────────────────────────────────────────────────────────────────

export interface PlatformBudgetLedgerShape {
  reserve(args: {
    readonly epsilon: number;
    readonly delta: number;
  }): Promise<{
    readonly remainingEpsilon: number;
    readonly remainingDelta: number;
  }>;
  snapshot(): Promise<{
    readonly totalEpsilon: number;
    readonly spentEpsilon: number;
    readonly totalDelta: number;
    readonly spentDelta: number;
  }>;
}

export interface PgBudgetLedgerDeps {
  readonly totalEpsilon: number;
  readonly totalDelta: number;
}

// ─────────────────────────────────────────────────────────────────────
// Locally-thrown error — name-compatible with
// `@borjie/graph-privacy`'s `PrivacyBudgetExhaustedError` so
// downstream `instanceof Error && err.name === '...'` checks match.
// ─────────────────────────────────────────────────────────────────────

export class PrivacyBudgetExhaustedError extends Error {
  override readonly name = 'PrivacyBudgetExhaustedError';
}

// ─────────────────────────────────────────────────────────────────────
// Internal: a transaction-capable client surface. Drizzle's postgres-js
// flavour exposes both `.transaction(cb)` and the same query builder
// inside the callback. We narrow to the surface we actually use so the
// service stays unit-testable without a full Drizzle mock.
// ─────────────────────────────────────────────────────────────────────

type TxClient = Pick<DatabaseClient, 'select' | 'insert' | 'update'>;

interface Transactional {
  transaction<T>(cb: (tx: TxClient) => Promise<T>): Promise<T>;
}

const SINGLETON_ID = 'singleton';

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createPgPlatformBudgetLedger(
  db: DatabaseClient,
  deps: PgBudgetLedgerDeps,
): PlatformBudgetLedgerShape {
  if (!Number.isFinite(deps.totalEpsilon) || deps.totalEpsilon <= 0) {
    throw new RangeError(
      'pg-budget-ledger: totalEpsilon must be a finite number > 0',
    );
  }
  if (!Number.isFinite(deps.totalDelta) || deps.totalDelta < 0) {
    throw new RangeError(
      'pg-budget-ledger: totalDelta must be a finite number ≥ 0',
    );
  }

  // Drizzle's generated insertable type drops nullable + default
  // columns when consumed across the package's compiled `dist/`
  // boundary, so the `.values({...})` literals would fail TypeScript
  // excess-property checks even though the runtime SQL is correct.
  // We narrow at the boundary with `as never`, mirroring the pattern
  // used in `kernel-substrate.service.ts`.
  return {
    async snapshot() {
      await ensureSingleton(db, deps);
      const rows = await db
        .select({
          totalEpsilon: platformPrivacyBudget.totalEpsilon,
          spentEpsilon: platformPrivacyBudget.spentEpsilon,
          totalDelta: platformPrivacyBudget.totalDelta,
          spentDelta: platformPrivacyBudget.spentDelta,
        })
        .from(platformPrivacyBudget)
        .where(eq(platformPrivacyBudget.id, SINGLETON_ID))
        .limit(1);
      const r = rows[0];
      if (!r) {
        // Row could not be initialised (extremely unlikely). Fall back
        // to deps so callers don't see undefined behaviour.
        return {
          totalEpsilon: deps.totalEpsilon,
          spentEpsilon: 0,
          totalDelta: deps.totalDelta,
          spentDelta: 0,
        };
      }
      return {
        totalEpsilon: Number(r.totalEpsilon),
        spentEpsilon: Number(r.spentEpsilon),
        totalDelta: Number(r.totalDelta),
        spentDelta: Number(r.spentDelta),
      };
    },

    async reserve(args) {
      if (!Number.isFinite(args.epsilon) || args.epsilon <= 0) {
        throw new RangeError(
          'pg-budget-ledger: reserve epsilon must be a finite number > 0',
        );
      }
      if (!Number.isFinite(args.delta) || args.delta < 0) {
        throw new RangeError(
          'pg-budget-ledger: reserve delta must be a finite number ≥ 0',
        );
      }

      await ensureSingleton(db, deps);

      // Drizzle's postgres-js client exposes `.transaction(cb)`. We
      // duck-type to `Transactional` so the service is testable with a
      // minimal mock that doesn't have to implement the full Drizzle
      // surface.
      const txCapable = db as unknown as Transactional;
      return txCapable.transaction(async (tx) => {
        const lockedRows = await tx
          .select({
            totalEpsilon: platformPrivacyBudget.totalEpsilon,
            spentEpsilon: platformPrivacyBudget.spentEpsilon,
            totalDelta: platformPrivacyBudget.totalDelta,
            spentDelta: platformPrivacyBudget.spentDelta,
          })
          .from(platformPrivacyBudget)
          .where(eq(platformPrivacyBudget.id, SINGLETON_ID))
          // Acquire a row-level lock so concurrent reserves serialise
          // through Postgres rather than racing on stale spent values.
          .for('update')
          .limit(1);

        const r = lockedRows[0];
        const totalEpsilon = Number(r?.totalEpsilon ?? deps.totalEpsilon);
        const totalDelta = Number(r?.totalDelta ?? deps.totalDelta);
        const spentEpsilon = Number(r?.spentEpsilon ?? 0);
        const spentDelta = Number(r?.spentDelta ?? 0);

        const nextSpentEpsilon = spentEpsilon + args.epsilon;
        const nextSpentDelta = spentDelta + args.delta;

        if (nextSpentEpsilon > totalEpsilon) {
          throw new PrivacyBudgetExhaustedError(
            `platform privacy budget exhausted: spent=${spentEpsilon.toFixed(4)}, ` +
              `would-spend-after=${nextSpentEpsilon.toFixed(4)}, ` +
              `total=${totalEpsilon.toFixed(4)}`,
          );
        }
        if (nextSpentDelta > totalDelta) {
          throw new PrivacyBudgetExhaustedError(
            `platform delta budget exhausted: spent=${spentDelta.toExponential(3)}, ` +
              `would-spend-after=${nextSpentDelta.toExponential(3)}, ` +
              `total=${totalDelta.toExponential(3)}`,
          );
        }

        await tx
          .update(platformPrivacyBudget)
          .set({
            spentEpsilon: nextSpentEpsilon,
            spentDelta: nextSpentDelta,
            updatedAt: new Date(),
          } as never)
          .where(eq(platformPrivacyBudget.id, SINGLETON_ID));

        await tx
          .insert(platformPrivacyBudgetReservations)
          .values({
            id: randomUUID(),
            epsilon: args.epsilon,
            delta: args.delta,
            reservedAt: new Date(),
          } as never);

        return {
          remainingEpsilon: totalEpsilon - nextSpentEpsilon,
          remainingDelta: totalDelta - nextSpentDelta,
        };
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Insert the singleton row if it doesn't exist. ON CONFLICT DO
 * NOTHING so concurrent boots don't race; if the row already exists
 * with different totals we keep what's on disk (config drift is an
 * admin-tool concern, not a silent boot-time overwrite).
 */
async function ensureSingleton(
  db: DatabaseClient,
  deps: PgBudgetLedgerDeps,
): Promise<void> {
  await db
    .insert(platformPrivacyBudget)
    .values({
      id: SINGLETON_ID,
      totalEpsilon: deps.totalEpsilon,
      spentEpsilon: 0,
      totalDelta: deps.totalDelta,
      spentDelta: 0,
      updatedAt: new Date(),
    } as never)
    .onConflictDoNothing({ target: platformPrivacyBudget.id });
  // `sql` import kept for potential future expressions (e.g. atomic
  // UPDATE … SET spent = spent + $1). Reference once so unused-import
  // checks stay quiet without removing the symbol availability.
  void sql;
}
