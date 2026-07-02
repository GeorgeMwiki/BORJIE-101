/**
 * 0371 — benchmark + market reference data (scanner ground truth) — REAL Postgres.
 *
 * WHAT THIS PROVES (the false-green this migration kills)
 * ───────────────────────────────────────────────────────
 * The risk- and opportunity-scanner resolvers read a set of REFERENCE / MARKET
 * tables. Two failure modes made those reads return NULL on the live path:
 *
 *   1. external_benchmarks / peer_cohort_aggregates existed (migration 0095)
 *      but were seeded under DIFFERENT metric_ids than the scanners query
 *      (`gold_am_usd_per_oz` vs the scanner's `lbma_am_usd_per_oz`;
 *      `fuel_consumption_l_per_t` vs `fuel_litres_per_tonne`). The live scanner
 *      read the CORRECT metric_ids and got zero rows.
 *   2. bot_gold_windows / lbma_fix_summary / fx_rates_intraday never shipped —
 *      those market slices always degraded to null.
 *
 * 0371 additively seeds the correct metric_ids AND creates+seeds the three
 * market tables. This test asserts the EXACT queries the resolvers run now
 * return REAL, non-placeholder values.
 *
 * It also proves the RLS posture on the three NEW market tables: reads are open
 * (global reference data) but a NON-service-role tenant session CANNOT write
 * (a tenant writing a market fix would poison every tenant's scanner), while a
 * service-role session CAN. Proven against a NOBYPASSRLS role so FORCE RLS
 * actually binds.
 *
 * Skips cleanly when initdb/pg_ctl are absent — the static assertions always run.
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
const MIG_0095 = '0095_peer_cohort_benchmarks.sql';
const MIG_0371 = '0371_benchmark_market_reference.sql';

async function migrationBody(file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed in-tree migration file
  const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  return stripWrappingTransaction(content);
}

// The metric_ids the SCANNERS actually query (from resolver.ts / scanner.ts).
const SCANNER_BENCHMARK_METRICS = [
  'diesel_tzs_per_litre',
  'lbma_am_usd_per_oz',
  'veta_apprenticeship_subsidy_tzs',
  'ica_cert_per_cert_fee_tzs',
  'tib_borrower_rate_tier_b_pct',
  'bot_91d_tbill_yield_pct',
  'carbon_credit_tzs_per_hectare_per_year',
];

// ---------------------------------------------------------------------------
// Static assertions — always run, even without Postgres tooling.
// ---------------------------------------------------------------------------

describe('0371 migration static shape', () => {
  it('seeds every metric_id the scanners read + creates the three market tables', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0371), 'utf-8');

    for (const metric of SCANNER_BENCHMARK_METRICS) {
      expect(sql).toContain(`'${metric}'`);
    }
    // Fuel peer p25 metric_id the fuel slice reads.
    expect(sql).toContain("'fuel_litres_per_tonne'");

    // The three market tables are created.
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS bot_gold_windows');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS lbma_fix_summary');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS fx_rates_intraday');

    // FORCE RLS + service-role-only write posture on the new tables. The
    // policy is built via format() so the GUC name appears doubled-quoted
    // inside the DDL string literal — the live RLS test below proves the
    // resulting policy actually gates writes.
    expect(sql).toContain('FORCE  ROW LEVEL SECURITY');
    expect(sql).toContain("''app.is_service_role''");
    expect(sql).toContain('_write_service_role');
    // Additive seed — never disturbs the 0095 rows.
    expect(sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('never fabricates values — no random generation, no placeholder numbers', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0371), 'utf-8');
    // No runtime-random VALUE generation (gen_random_uuid for PKs is fine —
    // that is an id, not a fabricated market figure).
    expect(sql).not.toMatch(/random\(\)/i);
    expect(sql).not.toMatch(/Math\.random/i);
    // No lazy placeholder sentinels.
    expect(sql).not.toContain('99999');
    expect(sql).not.toContain('123456');
  });
});

// ---------------------------------------------------------------------------
// Live reality + RLS — real Postgres, non-superuser NOBYPASSRLS app role.
// ---------------------------------------------------------------------------

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;

describe.skipIf(!HAS_PG)(
  '0371 benchmark/market reference — reality + RLS (real Postgres)',
  () => {
    let pg: EphemeralPostgres;

    beforeAll(async () => {
      pg = await startEphemeralPostgres();
      const admin = postgres(pg.adminUrl, { max: 1 });
      try {
        // 0095 owns external_benchmarks + peer_cohort_aggregates; 0371 is additive.
        await admin.unsafe(await migrationBody(MIG_0095));
        await admin.unsafe(await migrationBody(MIG_0371));
        // Idempotency — re-apply is a clean no-op.
        await admin.unsafe(await migrationBody(MIG_0371));

        // The app role reads everything; can write ONLY via the market tables'
        // RLS write-policy (service-role). Grant table privileges so RLS — not
        // a missing GRANT — is what gates the write.
        await admin.unsafe(`
          GRANT SELECT ON external_benchmarks, peer_cohort_aggregates,
            bot_gold_windows, lbma_fix_summary, fx_rates_intraday TO borjie_app;
          GRANT INSERT, UPDATE, DELETE ON
            bot_gold_windows, lbma_fix_summary, fx_rates_intraday TO borjie_app;
        `);
      } finally {
        await admin.end({ timeout: 5 });
      }
    }, SETUP_TIMEOUT);

    afterAll(() => {
      pg?.stop();
    });

    /** Run `body` inside a tx that binds the tenant + service-role GUCs. */
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

    // ── Reality: the exact scanner queries return REAL non-null values ──

    it('external_benchmarks returns REAL values for every scanner metric_id', async () => {
      for (const metric of SCANNER_BENCHMARK_METRICS) {
        const rows = await asSession('tenantA', false, (tx) =>
          tx.unsafe(
            `SELECT value::numeric AS v FROM external_benchmarks
              WHERE metric_id = '${metric}'
              ORDER BY as_of DESC LIMIT 1`,
          ),
        );
        const value = Number((rows[0] as unknown as { v: unknown })?.v);
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    });

    it('the LBMA metric carries a real 30-row-capable series (mean/stdev computable)', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT value::numeric AS v FROM external_benchmarks
            WHERE metric_id = 'lbma_am_usd_per_oz'
            ORDER BY as_of DESC LIMIT 30`,
        ),
      );
      const fixes = rows
        .map((r) => Number((r as unknown as { v: unknown }).v))
        .filter((n) => n > 0);
      // Enough points for a meaningful rolling stdev, and realistic gold band.
      expect(fixes.length).toBeGreaterThanOrEqual(5);
      for (const f of fixes) {
        expect(f).toBeGreaterThan(1000);
        expect(f).toBeLessThan(10000);
      }
    });

    it('peer_cohort_aggregates returns a real p25 for the fuel metric the slice reads', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT percentile_p25::numeric AS p25 FROM peer_cohort_aggregates
            WHERE metric_id = 'fuel_litres_per_tonne'
            ORDER BY computed_at DESC LIMIT 1`,
        ),
      );
      const p25 = Number((rows[0] as unknown as { p25: unknown })?.p25);
      expect(Number.isFinite(p25)).toBe(true);
      expect(p25).toBeGreaterThan(0);
    });

    it('bot_gold_windows exposes a window that is OPEN right now (opp FX slice query)', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT is_open::bool AS open FROM bot_gold_windows
            WHERE NOW() BETWEEN starts_at AND ends_at
            ORDER BY starts_at DESC LIMIT 1`,
        ),
      );
      expect(Boolean((rows[0] as unknown as { open: unknown })?.open)).toBe(true);
    });

    it('lbma_fix_summary computes a real sigma delta (risk market slice query)', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT ((current_fix - mean_30d) / NULLIF(std_30d, 0))::numeric AS sigma
             FROM lbma_fix_summary
            WHERE asset = 'gold'
            ORDER BY captured_at DESC LIMIT 1`,
        ),
      );
      const sigma = Number((rows[0] as unknown as { sigma: unknown })?.sigma);
      expect(Number.isFinite(sigma)).toBe(true);
    });

    it('fx_rates_intraday computes a real intraday volatility % (risk market slice query)', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT (intraday_high - intraday_low) / NULLIF(intraday_low, 0) * 100 AS vol
             FROM fx_rates_intraday
            WHERE pair = 'USD/TZS'
            ORDER BY captured_at DESC LIMIT 1`,
        ),
      );
      const vol = Number((rows[0] as unknown as { vol: unknown })?.vol);
      expect(Number.isFinite(vol)).toBe(true);
      expect(vol).toBeGreaterThanOrEqual(0);
    });

    // ── RLS: reads open, writes service-role only ──

    it('a tenant session READS the global market tables', async () => {
      const rows = await asSession('tenantA', false, (tx) =>
        tx.unsafe(`SELECT COUNT(*)::int AS n FROM bot_gold_windows`),
      );
      expect(Number((rows[0] as unknown as { n: unknown }).n)).toBeGreaterThan(0);
    });

    it('REJECTS a non-service-role tenant session WRITING to a market table', async () => {
      await expect(
        asSession('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO lbma_fix_summary (asset, current_fix, mean_30d, std_30d)
             VALUES ('gold', 1.0, 1.0, 0.0)`,
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asSession('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO fx_rates_intraday
              (pair, intraday_open, intraday_high, intraday_low, intraday_close)
             VALUES ('USD/TZS', 1, 1, 1, 1)`,
          ),
        ),
      ).rejects.toThrow();

      await expect(
        asSession('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO bot_gold_windows (window_name, is_open, starts_at, ends_at)
             VALUES ('rogue', true, NOW(), NOW() + INTERVAL '1 day')`,
          ),
        ),
      ).rejects.toThrow();
    });

    it('ALLOWS a service-role session to WRITE market reference data', async () => {
      await asSession('tenantA', true, (tx) =>
        tx.unsafe(
          `INSERT INTO lbma_fix_summary (asset, current_fix, mean_30d, std_30d)
           VALUES ('silver', 32.5, 31.0, 1.2)`,
        ),
      );
      const rows = await asSession('tenantB', false, (tx) =>
        tx.unsafe(
          `SELECT current_fix::numeric AS f FROM lbma_fix_summary
            WHERE asset = 'silver' LIMIT 1`,
        ),
      );
      expect(Number((rows[0] as unknown as { f: unknown })?.f)).toBeGreaterThan(0);
    });
  },
);
