/**
 * `getTenantRegion(db, tenantId)` — resolves the tenant's data-residency
 * region from `tenants.region` (migration 0158).
 *
 * Used by:
 *   - `selectEncryptionPortForTenant` -> per-request KMS region routing
 *   - `createEftStubAdapter` (and future per-jurisdiction EFT adapters)
 *     -> per-request bank-rail region routing
 *   - `getOcrProviderFromEnv` callers -> per-tenant OCR region routing
 *
 * Resolution order (matches the JSDoc contract on `selectEncryptionPort
 * ForTenant`):
 *   1. `tenants.region` from the row matching `tenantId` (when non-empty)
 *   2. `null` (callers fall back to `env.AWS_REGION`)
 *
 * Hard DB failures degrade to `null` so a transient outage does not
 * brick request-scoped composition; the caller's env-fallback still
 * keeps the adapter region-bound (just to the platform default, not
 * the tenant's home region). Callers that need a hard signal can
 * wrap the call and treat `null` as "use platform default" without
 * crashing the request.
 *
 * Sketch of the structural shape expected:
 *
 *   import { getTenantRegion } from '@borjie/database';
 *   const region = await getTenantRegion(db, tenantId);
 *   // region === 'af-south-1' for a ZA tenant, or null for an unset row
 */
import { and, eq, isNull } from 'drizzle-orm';

import { tenants } from '../../schemas/tenant.schema.js';
import type { DatabaseClient } from '../../client.js';

/**
 * Minimal db shape — we only need `.select().from().where().limit()`.
 * Typing against the full `DatabaseClient` keeps the call site stable
 * even when the inner drizzle builder shape drifts across versions.
 */
export type GetTenantRegionDb = Pick<DatabaseClient, 'select'>;

/**
 * Resolve the tenant's `tenants.region` column. Returns `null` when:
 *   - `tenantId` is empty / null
 *   - the tenant row does not exist or is soft-deleted
 *   - the row exists but the column is empty
 *   - the database query throws (logged; never propagates)
 *
 * The DB column is `NOT NULL DEFAULT <PLATFORM_DEFAULT_REGION>` so a
 * provisioned tenant always has a value. The `null` return path only
 * fires for unprovisioned tenants or DB errors — callers MUST fall back
 * to `env.AWS_REGION`.
 */
export async function getTenantRegion(
  db: GetTenantRegionDb,
  tenantId: string | null | undefined,
): Promise<string | null> {
  if (!tenantId || tenantId.length === 0) {
    return null;
  }
  try {
    const rows = await db
      .select({ region: tenants.region })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);
    const region = rows[0]?.region;
    if (typeof region !== 'string' || region.length === 0) {
      return null;
    }
    return region;
  } catch {
    // Degrade silently — the caller falls back to env.AWS_REGION.
    // Logging is the caller's responsibility (logger is not in scope
    // here to keep the helper free of the pino dep).
    return null;
  }
}
