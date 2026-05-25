/**
 * Tenant-role profile builder.
 *
 * Reads the existing Drizzle schema to assemble a {@link TenantProfile}
 * dossier. Every query is wrapped in try/catch so a missing table (or
 * a dev DB without the relevant migration applied) degrades to an
 * `undefined` section rather than blowing up the whole build.
 *
 * `db` is typed `unknown` here so the package stays loose; the
 * composition root passes the real Drizzle client. We type the rows
 * we read back narrowly with `as`-narrowing inside try blocks.
 */
import type {
  IdentityFacts,
  LeaseSnapshot,
  MaintenanceItem,
  PaymentMonth,
  PropertyFacts,
  TenantProfile,
  UnitFacts,
  CommunicationTouchpoint,
  HouseholdComposition,
} from '../types.js';

export interface BuildTenantProfileArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly db: unknown;
}

/**
 * Minimal Drizzle-client shape we expect. The composition root passes
 * a real client; tests pass an in-memory fake that implements only the
 * methods we touch.
 */
interface DrizzleLike {
  query?: Record<string, {
    findFirst?: (args: unknown) => Promise<unknown>;
    findMany?: (args: unknown) => Promise<unknown[]>;
  }>;
  execute?: (sql: unknown) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

function asDrizzle(db: unknown): DrizzleLike {
  // Cast through unknown to avoid forcing callers to import drizzle types.
  return db as DrizzleLike;
}

async function safe<T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
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
  args: BuildTenantProfileArgs,
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
    const out: IdentityFacts = {
      userId: args.userId,
      tenantId: args.tenantId,
    };
    const email = pickString(row, 'email');
    if (email) out.email = email;
    const phone = pickString(row, 'phone');
    if (phone) out.phone = phone;
    const firstName = pickString(row, 'first_name', 'firstName');
    if (firstName) out.firstName = firstName;
    const lastName = pickString(row, 'last_name', 'lastName');
    if (lastName) out.lastName = lastName;
    const displayName = pickString(row, 'display_name', 'displayName');
    if (displayName) out.displayName = displayName;
    const status = pickString(row, 'status');
    if (status) out.status = status;
    const timezone = pickString(row, 'timezone');
    if (timezone) out.timezone = timezone;
    const locale = pickString(row, 'locale');
    if (locale) out.locale = locale;
    const lastLoginAt = pickDate(row, 'last_login_at', 'lastLoginAt');
    if (lastLoginAt) out.lastLoginAt = lastLoginAt;
    const lastActivityAt = pickDate(row, 'last_activity_at', 'lastActivityAt');
    if (lastActivityAt) out.lastActivityAt = lastActivityAt;
    const prefs = row['preferences'];
    if (prefs && typeof prefs === 'object') {
      out.preferences = prefs as Record<string, unknown>;
    }
    return out;
  }, fallback);
}

async function loadCurrentLease(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
): Promise<LeaseSnapshot | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    // Join customers → leases via the user's matched customer record.
    const result = await exec({
      sql: `
        SELECT l.id, l.lease_number, l.status, l.start_date, l.end_date,
               l.rent_amount, l.rent_currency, l.rent_frequency,
               l.renewal_status
        FROM leases l
        INNER JOIN customers c ON c.id = l.customer_id
        WHERE l.tenant_id = $1
          AND (c.email = (SELECT email FROM users WHERE id = $2)
               OR c.phone = (SELECT phone FROM users WHERE id = $2))
          AND l.status IN ('active', 'approved', 'expiring_soon')
        ORDER BY l.start_date DESC
        LIMIT 1
      `,
      params: [args.tenantId, args.userId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const snapshot: LeaseSnapshot = {
      leaseId: String(row['id']),
      leaseNumber: String(row['lease_number'] ?? ''),
      status: String(row['status'] ?? 'unknown'),
    };
    const startDate = pickDate(row, 'start_date');
    if (startDate) snapshot.startDate = startDate;
    const endDate = pickDate(row, 'end_date');
    if (endDate) snapshot.endDate = endDate;
    const rentAmount = pickNumber(row, 'rent_amount');
    if (rentAmount !== undefined) snapshot.rentAmount = rentAmount;
    const rentCurrency = pickString(row, 'rent_currency');
    if (rentCurrency) snapshot.rentCurrency = rentCurrency;
    const rentFrequency = pickString(row, 'rent_frequency');
    if (rentFrequency) snapshot.rentFrequency = rentFrequency;
    const renewalStatus = pickString(row, 'renewal_status');
    if (renewalStatus) snapshot.renewalStatus = renewalStatus;
    return snapshot;
  }, undefined);
}

