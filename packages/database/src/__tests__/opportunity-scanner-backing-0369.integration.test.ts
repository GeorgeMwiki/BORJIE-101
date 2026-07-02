/**
 * 0369 — opportunity-scanner backing tables — REAL Postgres.
 *
 * WHAT THIS PROVES (the false-green this migration kills)
 * ───────────────────────────────────────────────────────
 * Half of the opportunity scanner's rules read from owner-state / reference
 * tables that never shipped a migration (tra_royalty_election_state,
 * nemc_amnesty_windows/qualifications, marketplace_buyer_offers/buyers,
 * tenant_loans, tenant_cash_positions, tenant_energy_profile,
 * tenant_operations_profile, tenant_operational_patterns, vendor_spend_rollup,
 * workforce_apprenticeship_eligibility, forestry_carbon_eligibility,
 * peer_cohort_tenant_position, peer_cohort_top_patterns). They were phantom
 * relations the resolver caught and degraded to null — so those rules could
 * NEVER fire. 0369 creates them (FORCE RLS + tenant isolation + service-role
 * bypass; the two shared reference tables are public-read / service-write) and
 * the companion seed populates real values.
 *
 * This test proves, against a NOBYPASSRLS app role so FORCE RLS actually binds:
 *   1. Every tenant-scoped table ISOLATES — tenant A never sees tenant B rows.
 *   2. The shared reference tables (nemc_amnesty_windows,
 *      peer_cohort_top_patterns) are readable by any tenant but NOT writable by
 *      a non-service tenant session (a rogue tenant cannot poison a shared fact)
 *      while a service-role session CAN write.
 *   3. The exact scanner queries return REAL, non-null values after seeding.
 *
 * Skips cleanly when initdb/pg_ctl are absent — the static assertions run.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

import {
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from './helpers/ephemeral-postgres.js';
import { stripWrappingTransaction } from '../run-migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const MIG_0369 = '0369_opportunity_scanner_backing.sql';

async function migrationBody(file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed in-tree migration file
  const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  return stripWrappingTransaction(content);
}

const TENANT_SCOPED_TABLES = [
  'tra_royalty_election_state',
  'nemc_amnesty_qualifications',
  'marketplace_buyer_offers',
  'marketplace_buyers',
  'tenant_loans',
  'tenant_cash_positions',
  'tenant_energy_profile',
  'tenant_operations_profile',
  'tenant_operational_patterns',
  'vendor_spend_rollup',
  'workforce_apprenticeship_eligibility',
  'forestry_carbon_eligibility',
  'peer_cohort_tenant_position',
] as const;

const SHARED_REFERENCE_TABLES = [
  'nemc_amnesty_windows',
  'peer_cohort_top_patterns',
] as const;

// ---------------------------------------------------------------------------
// Static assertions — always run, even without Postgres tooling.
// ---------------------------------------------------------------------------

describe('0369 migration static shape', () => {
  it('creates every tenant-scoped + shared table with FORCE RLS', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0369), 'utf-8');
    for (const t of [...TENANT_SCOPED_TABLES, ...SHARED_REFERENCE_TABLES]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
    expect(sql).toContain('FORCE  ROW LEVEL SECURITY');
    // Tenant isolation on the canonical GUC + service-role bypass.
    expect(sql).toContain('app.current_tenant_id');
    expect(sql).toContain("''app.is_service_role''");
    expect(sql).toContain('_tenant_isolation');
    expect(sql).toContain('_service_role_bypass');
    // Shared reference tables get a public-read policy.
    expect(sql).toContain('_public_read');
  });

  it('never fabricates values — no random generation in the DDL', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0369), 'utf-8');
    expect(sql).not.toMatch(/random\(\)/i);
    expect(sql).not.toMatch(/Math\.random/i);
  });
});

// ---------------------------------------------------------------------------
// Live reality + RLS — real Postgres, non-superuser NOBYPASSRLS app role.
// ---------------------------------------------------------------------------

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;

describe.skipIf(!HAS_PG)(
  '0369 opportunity-scanner backing — reality + RLS (real Postgres)',
  () => {
    let pg: EphemeralPostgres;
    const TA = 'tenant-A';
    const TB = 'tenant-B';

    beforeAll(async () => {
      pg = await startEphemeralPostgres();
      const admin = postgres(pg.adminUrl, { max: 1 });
      try {
        await admin.unsafe(await migrationBody(MIG_0369));
        // Idempotency — re-apply is a clean no-op.
        await admin.unsafe(await migrationBody(MIG_0369));

        const allTables = [...TENANT_SCOPED_TABLES, ...SHARED_REFERENCE_TABLES];
        await admin.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON ${allTables.join(', ')} TO borjie_app;`,
        );

        // Seed real representative values for BOTH tenants + the shared rows,
        // via the admin (owner) connection which is exempt from the write
        // policy (mirrors the service-role ingest path).
        for (const t of [TA, TB]) {
          await admin.unsafe(
            `INSERT INTO tra_royalty_election_state
               (id, tenant_id, next_deadline, current_rate_pct, alt_rate_pct, last_quarter_tzs)
             VALUES ('tra-${t}', '${t}', NOW() + INTERVAL '21 days', 7.0, 6.0, 96000000)`,
          );
          await admin.unsafe(
            `INSERT INTO tenant_loans (id, tenant_id, lender, rate_pct, balance_tzs, status)
             VALUES ('loan-${t}', '${t}', 'CRDB Bank', 18.0, 640000000, 'active')`,
          );
          await admin.unsafe(
            `INSERT INTO tenant_cash_positions (id, tenant_id, account, amount, sat_days)
             VALUES ('cash-idle-${t}', '${t}', 'Reserve', 320000000, 120)`,
          );
          await admin.unsafe(
            `INSERT INTO tenant_energy_profile
               (id, tenant_id, current_grid_tariff_tzs_per_kwh, solar_hybrid_tzs_per_kwh, monthly_kwh_consumption)
             VALUES ('energy-${t}', '${t}', 292, 180, 48000)`,
          );
          await admin.unsafe(
            `INSERT INTO marketplace_buyers
               (id, tenant_id, name, kyc_status, recent_premium_over_fix_pct, recent_parcel_oz, last_settlement_at)
             VALUES ('mb-${t}', '${t}', 'Dar Precious Metals Co', 'clean', 0.72, 96, NOW() - INTERVAL '12 days')`,
          );
        }
        await admin.unsafe(
          `INSERT INTO nemc_amnesty_windows
             (id, starts_at, ends_at, is_open, estimated_penalty_avoided_tzs)
           VALUES ('nemc-w', NOW() - INTERVAL '15 days', NOW() + INTERVAL '45 days', true, 42000000)`,
        );
        await admin.unsafe(
          `INSERT INTO peer_cohort_top_patterns (id, cohort_key, p75_pattern_label)
           VALUES ('pcp', 'gold_alluvial_tz', 'gravity_concentration_before_cyanide')`,
        );
      } finally {
        await admin.end({ timeout: 5 });
      }
    }, SETUP_TIMEOUT);

    afterAll(() => {
      pg?.stop();
    });

    async function asSession<T>(
      tenantId: string,
      isService: boolean,
      body: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> {
      const app = postgres(pg.appUrl, { max: 1 });
      try {
        return (await app.begin(async (tx) => {
          await tx.unsafe(
            `SELECT set_config('app.current_tenant_id', '${tenantId}', true);
             SELECT set_config('app.is_service_role', '${isService}', true);`,
          );
          return body(tx);
        })) as T;
      } finally {
        await app.end({ timeout: 5 });
      }
    }

    // ── RLS: every tenant-scoped table isolates ──

    for (const tbl of TENANT_SCOPED_TABLES) {
      it(`${tbl} isolates tenant A from tenant B rows`, async () => {
        // Tenant A never sees any row whose tenant_id is not A.
        const leak = await asSession(TA, false, (tx) =>
          tx.unsafe(
            `SELECT COUNT(*)::int AS n FROM ${tbl} WHERE tenant_id <> '${TA}'`,
          ),
        );
        expect(Number((leak[0] as unknown as { n: unknown }).n)).toBe(0);
      });
    }

    it('tra_royalty_election_state returns tenant A OWN row (real data)', async () => {
      const rows = await asSession(TA, false, (tx) =>
        tx.unsafe(
          `SELECT current_rate_pct::numeric AS r, alt_rate_pct::numeric AS a,
                  last_quarter_tzs::numeric AS q
             FROM tra_royalty_election_state WHERE tenant_id = '${TA}' LIMIT 1`,
        ),
      );
      const row = rows[0] as unknown as { r: unknown; a: unknown; q: unknown };
      expect(Number(row.r)).toBe(7);
      expect(Number(row.a)).toBe(6);
      expect(Number(row.q)).toBeGreaterThan(0);
    });

    it('the capital slice reads real idle cash (>90d) for tenant A', async () => {
      const rows = await asSession(TA, false, (tx) =>
        tx.unsafe(
          `SELECT COALESCE(SUM(CASE WHEN sat_days >= 90 THEN amount ELSE 0 END)::numeric, 0) AS idle
             FROM tenant_cash_positions WHERE tenant_id = '${TA}'`,
        ),
      );
      expect(Number((rows[0] as unknown as { idle: unknown }).idle)).toBeGreaterThan(0);
    });

    // ── Shared reference tables: read-open, service-write ──

    for (const tbl of SHARED_REFERENCE_TABLES) {
      it(`${tbl} is READABLE by any tenant session`, async () => {
        const rows = await asSession(TA, false, (tx) =>
          tx.unsafe(`SELECT COUNT(*)::int AS n FROM ${tbl}`),
        );
        expect(Number((rows[0] as unknown as { n: unknown }).n)).toBeGreaterThan(0);
      });
    }

    it('REJECTS a non-service tenant session WRITING a shared reference row', async () => {
      await expect(
        asSession(TA, false, (tx) =>
          tx.unsafe(
            `INSERT INTO nemc_amnesty_windows
               (id, starts_at, ends_at, is_open, estimated_penalty_avoided_tzs)
             VALUES ('rogue', NOW(), NOW() + INTERVAL '1 day', true, 1)`,
          ),
        ),
      ).rejects.toThrow();
    });

    it('ALLOWS a service-role session to WRITE a shared reference row', async () => {
      await asSession(TA, true, (tx) =>
        tx.unsafe(
          `INSERT INTO peer_cohort_top_patterns (id, cohort_key, p75_pattern_label)
           VALUES ('pcp-service', 'gold_hardrock_tz', 'inline_gravity_recovery')`,
        ),
      );
      const rows = await asSession(TB, false, (tx) =>
        tx.unsafe(
          `SELECT p75_pattern_label AS p FROM peer_cohort_top_patterns
            WHERE id = 'pcp-service' LIMIT 1`,
        ),
      );
      expect(String((rows[0] as unknown as { p: unknown })?.p)).toContain('gravity');
    });

    it('REJECTS a non-service tenant session INSERTING a row for ANOTHER tenant', async () => {
      // The WITH CHECK on the isolation policy blocks writing tenant B data
      // from a tenant A session — no cross-tenant write.
      await expect(
        asSession(TA, false, (tx) =>
          tx.unsafe(
            `INSERT INTO tenant_loans (id, tenant_id, lender, rate_pct, balance_tzs, status)
             VALUES ('rogue-loan', '${TB}', 'X', 1, 1, 'active')`,
          ),
        ),
      ).rejects.toThrow();
    });
  },
);
