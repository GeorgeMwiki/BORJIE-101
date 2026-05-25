/**
 * Owner-role profile builder.
 *
 * Owners care about portfolio rollups (NOI, occupancy, mortgage,
 * insurance, capex). We synthesize per-property financials from a
 * blend of `properties`, `leases`, `invoices`, and (best-effort)
 * `property_valuations` / `mortgage` adjacent tables. Missing tables
 * degrade gracefully.
 */
import type {
  IdentityFacts,
  OwnerProfile,
  OwnerPropertyFinancials,
} from '../types.js';

export interface BuildOwnerProfileArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly db: unknown;
}

interface DrizzleLike {
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

async function safe<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

function pickString(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickDate(row: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

async function loadIdentity(
  db: DrizzleLike,
  args: BuildOwnerProfileArgs,
): Promise<IdentityFacts> {
  const fallback: IdentityFacts = {
    userId: args.userId,
    tenantId: args.tenantId,
  };
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return fallback;
    const result = await exec({
      sql: 'SELECT * FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1',
      params: [args.userId, args.tenantId],
    });
    const row = result.rows[0];
    if (!row) return fallback;
    const id: IdentityFacts = {
      userId: args.userId,
      tenantId: args.tenantId,
    };
    const email = pickString(row, 'email');
    if (email) id.email = email;
    const phone = pickString(row, 'phone');
    if (phone) id.phone = phone;
    const firstName = pickString(row, 'first_name');
    if (firstName) id.firstName = firstName;
    const lastName = pickString(row, 'last_name');
    if (lastName) id.lastName = lastName;
    const displayName = pickString(row, 'display_name');
    if (displayName) id.displayName = displayName;
    return id;
  }, fallback);
}

async function loadProperties(
  db: DrizzleLike,
  args: BuildOwnerProfileArgs,
): Promise<ReadonlyArray<OwnerPropertyFinancials>> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return [];
    const result = await exec({
      sql: `
        SELECT p.id, p.name, p.default_currency, p.total_units,
               p.occupied_units, p.vacant_units
        FROM properties p
        WHERE p.tenant_id = $1 AND p.owner_id = $2
          AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT 100
      `,
      params: [args.tenantId, args.userId],
    });

    const enriched: OwnerPropertyFinancials[] = [];
    for (const row of result.rows) {
      const propertyId = String(row['id']);
      const totalUnits = pickNumber(row, 'total_units') ?? 0;
      const occupiedUnits = pickNumber(row, 'occupied_units') ?? 0;
      const occupancyPct =
        totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
      const fin: OwnerPropertyFinancials = {
        propertyId,
        propertyName: String(row['name'] ?? ''),
        currency: pickString(row, 'default_currency') ?? 'KES',
        occupancyPct: Math.round(occupancyPct * 100) / 100,
      };
      // Best-effort NOI from invoices.
      const noi = await safe(async () => {
        const inner = await exec({
          sql: `
            SELECT COALESCE(SUM(paid_amount), 0) AS noi_12m
            FROM invoices
            WHERE tenant_id = $1 AND property_id = $2
              AND issue_date >= NOW() - INTERVAL '12 months'
              AND status IN ('paid', 'partially_paid')
          `,
          params: [args.tenantId, propertyId],
        });
        return pickNumber(inner.rows[0] ?? {}, 'noi_12m');
      }, undefined);
      if (noi !== undefined) fin.noiAnnualized = noi;

      // Best-effort insurance expiry — schema may not have a dedicated
      // insurance table; skip silently if missing.
      const insurance = await safe(async () => {
        const inner = await exec({
          sql: `
            SELECT MIN(expires_at) AS insurance_expires_at
            FROM property_insurance
            WHERE tenant_id = $1 AND property_id = $2
              AND status = 'active'
          `,
          params: [args.tenantId, propertyId],
        });
        return pickDate(inner.rows[0] ?? {}, 'insurance_expires_at');
      }, undefined);
      if (insurance) fin.insuranceExpiresAt = insurance;

      enriched.push(fin);
    }
    return enriched;
  }, []);
}

async function loadOccupancyTrend(
  db: DrizzleLike,
  args: BuildOwnerProfileArgs,
): Promise<ReadonlyArray<{ month: string; occupancyPct: number }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT to_char(snapshot_date, 'YYYY-MM') AS month,
               AVG(occupancy_pct) AS occupancy_pct
        FROM occupancy_snapshots
        WHERE tenant_id = $1 AND owner_id = $2
          AND snapshot_date >= NOW() - INTERVAL '12 months'
        GROUP BY 1
        ORDER BY 1
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => ({
      month: String(row['month'] ?? ''),
      occupancyPct: pickNumber(row, 'occupancy_pct') ?? 0,
    }));
  }, undefined);
}

/**
 * Build an {@link OwnerProfile} dossier.
 */
export async function buildOwnerProfile(
  args: BuildOwnerProfileArgs,
): Promise<OwnerProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const properties = await loadProperties(db, args);
  const occupancyTrend = await loadOccupancyTrend(db, args);

  const totalPortfolioNoi = properties.reduce(
    (sum, p) => sum + (p.noiAnnualized ?? 0),
    0,
  );

  const profile: OwnerProfile = {
    identity,
    properties,
  };
  if (occupancyTrend) profile.occupancyTrend = occupancyTrend;
  if (totalPortfolioNoi > 0) profile.totalPortfolioNoi = totalPortfolioNoi;
  return profile;
}
