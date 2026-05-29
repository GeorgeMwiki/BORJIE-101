/**
 * Tenant scale-tier lookup — SC-3 helper.
 *
 * Reads `tenants.scale_tier` for the active tenant so the brain-teach
 * route can build the scale-aware persona directive (see scale-persona.ts).
 *
 * The lookup is BEST-EFFORT — never blocks the SSE turn. On any error,
 * missing row, or absent DB we return `null` and the caller falls back
 * to the safest tier (t1_artisanal) via `coerceScaleTier`.
 *
 * Tenant scope: the `app.current_tenant_id` GUC is bound by the api-
 * gateway auth middleware before this query runs, so RLS already
 * filters us to the right row. We never double-filter from app code per
 * CLAUDE.md.
 */

import { sql } from 'drizzle-orm';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ScaleRow {
  readonly scale_tier?: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ScaleRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ScaleRow>;
  const wrapped = result as { rows?: ReadonlyArray<ScaleRow> };
  return wrapped?.rows ?? [];
}

/**
 * Return the scale_tier text for `tenantId` or null when:
 *   - db is null (composition root did not bind one),
 *   - the row is missing,
 *   - the query throws.
 *
 * The result is a plain string — callers should pass it through
 * `coerceScaleTier()` from `@borjie/owner-os-tabs` to narrow.
 */
export async function lookupTenantScaleTier(
  db: DbLike | null,
  tenantId: string,
): Promise<string | null> {
  if (!db) return null;
  if (!tenantId || tenantId.length === 0) return null;
  try {
    const result = await db.execute(
      sql`SELECT scale_tier FROM tenants WHERE id = ${tenantId} LIMIT 1`,
    );
    const row = rowsOf(result)[0];
    if (!row) return null;
    const value = row.scale_tier;
    if (typeof value !== 'string' || value.length === 0) return null;
    return value;
  } catch {
    return null;
  }
}
