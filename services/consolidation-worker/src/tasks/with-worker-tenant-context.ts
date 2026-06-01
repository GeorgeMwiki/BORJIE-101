/**
 * Worker tenant-context helper for the consolidation-worker.
 *
 * Workers bypass api-gateway's `databaseMiddleware`, so the pooled connection
 * carries NO `app.current_tenant_id` GUC; every tenant-scoped statement must
 * bind it itself.
 *
 * This delegates to `withTenantContext` from `@borjie/database`, which opens a
 * real Drizzle transaction (postgres.js `.begin()` — which PINS one connection
 * for the transaction) and binds `app.current_tenant_id` + `app.tenant_id` +
 * `app.is_service_role` via `SET LOCAL`. The body receives the pinned `tx` and
 * MUST run all its DB calls through THAT handle (not the outer pooled `db`).
 *
 * Replaces a raw `BEGIN`/`SET LOCAL`/`COMMIT`-via-separate-`execute()`
 * implementation that did NOT pin on a pooled postgres.js client (the SET
 * LOCAL ran outside any transaction and never applied; a dangling transaction
 * could be left on the pool). It only appeared to work because the worker
 * connects via the Supabase `service_role` (BYPASSRLS). Mirrors
 * `services/api-gateway/src/workers/with-tenant-context.ts`; both must stay in
 * sync. The api-gateway copy carries the verified concurrency regression test.
 */

import { withTenantContext } from '@borjie/database';

export interface TenantContextDbLike {
  execute(query: unknown): Promise<unknown>;
}

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
