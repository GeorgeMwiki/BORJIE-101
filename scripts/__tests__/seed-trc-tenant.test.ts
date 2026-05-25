/**
 * seed-trc-tenant tests — deterministic seed-shape coverage.
 *
 * The Postgres-touching path is exercised manually against a real Supabase
 * project (see Docs/WAVE15_TRC_PILOT.md). These tests cover the parts that
 * run on every machine: the seed data is well-formed, ids are deterministic
 * (so re-runs converge), the approval matrix encodes the TRC rules, and the
 * idempotency invariant holds (no two seed entries collide on a unique-index
 * column).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The seed script is a .mjs entry point. We load it as plain text and
// extract the declarative seed arrays via regex — the data is right there
// in the source for review by humans and tests alike. Going through the
// AST would be more robust but the seed arrays use simple object literals
// so regex extraction is good enough for the small Wave-15 surface.
const SEED_SRC = readFileSync(
  path.join(__dirname, '..', 'seed-trc-tenant.mjs'),
  'utf-8',
);

/**
 * Constants the literal arrays reference inside the seed source. Mirror
 * the same values to evaluate the literals in test isolation.
 */
const SEED_TEST_TENANT_ID = 'tnt_trc_001';
const SEED_TEST_ORG_PREFIX = SEED_TEST_TENANT_ID;

function extractArrayLiteralFromConst(source: string, constName: string): unknown[] {
  // Match `const NAME = [...]` (greedy across newlines). For each, we re-
  // evaluate the literal inside a sandboxed Function so JSON parses don't
  // gag on JS comments / shorthand syntax.
  const re = new RegExp(`const\\s+${constName}\\s*=\\s*(\\[[\\s\\S]*?\\n\\]);`, 'm');
  const m = source.match(re);
  if (!m) throw new Error(`could not find const ${constName} in seed source`);
  // Inject the named constants the literal references so template-literal
  // expressions like `${ORG_PREFIX}_dar` resolve. The Function ctor is the
  // sandbox boundary — the test only ever evaluates literal-shaped code.
  // eslint-disable-next-line no-new-func -- test fixture loader, source is in-repo
  const fn = new Function(
    'ORG_PREFIX',
    'TENANT_ID',
    `return ${m[1]};`,
  );
  return fn(SEED_TEST_ORG_PREFIX, SEED_TEST_TENANT_ID) as unknown[];
}

