/**
 * Worker tenant-context helper for the consolidation-worker.
 *
 * Workers bypass api-gateway's `databaseMiddleware`, so the pooled
 * connection carries NO `app.current_tenant_id` GUC. Every tenant-scoped
 * write therefore MUST bind the GUC itself. This helper wraps a body in:
 *
 *     BEGIN;
 *     SET LOCAL app.current_tenant_id = $1;   -- via set_config(..., true)
 *     SET LOCAL app.tenant_id         = $1;   -- legacy policies (pre-0172)
 *     <body>
 *     COMMIT;                                  -- (ROLLBACK on throw)
 *
 * `SET LOCAL` scopes the binding to the transaction; it dies at COMMIT /
 * ROLLBACK and cannot leak onto the pooled connection — closing audit gap
 * G8 (`Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`).
 *
 * This is a verbatim mirror of
 * `services/api-gateway/src/workers/with-tenant-context.ts`, duplicated here
 * because the consolidation-worker cannot import api-gateway `src` directly
 * (only its built `dist` via the sibling-service pattern), and this helper
 * is small + invariant. Both files must stay in sync.
 *
 * `body` MUST run all its DB calls through the SAME `db` handle so
 * postgres.js keeps every statement on the txn-owned connection.
 */

import { sql } from 'drizzle-orm';

export interface TenantContextDbLike {
  execute(query: unknown): Promise<unknown>;
}

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
      // Ignore — the original error takes precedence.
    }
    throw err;
  }
}