async function loadLeaseHistory(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
): Promise<ReadonlyArray<LeaseSnapshot> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT l.id, l.lease_number, l.status, l.start_date, l.end_date,
               l.rent_amount, l.rent_currency, l.rent_frequency,
               l.renewal_status
        FROM leases l
        INNER JOIN customers c ON c.id = l.customer_id
        WHERE l.tenant_id = $1
          AND (c.email = (SELECT email FROM users WHERE id = $2)
               OR c.phone = (SELECT phone FROM users WHERE id = $2))
        ORDER BY l.start_date DESC
        LIMIT 10
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row): LeaseSnapshot => {
      const snap: LeaseSnapshot = {
        leaseId: String(row['id']),
        leaseNumber: String(row['lease_number'] ?? ''),
        status: String(row['status'] ?? 'unknown'),
      };
      const startDate = pickDate(row, 'start_date');
      if (startDate) snap.startDate = startDate;
      const endDate = pickDate(row, 'end_date');
      if (endDate) snap.endDate = endDate;
      const rentAmount = pickNumber(row, 'rent_amount');
      if (rentAmount !== undefined) snap.rentAmount = rentAmount;
      const rentCurrency = pickString(row, 'rent_currency');
      if (rentCurrency) snap.rentCurrency = rentCurrency;
      return snap;
    });
  }, undefined);
}

async function loadUnit(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
  leaseId: string | undefined,
): Promise<UnitFacts | undefined> {
  if (!leaseId) return undefined;
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT u.id, u.unit_code, u.floor, u.type, u.bedrooms,
               u.bathrooms, u.square_meters, u.status,
               u.base_rent_amount, u.base_rent_currency
        FROM units u
        INNER JOIN leases l ON l.unit_id = u.id
        WHERE l.id = $1 AND l.tenant_id = $2
        LIMIT 1
      `,
      params: [leaseId, args.tenantId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const unit: UnitFacts = {
      unitId: String(row['id']),
      unitNumber: String(row['unit_code'] ?? ''),
    };
    const floor = pickNumber(row, 'floor');
    if (floor !== undefined) unit.floor = floor;
    const type = pickString(row, 'type');
    if (type) unit.type = type;
    const bedrooms = pickNumber(row, 'bedrooms');
    if (bedrooms !== undefined) unit.bedrooms = bedrooms;
    const bathrooms = pickNumber(row, 'bathrooms');
    if (bathrooms !== undefined) unit.bathrooms = bathrooms;
    const sizeSqm = pickNumber(row, 'square_meters');
    if (sizeSqm !== undefined) unit.sizeSqm = sizeSqm;
    const status = pickString(row, 'status');
    if (status) unit.status = status;
    const rentAmount = pickNumber(row, 'base_rent_amount');
    if (rentAmount !== undefined) unit.rentAmount = rentAmount;
    const currency = pickString(row, 'base_rent_currency');
    if (currency) unit.currency = currency;
    return unit;
  }, undefined);
}

async function loadProperty(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
  leaseId: string | undefined,
): Promise<PropertyFacts | undefined> {
  if (!leaseId) return undefined;
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT p.id, p.property_code, p.name, p.type, p.city,
               p.country, p.year_built, p.total_units
        FROM properties p
        INNER JOIN leases l ON l.property_id = p.id
        WHERE l.id = $1 AND l.tenant_id = $2
        LIMIT 1
      `,
      params: [leaseId, args.tenantId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const property: PropertyFacts = {
      propertyId: String(row['id']),
      propertyCode: String(row['property_code'] ?? ''),
      name: String(row['name'] ?? ''),
    };
    const type = pickString(row, 'type');
    if (type) property.type = type;
    const city = pickString(row, 'city');
    if (city) property.city = city;
    const country = pickString(row, 'country');
    if (country) property.country = country;
    const yearBuilt = pickNumber(row, 'year_built');
    if (yearBuilt !== undefined) property.yearBuilt = yearBuilt;
    const totalUnits = pickNumber(row, 'total_units');
    if (totalUnits !== undefined) property.totalUnits = totalUnits;
    return property;
  }, undefined);
}