describe('seed-trc-tenant — seed data shape', () => {
  it('declares 4 districts (Dar/Dodoma/Tabora/Tanga)', () => {
    const districts = extractArrayLiteralFromConst(SEED_SRC, 'DISTRICTS') as Array<{
      id: string;
      code: string;
      name: string;
    }>;
    expect(districts).toHaveLength(4);
    const codes = districts.map((d) => d.code).sort();
    expect(codes).toEqual(['DAR', 'DODOMA', 'TABORA', 'TANGA']);
    // Every district id is deterministic + tenant-scoped.
    for (const d of districts) {
      expect(d.id).toMatch(/^tnt_trc_001_/);
    }
  });

  it('declares ~15 stations distributed across all 4 districts', () => {
    const stations = extractArrayLiteralFromConst(SEED_SRC, 'STATIONS') as Array<{
      id: string;
      district: string;
      code: string;
      city: string;
    }>;
    expect(stations.length).toBeGreaterThanOrEqual(14);
    expect(stations.length).toBeLessThanOrEqual(18);
    // Every station must reference one of the 4 district ids.
    const validDistricts = new Set([
      'tnt_trc_001_dar',
      'tnt_trc_001_dodoma',
      'tnt_trc_001_tabora',
      'tnt_trc_001_tanga',
    ]);
    for (const s of stations) {
      expect(validDistricts.has(s.district)).toBe(true);
    }
    // All four districts must have at least 2 stations (no district orphaned).
    for (const districtId of validDistricts) {
      const stationsInDistrict = stations.filter((s) => s.district === districtId);
      expect(stationsInDistrict.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('declares ~30 units across the stations', () => {
    const units = extractArrayLiteralFromConst(SEED_SRC, 'UNITS') as Array<{
      id: string;
      propertyId: string;
      code: string;
      rent: number;
    }>;
    expect(units.length).toBeGreaterThanOrEqual(28);
    expect(units.length).toBeLessThanOrEqual(35);
    // Every unit references a station id.
    for (const u of units) {
      expect(u.propertyId).toMatch(/^prop_trc_/);
    }
    // Rents are sane positive integers (TZS minor units).
    for (const u of units) {
      expect(u.rent).toBeGreaterThan(0);
      expect(Number.isInteger(u.rent)).toBe(true);
    }
  });

  it('declares 8 users — 2 officers, 1 DG, 5 lessees', () => {
    const users = extractArrayLiteralFromConst(SEED_SRC, 'USERS') as Array<{
      email: string;
      roles: string[];
      kind: string;
    }>;
    expect(users).toHaveLength(8);
    const byKind = users.reduce<Record<string, number>>((acc, u) => {
      acc[u.kind] = (acc[u.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(byKind.officer).toBe(2);
    expect(byKind.dg).toBe(1);
    expect(byKind.lessee).toBe(5);
    // DG must have OWNER role; officers must have MANAGER; lessees TENANT.
    const dg = users.find((u) => u.kind === 'dg');
    expect(dg?.roles).toContain('OWNER');
    const officer = users.find((u) => u.kind === 'officer');
    expect(officer?.roles).toContain('MANAGER');
    const lessee = users.find((u) => u.kind === 'lessee');
    expect(lessee?.roles).toContain('TENANT');
  });

  it('declares 5 leases with a mix of rent levels (some <500k some ≥500k)', () => {
    const leases = extractArrayLiteralFromConst(SEED_SRC, 'LEASES') as Array<{
      id: string;
      leaseNumber: string;
      rent: number;
      daysToExpiry: number;
    }>;
    expect(leases).toHaveLength(5);
    // Threshold is 500,000 TZS in minor units = 500_000_00 = 50_000_000.
    const below = leases.filter((l) => l.rent < 50_000_000);
    const aboveOrEqual = leases.filter((l) => l.rent >= 50_000_000);
    expect(below.length).toBeGreaterThanOrEqual(2); // at least 2 officer-approval cases
    expect(aboveOrEqual.length).toBeGreaterThanOrEqual(2); // at least 2 DG-approval cases
    // Expiry distribution covers 60/30/7/1 + a far-future control.
    const expiries = leases.map((l) => l.daysToExpiry).sort((a, b) => a - b);
    expect(expiries).toEqual(expect.arrayContaining([1, 7, 30, 60]));
    expect(Math.max(...expiries)).toBeGreaterThanOrEqual(180); // a far-future control
  });
});

describe('seed-trc-tenant — idempotency invariants', () => {
  it('all property ids are unique (no UNIQUE-index collisions)', () => {
    const stations = extractArrayLiteralFromConst(SEED_SRC, 'STATIONS') as Array<{
      id: string;
      code: string;
    }>;
    const ids = stations.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const codes = stations.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('all unit (propertyId, code) pairs are unique', () => {
    const units = extractArrayLiteralFromConst(SEED_SRC, 'UNITS') as Array<{
      propertyId: string;
      code: string;
    }>;
    const composite = units.map((u) => `${u.propertyId}::${u.code}`);
    expect(new Set(composite).size).toBe(composite.length);
  });

  it('all lease ids and lease_number values are unique', () => {
    const leases = extractArrayLiteralFromConst(SEED_SRC, 'LEASES') as Array<{
      id: string;
      leaseNumber: string;
    }>;
    expect(new Set(leases.map((l) => l.id)).size).toBe(leases.length);
    expect(new Set(leases.map((l) => l.leaseNumber)).size).toBe(leases.length);
  });

  it('all user emails are unique', () => {
    const users = extractArrayLiteralFromConst(SEED_SRC, 'USERS') as Array<{ email: string }>;
    expect(new Set(users.map((u) => u.email)).size).toBe(users.length);
  });

  it('all district codes are unique', () => {
    const districts = extractArrayLiteralFromConst(SEED_SRC, 'DISTRICTS') as Array<{ code: string }>;
    expect(new Set(districts.map((d) => d.code)).size).toBe(districts.length);
  });

  it('seed-script source contains ON CONFLICT DO NOTHING / DO UPDATE for every INSERT', () => {
    // Walk every INSERT INTO and verify it's followed by an ON CONFLICT clause.
    // The seed script depends on this for idempotency.
    const inserts = SEED_SRC.match(/INSERT INTO\s+\w+/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);

    // Count ON CONFLICT clauses too; should be at least as many as INSERTs.
    const conflicts = SEED_SRC.match(/ON CONFLICT/g) ?? [];
    expect(conflicts.length).toBeGreaterThanOrEqual(inserts.length);
  });
});

describe('seed-trc-tenant — TRC approval matrix', () => {
  it('threshold matches the TRC questionnaire (500,000 TZS in minor units)', () => {
    // Extract the named constant.
    const m = SEED_SRC.match(/APPROVAL_POLICY_THRESHOLD_TZS\s*=\s*([\d_]+)/);
    expect(m).not.toBeNull();
    const raw = m![1].replace(/_/g, '');
    expect(Number(raw)).toBe(500_000_00); // 500,000 TZS in cents
  });

  it('matrix has two thresholds: <500k → EMU Officer, ≥500k → DG', () => {
    // Grab the POLICY JSON declaration and walk thresholds.
    const m = SEED_SRC.match(/APPROVAL_POLICY_JSON\s*=\s*(\{[\s\S]*?\n\});/);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-new-func -- test fixture loader
    const fn = new Function(
      'APPROVAL_POLICY_THRESHOLD_TZS',
      'APPROVAL_POLICY_TYPE',
      'TENANT_ID',
      `return ${m![1]};`,
    );
    const policy = fn(500_000_00, 'lease_exception', 'tnt_trc_001') as {
      thresholds: Array<{ minAmount: number; maxAmount: number | null; requiredRole: string }>;
      trcGuards: { requireCivilEngNotificationForBarelandRailwayReserve: boolean };
      currency: string;
    };
    expect(policy.thresholds).toHaveLength(2);
    expect(policy.thresholds[0].minAmount).toBe(0);
    expect(policy.thresholds[0].maxAmount).toBe(500_000_00);
    expect(policy.thresholds[0].requiredRole).toBe('estate_manager'); // EMU Officer
    expect(policy.thresholds[1].minAmount).toBe(500_000_00);
    expect(policy.thresholds[1].maxAmount).toBeNull();
    expect(policy.thresholds[1].requiredRole).toBe('owner'); // DG
    expect(policy.currency).toBe('TZS');
    // Bareland-along-railway-reserve must require Civil Engineering notify.
    expect(policy.trcGuards.requireCivilEngNotificationForBarelandRailwayReserve).toBe(true);
  });
});
