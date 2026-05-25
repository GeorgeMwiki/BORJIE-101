import { describe, expect, it } from 'vitest';
import { buildPMProfile } from '../pm-profile.js';
import { buildEstateMgrProfile } from '../estate-mgr-profile.js';
import { buildAdminProfile } from '../admin-profile.js';
import { buildProspectProfile } from '../prospect-profile.js';
import { buildProfile } from '../index.js';

type Rows = ReadonlyArray<Record<string, unknown>>;

function db(
  routes: ReadonlyArray<{ match: (sql: string) => boolean; rows: Rows; throw?: boolean }>,
) {
  return {
    async execute(args: unknown) {
      const arg = args as { sql?: string };
      const sql = arg.sql ?? '';
      for (const r of routes) {
        if (r.match(sql)) {
          if (r.throw) throw new Error('missing');
          return { rows: r.rows };
        }
      }
      return { rows: [] };
    },
  };
}

describe('buildPMProfile', () => {
  it('returns identity + managed properties', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM properties') && sql.includes('manager_id'),
        rows: [{ id: 'p1', name: 'Block A' }, { id: 'p2', name: 'Block B' }],
      },
    ]);
    const p = await buildPMProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.managedProperties).toHaveLength(2);
  });

  it('graceful degrade when work_orders KPI query throws', async () => {
    const fake = db([
      { match: (sql) => sql.includes('work_orders'), throw: true, rows: [] },
    ]);
    const p = await buildPMProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.kpis).toBeUndefined();
  });
});

describe('buildEstateMgrProfile', () => {
  it('returns identity + buildings list', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM blocks'),
        rows: [{ id: 'b1', name: 'Block A', unit_count: 12 }],
      },
    ]);
    const p = await buildEstateMgrProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.buildings).toHaveLength(1);
    expect(p.buildings[0]?.unitCount).toBe(12);
  });

  it('graceful degrade when utility_readings missing', async () => {
    const fake = db([
      { match: (sql) => sql.includes('utility_readings'), throw: true, rows: [] },
    ]);
    const p = await buildEstateMgrProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.energyConsumptionKwh12m).toBeUndefined();
    expect(p.waterConsumptionM3_12m).toBeUndefined();
  });
});

describe('buildAdminProfile', () => {
  it('returns counts when tables present', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM users WHERE tenant_id'),
        rows: [{ n: 25 }],
      },
      {
        match: (sql) => sql.includes('FROM properties WHERE tenant_id'),
        rows: [{ n: 5 }],
      },
      {
        match: (sql) => sql.includes('FROM units WHERE tenant_id'),
        rows: [{ n: 80 }],
      },
      {
        match: (sql) => sql.includes('FROM leases'),
        rows: [{ n: 60 }],
      },
    ]);
    const p = await buildAdminProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.totalUsers).toBe(25);
    expect(p.totalProperties).toBe(5);
    expect(p.totalUnits).toBe(80);
    expect(p.totalActiveLeases).toBe(60);
  });

  it('graceful degrade when tenants table missing', async () => {
    const fake = db([
      { match: (sql) => sql.includes('FROM tenants'), throw: true, rows: [] },
    ]);
    const p = await buildAdminProfile({ userId: 'u1', tenantId: 't1', db: fake });
    expect(p.billingPosition).toBeUndefined();
  });
});

describe('buildProspectProfile', () => {
  it('returns lead quality based on marketing_leads row', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('FROM marketing_leads') && sql.includes('id = $1'),
        rows: [{ turn_count: 5, explicit_signup_intent: true, primary_pain: 'late rent collection' }],
      },
    ]);
    const p = await buildProspectProfile({ userId: 'lead-1', tenantId: 't1', db: fake });
    expect(p.leadQuality?.band).toBe('hot');
    expect(p.leadQuality?.primaryPain).toBe('late rent collection');
  });

  it('returns saved listings when table exists', async () => {
    const fake = db([
      {
        match: (sql) => sql.includes('saved_listings'),
        rows: [{ property_id: 'p1', saved_at: new Date('2026-05-01') }],
      },
    ]);
    const p = await buildProspectProfile({ userId: 'lead-1', tenantId: 't1', db: fake });
    expect(p.savedListings).toHaveLength(1);
  });

  it('cold band when no marketing_lead row', async () => {
    const fake = db([]);
    const p = await buildProspectProfile({ userId: 'lead-1', tenantId: 't1', db: fake });
    expect(p.leadQuality).toBeUndefined();
  });
});

describe('buildProfile (dispatcher)', () => {
  it('dispatches to tenant builder', async () => {
    const p = await buildProfile({
      role: 'tenant',
      userId: 'u',
      tenantId: 't',
      db: db([]),
    });
    expect('identity' in p).toBe(true);
  });

  it('dispatches to admin builder', async () => {
    const p = await buildProfile({
      role: 'admin',
      userId: 'u',
      tenantId: 't',
      db: db([]),
    });
    expect('identity' in p).toBe(true);
  });

  it('dispatches to prospect builder', async () => {
    const p = await buildProfile({
      role: 'prospect',
      userId: 'u',
      tenantId: 't',
      db: db([]),
    });
    expect('identity' in p).toBe(true);
  });
});