async function loadPaymentHistory(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
): Promise<ReadonlyArray<PaymentMonth> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    // Roll up 24 months of invoices for this user's lease(s).
    const result = await exec({
      sql: `
        SELECT to_char(i.issue_date, 'YYYY-MM') AS month,
               SUM(i.total_amount) AS total_charged,
               SUM(i.paid_amount) AS total_paid,
               SUM(i.balance_amount) AS balance,
               i.currency
        FROM invoices i
        INNER JOIN customers c ON c.id = i.customer_id
        WHERE i.tenant_id = $1
          AND (c.email = (SELECT email FROM users WHERE id = $2)
               OR c.phone = (SELECT phone FROM users WHERE id = $2))
          AND i.issue_date >= NOW() - INTERVAL '24 months'
        GROUP BY 1, i.currency
        ORDER BY 1 DESC
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row): PaymentMonth => ({
      month: String(row['month'] ?? ''),
      totalCharged: pickNumber(row, 'total_charged') ?? 0,
      totalPaid: pickNumber(row, 'total_paid') ?? 0,
      balance: pickNumber(row, 'balance') ?? 0,
      currency: pickString(row, 'currency') ?? 'KES',
    }));
  }, undefined);
}

async function loadMaintenance(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
  windowDays: number,
  statuses: ReadonlyArray<string>,
): Promise<ReadonlyArray<MaintenanceItem> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const inList = statuses.map((_s, i) => `$${i + 3}`).join(',');
    const result = await exec({
      sql: `
        SELECT w.id, w.work_order_number, w.category, w.priority,
               w.status, w.created_at, w.completed_at, w.description
        FROM work_orders w
        INNER JOIN customers c ON c.id = w.customer_id
        WHERE w.tenant_id = $1
          AND (c.email = (SELECT email FROM users WHERE id = $2)
               OR c.phone = (SELECT phone FROM users WHERE id = $2))
          AND w.status IN (${inList})
          AND w.created_at >= NOW() - INTERVAL '${windowDays} days'
        ORDER BY w.created_at DESC
        LIMIT 50
      `,
      params: [args.tenantId, args.userId, ...statuses],
    });
    return result.rows.map((row): MaintenanceItem => {
      const item: MaintenanceItem = {
        workOrderId: String(row['id']),
        workOrderNumber: String(row['work_order_number'] ?? ''),
        category: String(row['category'] ?? 'other'),
        priority: String(row['priority'] ?? 'medium'),
        status: String(row['status'] ?? 'submitted'),
        submittedAt: pickDate(row, 'created_at') ?? new Date(0).toISOString(),
      };
      const closedAt = pickDate(row, 'completed_at');
      if (closedAt) item.closedAt = closedAt;
      const description = pickString(row, 'description');
      if (description) item.description = description;
      return item;
    });
  }, undefined);
}

async function loadCommunications(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
): Promise<ReadonlyArray<CommunicationTouchpoint> | undefined> {
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT m.channel, m.direction, m.category, m.created_at, m.preview
        FROM messages m
        INNER JOIN customers c ON c.id = m.customer_id
        WHERE m.tenant_id = $1
          AND (c.email = (SELECT email FROM users WHERE id = $2)
               OR c.phone = (SELECT phone FROM users WHERE id = $2))
          AND m.created_at >= NOW() - INTERVAL '90 days'
        ORDER BY m.created_at DESC
        LIMIT 100
      `,
      params: [args.tenantId, args.userId],
    });
    return result.rows.map((row): CommunicationTouchpoint => {
      const direction = pickString(row, 'direction');
      const touch: CommunicationTouchpoint = {
        channel: pickString(row, 'channel') ?? 'unknown',
        direction:
          direction === 'inbound' || direction === 'outbound'
            ? direction
            : 'outbound',
        timestamp: pickDate(row, 'created_at') ?? new Date(0).toISOString(),
      };
      const category = pickString(row, 'category');
      if (category) touch.category = category;
      const preview = pickString(row, 'preview');
      if (preview) touch.preview = preview;
      return touch;
    });
  }, undefined);
}

