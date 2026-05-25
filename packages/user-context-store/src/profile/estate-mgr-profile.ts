/**
 * Estate-Manager-role profile builder.
 *
 * Estate managers run a campus or multi-building estate. Their dossier
 * blends building inventory, total residents, active services, and
 * sustainability (energy/water) consumption.
 */
import type { EstateMgrProfile, IdentityFacts } from '../types.js';

export interface BuildEstateMgrProfileArgs {
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
  args: BuildEstateMgrProfileArgs,
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
    const firstName = pickString(row, 'first_name');
    if (firstName) id.firstName = firstName;
    const lastName = pickString(row, 'last_name');
    if (lastName) id.lastName = lastName;
    return id;
  }, fallback);
}

async function loadBuildings(
  db: DrizzleLike,
  args: BuildEstateMgrProfileArgs,
): Promise<ReadonlyArray<{ buildingId: string; name: string; unitCount?: number }>> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return [];
    const result = await exec({
      sql: `
        SELECT b.id, b.name,
               (SELECT COUNT(*) FROM units u WHERE u.block_id = b.id) AS unit_count
        FROM blocks b
        INNER JOIN properties p ON p.id = b.property_id
        WHERE b.tenant_id = $1
          AND (p.manager_id = $2 OR p.owner_id = $2)
        ORDER BY b.name
        LIMIT 100
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => {
      const b: { buildingId: string; name: string; unitCount?: number } = {
        buildingId: String(row['id']),
        name: String(row['name'] ?? ''),
      };
      const count = pickNumber(row, 'unit_count');
      if (count !== undefined) b.unitCount = count;
      return b;
    });
  }, []);
}

async function loadResidentsCount(
  db: DrizzleLike,
  args: BuildEstateMgrProfileArgs,
): Promise<number | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT COUNT(DISTINCT c.id) AS resident_count
        FROM customers c
        INNER JOIN leases l ON l.customer_id = c.id
        INNER JOIN properties p ON p.id = l.property_id
        WHERE c.tenant_id = $1
          AND (p.manager_id = $2 OR p.owner_id = $2)
          AND l.status = 'active'
      `,
      params: [args.tenantId, args.userId],
    });
    return pickNumber(result.rows[0] ?? {}, 'resident_count');
  }, undefined);
}

async function loadEnergyConsumption(
  db: DrizzleLike,
  args: BuildEstateMgrProfileArgs,
): Promise<number | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT COALESCE(SUM(ur.reading_value), 0) AS energy_kwh
        FROM utility_readings ur
        INNER JOIN utility_accounts ua ON ua.id = ur.account_id
        INNER JOIN properties p ON p.id = ua.property_id
        WHERE ua.tenant_id = $1
          AND (p.manager_id = $2 OR p.owner_id = $2)
          AND ua.utility_type = 'electricity'
          AND ur.reading_date >= NOW() - INTERVAL '12 months'
      `,
      params: [args.tenantId, args.userId],
    });
    return pickNumber(result.rows[0] ?? {}, 'energy_kwh');
  }, undefined);
}

async function loadWaterConsumption(
  db: DrizzleLike,
  args: BuildEstateMgrProfileArgs,
): Promise<number | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT COALESCE(SUM(ur.reading_value), 0) AS water_m3
        FROM utility_readings ur
        INNER JOIN utility_accounts ua ON ua.id = ur.account_id
        INNER JOIN properties p ON p.id = ua.property_id
        WHERE ua.tenant_id = $1
          AND (p.manager_id = $2 OR p.owner_id = $2)
          AND ua.utility_type = 'water'
          AND ur.reading_date >= NOW() - INTERVAL '12 months'
      `,
      params: [args.tenantId, args.userId],
    });
    return pickNumber(result.rows[0] ?? {}, 'water_m3');
  }, undefined);
}

/**
 * Build an {@link EstateMgrProfile} dossier.
 */
export async function buildEstateMgrProfile(
  args: BuildEstateMgrProfileArgs,
): Promise<EstateMgrProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const buildings = await loadBuildings(db, args);
  const residentsCount = await loadResidentsCount(db, args);
  const energyConsumptionKwh12m = await loadEnergyConsumption(db, args);
  const waterConsumptionM3_12m = await loadWaterConsumption(db, args);

  const profile: EstateMgrProfile = {
    identity,
    buildings,
  };
  if (residentsCount !== undefined) profile.residentsCount = residentsCount;
  if (energyConsumptionKwh12m !== undefined) {
    profile.energyConsumptionKwh12m = energyConsumptionKwh12m;
  }
  if (waterConsumptionM3_12m !== undefined) {
    profile.waterConsumptionM3_12m = waterConsumptionM3_12m;
  }
  return profile;
}
