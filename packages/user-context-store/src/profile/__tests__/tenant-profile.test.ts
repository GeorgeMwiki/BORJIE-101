/**
 * Tenant-profile builder tests.
 *
 * Uses a hand-rolled FakeDb implementing the `execute({sql, params})`
 * surface our profile builders consume. Each test pins a specific
 * SQL → row-set mapping to verify what each query produces and how
 * graceful degradation works.
 */
import { describe, expect, it } from 'vitest';
import { buildTenantProfile } from '../tenant-profile.js';

type Rows = ReadonlyArray<Record<string, unknown>>;

interface FakeDb {
  execute(args: unknown): Promise<{ rows: Rows }>;
}

function fakeDb(
  routes: ReadonlyArray<{ match: (sql: string) => boolean; rows: Rows; throw?: boolean }>,
): FakeDb {
  return {
    async execute(args: unknown): Promise<{ rows: Rows }> {
      const arg = args as { sql?: string };
      const sql = arg.sql ?? '';
      for (const route of routes) {
        if (route.match(sql)) {
          if (route.throw) throw new Error('simulated table-missing');
          return { rows: route.rows };
        }
      }
      return { rows: [] };
    },
  };
}

describe('buildTenantProfile', () => {
  it('returns minimal dossier when db has no data', async () => {
    const db = fakeDb([]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.identity).toEqual({ userId: 'u1', tenantId: 't1' });
    expect(profile.currentLease).toBeUndefined();
    expect(profile.unit).toBeUndefined();
  });

  it('populates identity from users row', async () => {
    const db = fakeDb([
      {
        match: (sql) => sql.includes('FROM users'),
        rows: [
          {
            email: 'alice@example.com',
            phone: '+254700123456',
            first_name: 'Alice',
            last_name: 'Wanjiru',
            display_name: 'Alice W.',
            status: 'active',
            timezone: 'Africa/Nairobi',
            locale: 'en',
            last_login_at: new Date('2026-05-20T10:00:00Z'),
            preferences: { theme: 'dark' },
          },
        ],
      },
    ]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.identity.email).toBe('alice@example.com');
    expect(profile.identity.firstName).toBe('Alice');
    expect(profile.identity.lastLoginAt).toBe('2026-05-20T10:00:00.000Z');
    expect(profile.identity.preferences).toEqual({ theme: 'dark' });
  });

  it('populates current lease + lineage when lease query returns row', async () => {
    // Order matters: lease/unit/property queries match BEFORE the
    // generic `FROM users` matcher because lease SQL contains nested
    // `FROM users` subqueries that would otherwise be hijacked.
    const db = fakeDb([
      {
        match: (sql) => sql.includes('FROM units u'),
        rows: [
          {
            id: 'unit-1',
            unit_code: 'A-101',
            floor: 1,
            type: 'one_bedroom',
            bedrooms: 1,
            bathrooms: 1,
            square_meters: 45,
            status: 'occupied',
            base_rent_amount: 50000,
            base_rent_currency: 'KES',
          },
        ],
      },
      {
        match: (sql) => sql.includes('FROM properties p'),
        rows: [
          {
            id: 'prop-1',
            property_code: 'PROP-A',
            name: 'Acacia Apartments',
            city: 'Nairobi',
            country: 'KE',
            total_units: 30,
          },
        ],
      },
      {
        match: (sql) => sql.includes('FROM leases l') && sql.includes('LIMIT 1'),
        rows: [
          {
            id: 'lease-1',
            lease_number: 'LSE-001',
            status: 'active',
            start_date: new Date('2025-01-01T00:00:00Z'),
            end_date: new Date('2026-12-31T00:00:00Z'),
            rent_amount: 50000,
            rent_currency: 'KES',
            rent_frequency: 'monthly',
            renewal_status: 'not_started',
          },
        ],
      },
    ]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.currentLease?.leaseId).toBe('lease-1');
    expect(profile.unit?.unitNumber).toBe('A-101');
    expect(profile.property?.name).toBe('Acacia Apartments');
  });

  it('degrades gracefully when leases table throws', async () => {
    const db = fakeDb([
      {
        match: (sql) => sql.includes('FROM leases'),
        rows: [],
        throw: true,
      },
    ]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.currentLease).toBeUndefined();
    expect(profile.identity).toBeDefined();
  });

  it('returns payment history when invoices query succeeds', async () => {
    const db = fakeDb([
      {
        match: (sql) => sql.includes('invoices'),
        rows: [
          {
            month: '2026-05',
            total_charged: 50000,
            total_paid: 50000,
            balance: 0,
            currency: 'KES',
          },
          {
            month: '2026-04',
            total_charged: 50000,
            total_paid: 50000,
            balance: 0,
            currency: 'KES',
          },
        ],
      },
    ]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.paymentHistory24m).toHaveLength(2);
    expect(profile.paymentHistory24m?.[0]?.month).toBe('2026-05');
  });

  it('returns open maintenance when work_orders query succeeds', async () => {
    const db = fakeDb([
      {
        match: (sql) => sql.includes('FROM work_orders'),
        rows: [
          {
            id: 'wo-1',
            work_order_number: 'WO-001',
            category: 'plumbing',
            priority: 'high',
            status: 'submitted',
            created_at: new Date('2026-05-20T10:00:00Z'),
          },
        ],
      },
    ]);
    const profile = await buildTenantProfile({
      userId: 'u1',
      tenantId: 't1',
      db,
    });
    expect(profile.openMaintenance).toHaveLength(1);
    expect(profile.openMaintenance?.[0]?.category).toBe('plumbing');
  });
});
