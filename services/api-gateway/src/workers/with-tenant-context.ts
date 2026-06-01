/**
 * Worker tenant-context helper — G8 robustness audit closure
 * (2026-05-29), hardened 2026-06-01 to actually PIN the connection.
 *
 * Workers bypass api-gateway's `databaseMiddleware`, so the pooled connection
 * carries NO `app.current_tenant_id` GUC; every tenant-scoped statement must
 * bind it itself.
 *
 * This delegates to `withTenantContext` from `@borjie/database`, which opens
 * a real Drizzle transaction (postgres.js `.begin()` — which PINS one
 * connection for the transaction) and binds `app.current_tenant_id` +
 * `app.tenant_id` + `app.is_service_role` via `SET LOCAL`. The body receives
 * the pinned `tx` and MUST run all its DB calls through THAT handle (not the
 * outer pooled `db`), so every statement lands on the connection carrying the
 * tenant GUC.
 *
 * Why this replaced the previous implementation: it used to issue raw
 * `BEGIN` / `SET LOCAL` / `COMMIT` as SEPARATE `db.execute()` calls. On a
 * pooled postgres.js client that does NOT pin — each statement checks out a
 * different connection, so the `SET LOCAL` ran outside any transaction (a
 * no-op) and the tenant GUC was never actually applied; a dangling
 * transaction could even be left on the pool. It only appeared to work
 * because the workers connect via the Supabase `service_role` (BYPASSRLS),
 * which sidesteps RLS at the role level. Delegating to the transaction-based
 * helper makes the binding real — verified leak-free under interleaved
 * concurrent load (see
 * `services/api-gateway/src/__tests__/with-tenant-context-pinning.test.ts`).
 *
 * Pure — no logging, no side effects beyond the SQL block. The caller decides
 * how to handle thrown errors. A test double whose `db` cannot open a
 * transaction is run directly by `withTenantContext` (unit-stub affordance).
 */

import { withTenantContext } from '@borjie/database';

export interface TenantContextDbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Bind the tenant + legacy GUCs in a short transaction (pinned connection)
 * and run `body(tx)` inside it. `body` MUST issue its DB calls through the
 * supplied `tx` so they share the connection carrying the GUC.
 *
 * `tenantId` must be non-empty; an empty string is a programmer error (RLS
 * would otherwise silently zero rows downstream — fail loud instead).
 */
export async function withWorkerTenantContext<T>(
  db: TenantContextDbLike,
  tenantId: string,
  body: (tx: TenantContextDbLike) => Promise<T>,
): Promise<T> {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('withWorkerTenantContext: tenantId must be non-empty');
  }
  return withTenantContext(
    db as unknown as Parameters<typeof withTenantContext>[0],
    tenantId,
    (tx) => body(tx as unknown as TenantContextDbLike),
  );
}
