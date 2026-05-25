/**
 * Property-Manager-role profile builder.
 *
 * PMs care about portfolio they manage, staff under them, KPIs, and
 * vendor health. We probe `properties.manager_id`, `users` for staff,
 * `work_orders` for KPI aggregates, and `vendors` for the contractor
 * roster.
 */
import type { IdentityFacts, PMProfile } from '../types.js';

export interface BuildPMProfileArgs {
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
  args: BuildPMProfileArgs,
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
    const displayName = pickString(row, 'display_name');
    if (displayName) id.displayName = displayName;
    return id;
  }, fallback);
}

async function loadManagedProperties(
  db: DrizzleLike,
  args: BuildPMProfileArgs,
): Promise<ReadonlyArray<{ propertyId: string; name: string }>> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return [];
    const result = await exec({
      sql: `
        SELECT id, name
        FROM properties
        WHERE tenant_id = $1 AND manager_id = $2
          AND deleted_at IS NULL
        ORDER BY name
        LIMIT 200
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => ({
      propertyId: String(row['id']),
      name: String(row['name'] ?? ''),
    }));
  }, []);
}

async function loadStaff(
  db: DrizzleLike,
  args: BuildPMProfileArgs,
): Promise<ReadonlyArray<{ userId: string; name: string; role?: string }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT u.id, u.first_name, u.last_name, r.name AS role_name
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1
          AND u.id != $2
          AND u.deleted_at IS NULL
          AND u.status = 'active'
        LIMIT 50
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row) => {
      const member: { userId: string; name: string; role?: string } = {
        userId: String(row['id']),
        name: `${pickString(row, 'first_name') ?? ''} ${pickString(row, 'last_name') ?? ''}`.trim(),
      };
      const role = pickString(row, 'role_name');
      if (role) member.role = role;
      return member;
    });
  }, undefined);
}

async function loadKpis(
  db: DrizzleLike,
  args: BuildPMProfileArgs,
): Promise<PMProfile['kpis'] | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const closed = await exec({
      sql: `
        SELECT COUNT(*) AS work_orders_closed_last_30d
        FROM work_orders w
        INNER JOIN properties p ON p.id = w.property_id
        WHERE w.tenant_id = $1 AND p.manager_id = $2
          AND w.completed_at >= NOW() - INTERVAL '30 days'
      `,
      params: [args.tenantId, args.userId],
    });
    const breaches = await exec({
      sql: `
        SELECT COUNT(*) AS sla_breaches_last_30d
        FROM work_orders w
        INNER JOIN properties p ON p.id = w.property_id
        WHERE w.tenant_id = $1 AND p.manager_id = $2
          AND (w.response_breached = true OR w.resolution_breached = true)
          AND w.created_at >= NOW() - INTERVAL '30 days'
      `,
      params: [args.tenantId, args.userId],
    });
    const kpis: NonNullable<PMProfile['kpis']> = {};
    const woClosed = pickNumber(closed.rows[0] ?? {}, 'work_orders_closed_last_30d');
    if (woClosed !== undefined) kpis.workOrdersClosedLast30d = woClosed;
    const slaBreaches = pickNumber(breaches.rows[0] ?? {}, 'sla_breaches_last_30d');
    if (slaBreaches !== undefined) kpis.slaBreachesLast30d = slaBreaches;
    return kpis;
  }, undefined);
}

async function loadVendors(
  db: DrizzleLike,
  args: BuildPMProfileArgs,
): Promise<ReadonlyArray<{ vendorId: string; companyName: string; status?: string }> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT id, company_name, status
        FROM vendors
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY is_preferred DESC, company_name
        LIMIT 50
      `,
      params: [args.tenantId],
    });
    return result.rows.map((row) => {
      const v: { vendorId: string; companyName: string; status?: string } = {
        vendorId: String(row['id']),
        companyName: String(row['company_name'] ?? ''),
      };
      const status = pickString(row, 'status');
      if (status) v.status = status;
      return v;
    });
  }, undefined);
}

/**
 * Build a {@link PMProfile} dossier.
 */
export async function buildPMProfile(
  args: BuildPMProfileArgs,
): Promise<PMProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const managedProperties = await loadManagedProperties(db, args);
  const staffUnderMgmt = await loadStaff(db, args);
  const kpis = await loadKpis(db, args);
  const vendors = await loadVendors(db, args);

  const profile: PMProfile = {
    identity,
    managedProperties,
  };
  if (staffUnderMgmt) profile.staffUnderMgmt = staffUnderMgmt;
  if (kpis) profile.kpis = kpis;
  if (vendors) profile.vendors = vendors;
  return profile;
}
