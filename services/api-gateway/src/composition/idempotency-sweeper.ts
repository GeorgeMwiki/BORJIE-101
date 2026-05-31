/**
 * Idempotency-keys sweeper — deletes rows past `expires_at`.
 *
 * Companion to:
 *   - packages/database/src/migrations/0154_idempotency_keys.sql
 *   - services/api-gateway/src/middleware/db-idempotency.middleware.ts
 *
 * The middleware INSERTs every dedup record with a 24h TTL (default).
 * Without a sweeper the table grows monotonically — which is fine for
 * uniqueness (the partial unique index still rejects collisions) but
 * pads the catalog. This cron deletes expired rows in batches so the
 * working set stays small.
 *
 * Run cadence: hourly. Each sweep deletes up to BATCH_LIMIT rows; if
 * the table is huge after an outage the cron self-iterates next hour
 * until it catches up.
 */

import { lt, sql } from 'drizzle-orm';

import { createDatabaseClient, idempotencyKeys } from '@borjie/database';
import { createLogger } from '../utils/logger';

// Locally-derived alias to avoid TS2709 namespace drift.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const log = createLogger('idempotency-sweeper');

const BATCH_LIMIT = 10_000;

export interface IdempotencySweeperDeps {
  readonly db: DatabaseClient;
}

export interface SweepOutcome {
  readonly deleted: number;
  readonly tookMs: number;
}

/**
 * Delete expired idempotency rows. Returns the count of rows removed.
 * Tenant scope is NOT bound for the sweeper — it operates with
 * service-account auth (no JWT). The route never calls this; only the
 * scheduled cron does.
 */
export async function sweepExpiredIdempotencyKeys(
  deps: IdempotencySweeperDeps,
): Promise<SweepOutcome> {
  const t0 = Date.now();
  const result = await deps.db.execute(sql`
    WITH victims AS (
      SELECT id FROM ${idempotencyKeys}
      WHERE expires_at < now()
      LIMIT ${BATCH_LIMIT}
    )
    DELETE FROM ${idempotencyKeys}
    USING victims
    WHERE ${idempotencyKeys}.id = victims.id
  `);
  const deleted =
    (result as unknown as { count?: number }).count ??
    (Array.isArray(result) ? result.length : 0);
  const tookMs = Date.now() - t0;
  log.info('idempotency-sweeper: sweep complete', { deleted, tookMs });
  return { deleted, tookMs };
}

/** Hourly cron wrapper. Caller owns the schedule registration. */
export function registerIdempotencySweeperCron(
  deps: IdempotencySweeperDeps,
): () => void {
  const intervalMs = 60 * 60 * 1000;
  const handle = setInterval(() => {
    void sweepExpiredIdempotencyKeys(deps).catch((err: unknown) => {
      log.error('idempotency-sweeper: sweep threw', {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);
  if (typeof (handle as unknown as { unref?: () => void }).unref === 'function') {
    (handle as unknown as { unref: () => void }).unref();
  }
  return () => clearInterval(handle);
}

export async function expireIdempotencyRowsForTest(
  deps: IdempotencySweeperDeps,
  cutoff: Date,
): Promise<void> {
  await deps.db
    .update(idempotencyKeys)
    .set({ expiresAt: cutoff })
    .where(lt(idempotencyKeys.createdAt, new Date(cutoff.getTime() + 60_000)));
}
