/**
 * Worker tenant-context helper — G8 robustness audit closure
 * (2026-05-29).
 *
 * Closes audit gap G8 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`:
 *
 *   Before: workers called
 *     SELECT set_config('app.current_tenant_id', $1, false)
 *     -- next query --
 *     INSERT INTO ai_audit_chain ...
 *
 *   Problem: postgres.js executes one statement per call on a
 *   checked-out connection. With `false` (session-scoped), the GUC
 *   persists on the connection AFTER the worker query returns. If
 *   Supabase reaps the connection between the set_config and the
 *   INSERT, OR returns it to the pool and a subsequent request grabs
 *   it before the next set_config overwrites the binding, queries can
 *   run with the wrong tenant context (other tenant's data, or NULL
 *   → empty result via RLS).
 *
 *   Fix: wrap every tenant-scoped block in BEGIN/COMMIT so the GUC
 *   binding is transaction-local (via `SET LOCAL`). The DB driver
 *   keeps the same connection for the duration of the txn; if the
 *   connection drops mid-tick the entire txn rolls back and the GUC
 *   binding dies with it. There is no window where a downstream query
 *   sees stale GUC state.
 *
 * This helper mirrors the pattern already used by
 *   `packages/database/src/rls/with-tenant-context.ts`
 * but adapted to the worker DbLike interface (raw `execute(q)`) so
 * workers don't need to lift to the full DatabaseClient surface.
 *
 * Both legacy (`app.tenant_id`) and canonical (`app.current_tenant_id`)
 * GUC names are bound so RLS policies on either migration generation
 * accept the call. Mirrors `services/api-gateway/src/middleware/database.ts`.
 *
 * Pure — no logging, no side effects beyond the SQL block. Caller
 * decides how to handle thrown errors.
 */

import { sql } from 'drizzle-orm';

export interface TenantContextDbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Wraps `body` in `BEGIN; SET LOCAL app.{current_tenant_id,tenant_id} = $1;
 * <body>; COMMIT;`. On any throw the txn is rolled back and the error
 * re-thrown. The GUC binding is transaction-scoped — it cannot leak
 * onto the pooled connection.
 *
 * `body` MUST run all its DB calls through the SAME `db` handle so
 * postgres.js keeps every statement on the txn-owned connection.
 *
 * `tenantId` must be non-empty; empty strings are rejected as a
 * programmer error (the SET LOCAL would still execute but RLS would
 * silently zero rows downstream — fail loud instead).
 */
export async function withWorkerTenantContext<T>(
  db: TenantContextDbLike,
  tenantId: string,
  body: () => Promise<T>,
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('withWorkerTenantContext: tenantId must be non-empty');
  }
  await db.execute(sql`BEGIN`);
  try {
    // SET LOCAL scopes the GUC to the current transaction; the second
    // SET LOCAL covers policies installed before migration 0172 that
    // still read the legacy `app.tenant_id` name. Both die at COMMIT
    // / ROLLBACK, so no leak onto the pooled connection is possible.
    await db.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true),
                  set_config('app.tenant_id', ${tenantId}, true)`,
    );
    const result = await body();
    await db.execute(sql`COMMIT`);
    return result;
  } catch (err) {
    try {
      await db.execute(sql`ROLLBACK`);
    } catch {
      // Ignore — original error takes precedence.
    }
    throw err;
  }
}