async function loadHousehold(
  db: DrizzleLike,
  args: BuildTenantProfileArgs,
  leaseId: string | undefined,
): Promise<HouseholdComposition | undefined> {
  if (!leaseId) return undefined;
  return safe(async () => {
    const exec = db.execute;
    if (!exec) return undefined;
    const result = await exec({
      sql: `
        SELECT additional_occupants, pet_details, max_occupants
        FROM leases WHERE id = $1 AND tenant_id = $2 LIMIT 1
      `,
      params: [leaseId, args.tenantId],
    });
    const row = result.rows[0];
    if (!row) return undefined;
    const additional = row['additional_occupants'];
    const pets = row['pet_details'];
    const adults = Array.isArray(additional)
      ? (additional as ReadonlyArray<{ ageBand?: string }>).filter(
          (o) => o.ageBand !== 'child',
        ).length + 1
      : 1;
    const children = Array.isArray(additional)
      ? (additional as ReadonlyArray<{ ageBand?: string }>).filter(
          (o) => o.ageBand === 'child',
        ).length
      : 0;
    return {
      adults,
      children,
      pets: Array.isArray(pets) ? pets.length : 0,
    };
  }, undefined);
}

/**
 * Build a {@link TenantProfile} for the given user.
 *
 * Every section is loaded defensively — a missing table degrades the
 * field to `undefined` so the dossier remains usable for partial data.
 */
export async function buildTenantProfile(
  args: BuildTenantProfileArgs,
): Promise<TenantProfile> {
  const db = asDrizzle(args.db);
  const identity = await loadIdentity(db, args);
  const currentLease = await loadCurrentLease(db, args);
  const leaseHistory = await loadLeaseHistory(db, args);
  const unit = await loadUnit(db, args, currentLease?.leaseId);
  const property = await loadProperty(db, args, currentLease?.leaseId);
  const paymentHistory24m = await loadPaymentHistory(db, args);
  const openMaintenance = await loadMaintenance(db, args, 365, [
    'submitted',
    'triaged',
    'assigned',
    'scheduled',
    'in_progress',
    'pending_parts',
  ]);
  const closedMaintenance12m = await loadMaintenance(db, args, 365, [
    'completed',
    'verified',
  ]);
  const communications90d = await loadCommunications(db, args);
  const household = await loadHousehold(db, args, currentLease?.leaseId);

  const profile: TenantProfile = { identity };
  if (currentLease) profile.currentLease = currentLease;
  if (leaseHistory) profile.leaseHistory = leaseHistory;
  if (unit) profile.unit = unit;
  if (property) profile.property = property;
  if (paymentHistory24m) profile.paymentHistory24m = paymentHistory24m;
  if (openMaintenance) profile.openMaintenance = openMaintenance;
  if (closedMaintenance12m) profile.closedMaintenance12m = closedMaintenance12m;
  if (communications90d) profile.communications90d = communications90d;
  if (household) profile.household = household;
  return profile;
}
