/**
 * oauth-state-nonce-store — DURABLE single-use consumption of connector-OAuth
 * `state` nonces (migration 0343_oauth_state_nonces.sql).
 *
 * WHY: the v1 replay guard (`createOAuthStateReplayGuard` in
 * connector-oauth-descriptors.ts) consumes nonces in a bounded IN-PROCESS map
 * — explicitly documented as safe only for a single-instance deployment. The
 * Helm chart autoscales api-gateway to minReplicas 2-3, so a captured `state`
 * could be replayed against a replica that never saw the first consumption
 * (inside the 10-minute signature TTL). This store is the CLUSTER-WIDE
 * AUTHORITY: consumption is one atomic
 * `INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce` — exactly one
 * replica ever gets a row back; every replay (any replica) gets 0 rows. The
 * in-process guard stays as a cheap same-process fast-path; the DB decides.
 *
 * The same consume statement purges rows older than 15 minutes (the state
 * signature TTL is 10) so the table self-cleans without a dedicated sweeper.
 *
 * SECURITY RAILS:
 *   - The RLS GUC (`app.current_tenant_id`) is bound from the VERIFIED state
 *     inside the consume transaction (SET LOCAL semantics) — identical to the
 *     adjacent `connector_credentials` write in connectors-oauth.hono.ts, so
 *     FORCE-RLS applies to the insert AND the purge (which therefore only
 *     sweeps the calling tenant's expired rows — other tenants' rows are
 *     swept by their own callbacks or the service-role ops path).
 *   - FAIL-CLOSED: an infra fault resolves `'failed'` (never throws) and the
 *     caller REJECTS the callback — a broken replay ledger must never let a
 *     possibly-replayed state through to the code exchange.
 *   - Nonces are opaque random values — no PII, no token material, loggable.
 */

import { sql } from 'drizzle-orm';

import { createLogger } from '../utils/logger';

const logger = createLogger('oauth-state-nonce-store');

/** Purge horizon — comfortably beyond the 10-minute state signature TTL. */
export const OAUTH_STATE_NONCE_RETENTION_MINUTES = 15;

/**
 * Outcome of a durable consume attempt:
 *   - 'consumed' → first durable consumption cluster-wide; proceed.
 *   - 'replayed' → the nonce row already exists (another replica — or an
 *     earlier request on this one — consumed it). REJECT: STATE_ALREADY_USED.
 *   - 'failed'   → the ledger was unreachable / the statement faulted.
 *     REJECT (fail-closed): we cannot prove this is the first use.
 */
export type DurableNonceConsumeOutcome = 'consumed' | 'replayed' | 'failed';

/**
 * Narrow structural db seam — the SAME `transaction(cb)` boundary the
 * connectors-oauth route already holds (`OAuthDb`). Kept structural so this
 * module never imports the pool client and tests inject a recording fake.
 */
export interface OAuthNonceDb {
  transaction<T>(
    cb: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>,
  ): Promise<T>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

/**
 * Atomically consume `nonce` in Postgres. Resolves 'consumed' exactly once
 * per nonce cluster-wide; 'replayed' on every subsequent attempt; 'failed'
 * on any infra fault (NEVER throws — the caller maps 'failed' to a
 * fail-closed rejection).
 *
 * The purge of stale rows (older than the 15-minute retention horizon) rides
 * in the same statement as a data-modifying CTE so consumption keeps the
 * table bounded with zero extra round-trips. Note the snapshot semantics: a
 * same-statement re-insert of a just-purged nonce still conflicts (the
 * deletion is not visible to the INSERT's arbiter) — harmless, because any
 * nonce old enough to purge failed the signature TTL long before reaching
 * this store.
 */
export async function consumeOAuthStateNonceDurably(
  db: OAuthNonceDb,
  args: {
    readonly nonce: string;
    readonly tenantId: string;
    readonly connectorId: string;
    readonly expMs: number;
  },
): Promise<DurableNonceConsumeOutcome> {
  try {
    const inserted = await db.transaction(async (tx) => {
      // Bind the RLS GUC from the VERIFIED state (SET LOCAL semantics) so
      // FORCE-RLS admits the insert + scopes the purge — mirroring the
      // credential upsert in connectors-oauth.hono.ts exactly.
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${args.tenantId}, true)`,
      );
      const result = await tx.execute(sql`
        WITH purge AS (
          DELETE FROM oauth_state_nonces
          WHERE created_at < now() - make_interval(mins => ${OAUTH_STATE_NONCE_RETENTION_MINUTES})
        )
        INSERT INTO oauth_state_nonces (nonce, tenant_id, connector_id, expires_at)
        VALUES (${args.nonce}, ${args.tenantId}, ${args.connectorId}, ${new Date(args.expMs)})
        ON CONFLICT (nonce) DO NOTHING
        RETURNING nonce
      `);
      return rowsOf(result).length > 0;
    });
    return inserted ? 'consumed' : 'replayed';
  } catch (err) {
    // FAIL-CLOSED at the caller: we could not prove first-use, so the
    // callback must reject. Log the raw cause server-side (nonce is opaque
    // random material — safe to log; no token ever reaches this module).
    logger.error('oauth-state-nonce-store: durable consume faulted (fail-closed)', {
      tenantId: args.tenantId,
      connectorId: args.connectorId,
      err: err instanceof Error ? err.message : String(err),
    });
    return 'failed';
  }
}
