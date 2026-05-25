/**
 * Admin-role profile builder.
 *
 * Admins look at org-wide rollups: total user count, properties, units,
 * active leases, billing position, feature usage. We synthesise from
 * the tables guaranteed by core migrations.
 */
import type { AdminProfile, IdentityFacts } from '../types.js';

export interface BuildAdminProfileArgs {
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
  args: BuildAdminProfileArgs,
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

async function loadCounts(
  db: DrizzleLike,
  args: BuildAdminProfileArgs,
): Promise<{
  totalUsers?: number;
  totalProperties?: number;
  totalUnits?: number;
  totalActiveLeases?: number;
}> {
  const out: {
    totalUsers?: number;
    totalProperties?: number;
    totalUnits?: number;
    totalActiveLeases?: number;
  } = {};
  await safe(async () => {
    const exec = db.execute;
    if (!exec) return;
    const u = await exec({
      sql: 'SELECT COUNT(*) AS n FROM users WHERE tenant_id = $1 AND deleted_at IS NULL',
      params: [args.tenantId],
    });
    const n = pickNumber(u.rows[0] ?? {}, 'n');
    if (n !== undefined) out.totalUsers = n;
  }, undefined);

  await safe(async () => {
    const exec = db.execute;
    if (!exec) return;
    const p = await exec({
      sql: 'SELECT COUNT(*) AS n FROM properties WHERE tenant_id = $1 AND deleted_at IS NULL',
      params: [args.tenantId],
    });
    const n = pickNumber(p.rows[0] ?? {}, 'n');
    if (n !== undefined) out.totalProperties = n;
  }, undefined);

  await safe(async () => {
    const exec = db.execute;
    if (!exec) return;
    const un = await exec({
      sql: 'SELECT COUNT(*) AS n FROM units WHERE tenant_id = $1 AND deleted_at IS NULL',
      params: [args.tenantId],
    });
    const n = pickNumber(un.rows[0] ?? {}, 'n');
    if (n !== undefined) out.totalUnits = n;
  }, undefined);

  await safe(async () => {
    const exec = db.execute;
    if (!exec) return;
    const l = await exec({
      sql: "SELECT COUNT(*) AS n FROM leases WHERE tenant_id = $1 AND status = 'active'",
      params: [args.tenantId],
    });
    const n = pickNumber(l.rows[0] ?? {}, 'n');
    if (n !== undefined) out.totalActiveLeases = n;
  }, undefined);

  return out;
}

async function loadBilling(
  db: DrizzleLike,
  args: BuildAdminProfileArgs,
): Promise<AdminProfile['billingPosition'] | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: 'SELECT subscription_tier, billing_settings FROM tenants WHERE id = $1 LIMIT 1',
      params: [args.tenantId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const tier = pickString(row, 'subscription_tier') ?? 'starter';
    const billing: NonNullable<AdminProfile['billingPosition']> = { tier };
    const settings = row['billing_settings'];
    if (settings && typeof settings === 'object') {
      const s = settings as Record<string, unknown>;
      const mrr = typeof s['mrr'] === 'number' ? (s['mrr'] as number) : undefined;
      if (mrr !== undefined) billing.mrr = mrr;
      const currency = typeof s['currency'] === 'string' ? (s['currency'] as string) : undefined;
      if (currency) billing.currency = currency;
    }
    return billing;
  }, undefined);
}

/**
 * Build an {@link AdminProfile} dossier.
 */
export async function buildAdminProfile(
  args: BuildAdminProfileArgs,
): Promise<AdminProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const counts = await loadCounts(db, args);
  const billingPosition = await loadBilling(db, args);

  const profile: AdminProfile = { identity };
  if (counts.totalUsers !== undefined) profile.totalUsers = counts.totalUsers;
  if (counts.totalProperties !== undefined) profile.totalProperties = counts.totalProperties;
  if (counts.totalUnits !== undefined) profile.totalUnits = counts.totalUnits;
  if (counts.totalActiveLeases !== undefined) profile.totalActiveLeases = counts.totalActiveLeases;
  if (billingPosition) profile.billingPosition = billingPosition;
  return profile;
}
