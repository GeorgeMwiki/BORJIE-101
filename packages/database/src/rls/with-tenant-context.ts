/**
 * RLS session-context helper.
 *
 * Wraps a database callback in a transaction that has the
 * `app.current_tenant_id` GUC bound to the supplied tenant id. Every
 * tenant-scoped table has an RLS policy of the shape
 *   tenant_id = current_setting('app.current_tenant_id', true)
 * so any query the callback runs is automatically filtered.
 *
 * Optional `opts.serviceRole = true` also sets `app.is_service_role`
 * to `'true'`. The companion 0179 migration installs a
 * `service_role_bypass` policy on every tenant-scoped table that
 * returns `true` when that GUC is set, so system jobs that legitimately
 * span tenants can opt-in without touching individual repository
 * queries.
 *
 * Both settings use `set_config(..., true)` — the `true` third
 * argument scopes the binding to the current transaction, so the
 * GUC cannot leak across requests on a pooled connection.
 */

import { sql } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';

export interface WithTenantContextOpts {
  /** Set when the caller legitimately needs cross-tenant access. */
  readonly serviceRole?: boolean;
}

/**
 * Bind the per-request tenant + service-role GUCs and run `fn` inside
 * the same transaction so postgres-js executes everything on one
 * checked-out connection.
 *
 * The callback receives the same `db` handle it would have used
 * outside the wrapper; no API change is required at the call site.
 */
export async function withTenantContext<T>(
  db: DatabaseClient,
  tenantId: string,
  fn: (tx: DatabaseClient) => Promise<T>,
  opts?: WithTenantContextOpts,
): Promise<T> {
  if (!tenantId) {
    throw new Error('withTenantContext requires a non-empty tenantId');
  }
  const isService = opts?.serviceRole ?? false;

  // drizzle-orm/postgres-js transactions hand back a `tx` object that
  // is compatible enough with the outer `db` for repository code —
  // the cast preserves the existing type surface for callers.
  return await db.transaction(async (tx) => {
    // Bind the per-tx tenant id. The `true` third arg of `set_config`
    // scopes it to the transaction.
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    // Mirror the legacy `app.tenant_id` GUC for migrations (0146, 0156
    // helper) that still read the older name.
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.is_service_role', ${isService ? 'true' : 'false'}, true)`,
    );
    return await fn(tx as DatabaseClient);
  });
}

/**
 * Service-role variant — sugar for the common cross-tenant system-job
 * call site. Equivalent to `withTenantContext(db, '__system__',
 * fn, { serviceRole: true })`.
 *
 * The placeholder tenant id `__system__` is used so the GUC is never
 * empty (avoids accidental `tenant_id IS NULL` matches). The
 * service-role bypass policy short-circuits before the tenant predicate
 * fires, so the placeholder is never evaluated against real rows.
 */
export async function withServiceRoleContext<T>(
  db: DatabaseClient,
  fn: (tx: DatabaseClient) => Promise<T>,
): Promise<T> {
  return await withTenantContext(db, '__system__', fn, { serviceRole: true });
}
