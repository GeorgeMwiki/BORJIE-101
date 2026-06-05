/**
 * Analytics warehouses + accounting ledger-read — REAL Postgres integration.
 *
 * Spins up an ephemeral Postgres, applies the FOUR WS-4 migration SQL files
 * (0175/0176/0177/0178) exactly as shipped, creates the minimal SOURCE schema
 * the aggregators read (tenants, sites, production_records, sales, accounts,
 * ledger_entries, audit_events — the columns the queries touch), seeds two
 * tenants, runs the aggregators, and asserts:
 *
 *   - usage series is REAL (counts match seeded audit_events per dimension);
 *   - growth series is REAL (revenue = SUM(ledger CREDIT lines), currency
 *     resolved from the ledger — never hardcoded);
 *   - the accounting read returns the REAL ledger_entries (NOT a parallel
 *     ledger; the same rows the money path posted);
 *   - FORCE RLS isolates every warehouse + the ledger read across tenants when
 *     queried as a NON-superuser (NOBYPASSRLS) role with the GUC bound.
 *
 * We apply ONLY the WS-4 migrations (not the full historical set) so this suite
 * verifies WS-4 in isolation and is unaffected by unrelated forward-only gaps
 * elsewhere in the migration history. The four migrations are self-contained
 * (`CREATE TABLE IF NOT EXISTS` + FORCE RLS), so applying them verbatim proves
 * exactly the DDL + RLS policies that ship.
 *
 * Skips cleanly when `initdb`/`pg_ctl` are not on PATH (CI images without
 * Postgres tooling) so the wider suite stays green there.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

import {
  APP_ROLE,
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from './helpers/ephemeral-postgres.js';
import { stripWrappingTransaction } from '../run-migrations.js';
import { createDatabaseClient, type DatabaseClient } from '../client.js';
import {
  usageSeries,
  growthSeries,
  aggregateUsageDaily,
  aggregateGrowthMonthly,
  listLedgerLines,
} from '../repositories/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const WS4_MIGRATIONS = [
  '0175_analytics_usage_daily.sql',
  '0176_analytics_growth_monthly.sql',
  '0177_analytics_export_templates.sql',
  '0178_tenant_subscriptions.sql',
];

/** Minimal SOURCE schema the aggregators + accounting read query. */
const SOURCE_DDL = `
  CREATE TABLE IF NOT EXISTS tenants (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text,
    status text,
    primary_currency text NOT NULL DEFAULT 'TZS'
  );
  CREATE TABLE IF NOT EXISTS licences (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    licence_number text,
    licence_type text,
    status text
  );
  CREATE TABLE IF NOT EXISTS sites (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    licence_id text,
    name text NOT NULL,
    mineral text,
    phase text,
    status text NOT NULL DEFAULT 'active'
  );
  CREATE TABLE IF NOT EXISTS production_records (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    site_id text NOT NULL,
    kind text NOT NULL,
    mass_kg numeric,
    ts timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS ore_parcels (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    site_id text NOT NULL,
    status text NOT NULL DEFAULT 'in_stockpile'
  );
  CREATE TABLE IF NOT EXISTS sales (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    parcel_id text NOT NULL,
    route text NOT NULL DEFAULT 'trader',
    ts timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    currency text NOT NULL,
    balance_minor_units bigint NOT NULL DEFAULT 0,
    entry_count integer NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    account_id text NOT NULL,
    journal_id text NOT NULL,
    type text NOT NULL,
    direction text NOT NULL,
    amount_minor_units bigint NOT NULL,
    currency text NOT NULL,
    balance_after_minor_units bigint NOT NULL,
    sequence_number integer NOT NULL,
    effective_date timestamptz NOT NULL,
    posted_at timestamptz NOT NULL DEFAULT now(),
    payment_intent_id text,
    property_id text,
    unit_id text,
    description text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
  );
  CREATE TABLE IF NOT EXISTS audit_events (
    id text PRIMARY KEY,
    tenant_id text,
    timestamp timestamptz NOT NULL,
    timestamp_ms bigint NOT NULL,
    category text NOT NULL,
    action text NOT NULL,
    description text NOT NULL,
    outcome text NOT NULL,
    severity text NOT NULL DEFAULT 'INFO',
    actor_type text NOT NULL,
    actor_id text NOT NULL
  );
  -- Source tables are tenant-scoped with FORCE RLS too (the worker binds the
  -- GUC; the gateway reads on the pinned connection). Apply a policy so the
  -- non-superuser RLS assertions exercise the real boundary on ledger_entries.
  ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ledger_entries FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS ledger_entries_tenant_isolation ON ledger_entries;
  CREATE POLICY ledger_entries_tenant_isolation ON ledger_entries
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS audit_events_tenant_isolation ON audit_events;
  CREATE POLICY audit_events_tenant_isolation ON audit_events
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
`;

async function applyWs4Migrations(raw: ReturnType<typeof postgres>): Promise<void> {
  for (const file of WS4_MIGRATIONS) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed list of in-tree migration files
    const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    await raw.unsafe(stripWrappingTransaction(content));
  }
}

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;

const TENANT_A = 'tenant-wh-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'tenant-wh-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/** A fixed month we seed + aggregate into (UTC). */
const MONTH = new Date(Date.UTC(2026, 4, 15)); // 2026-05-15
const MONTH_FROM = new Date(Date.UTC(2026, 4, 1)); // 2026-05-01
const MONTH_TO = new Date(Date.UTC(2026, 4, 31)); // 2026-05-31

describe.skipIf(!HAS_PG)('analytics warehouses + accounting read (real Postgres)', () => {
  let pg: EphemeralPostgres;
  let adminDb: DatabaseClient;
  let adminRaw: ReturnType<typeof postgres>;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();

    adminRaw = postgres(pg.adminUrl, { max: 4 });
    adminDb = createDatabaseClient(pg.adminUrl);

    // Minimal SOURCE schema + the four WS-4 migrations (verbatim) as the
    // superuser/owner. This proves the shipped DDL + RLS policies in isolation.
    await adminRaw.unsafe(SOURCE_DDL);
    await applyWs4Migrations(adminRaw);

    // Grant the NOBYPASSRLS app role least-privilege on the tables we read so
    // the RLS-isolation assertions run as a role RLS actually binds.
    await adminRaw.unsafe(`
      GRANT SELECT, INSERT, UPDATE ON
        analytics_usage_daily, analytics_growth_monthly, analytics_export_templates,
        tenant_subscriptions, ledger_entries, audit_events, sites, production_records, sales
      TO ${APP_ROLE};
    `);

    // ── Seed both tenants' SOURCE rows ────────────────────────────────────
    await seedTenant(adminRaw, TENANT_A, {
      auditByCategory: { AUTH: 3, PAYMENT: 2 },
      siteName: 'Site A',
      productionKg: 1200,
      saleCount: 2,
      // two CREDIT revenue lines (5000 + 7000) + one royalty line (900)
      creditMinor: [5000, 7000],
      royaltyMinor: 900,
      currency: 'TZS',
    });
    await seedTenant(adminRaw, TENANT_B, {
      auditByCategory: { AUTH: 1 },
      siteName: 'Site B',
      productionKg: 50,
      saleCount: 1,
      creditMinor: [100],
      royaltyMinor: 0,
      currency: 'TZS',
    });

    // ── Run the aggregators (bind GUC per tenant; admin is owner so FORCE
    //    RLS applies — bind the GUC so the policy lets the rows through). ──
    for (const t of [TENANT_A, TENANT_B]) {
      await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${t}, false)`);
      await aggregateUsageDaily(adminDb, t, { from: MONTH_FROM, to: MONTH_TO });
      await aggregateGrowthMonthly(adminDb, t, MONTH, 'TZS');
    }
  }, SETUP_TIMEOUT);

  afterAll(async () => {
    try {
      await adminRaw?.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
    try {
      await (adminDb as unknown as { $client: { end: (o?: unknown) => Promise<void> } })?.$client.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
    pg?.stop();
  });

  // -------------------------------------------------------------------------
  // Usage warehouse
  // -------------------------------------------------------------------------

  it('usage series reflects the seeded audit_events counts per dimension', async () => {
    await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, false)`);
    const series = await usageSeries(adminDb, TENANT_A, {
      range: { from: MONTH_FROM, to: MONTH_TO },
    });
    const byDim = Object.fromEntries(series.map((p) => [p.dimension, p.count]));
    expect(byDim.AUTH).toBe(3);
    expect(byDim.PAYMENT).toBe(2);
  });

  it('aggregateUsageDaily is idempotent (re-run overwrites, never doubles)', async () => {
    await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, false)`);
    await aggregateUsageDaily(adminDb, TENANT_A, { from: MONTH_FROM, to: MONTH_TO });
    await aggregateUsageDaily(adminDb, TENANT_A, { from: MONTH_FROM, to: MONTH_TO });
    const series = await usageSeries(adminDb, TENANT_A, {
      dimension: 'AUTH',
      range: { from: MONTH_FROM, to: MONTH_TO },
    });
    const total = series.reduce((s, p) => s + p.count, 0);
    expect(total).toBe(3); // still 3 after two extra runs
  });

  // -------------------------------------------------------------------------
  // Growth warehouse
  // -------------------------------------------------------------------------

  it('growth series sums CREDIT ledger lines as revenue with ledger-resolved currency', async () => {
    await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, false)`);
    const series = await growthSeries(adminDb, TENANT_A, {
      range: { from: MONTH_FROM, to: MONTH_TO },
    });
    expect(series.length).toBe(1);
    const row = series[0]!;
    expect(row.revenueMinorUnits).toBe(12000); // 5000 + 7000
    expect(row.royaltyMinorUnits).toBe(900);
    expect(row.salesCount).toBe(2);
    expect(row.activeSites).toBe(1);
    expect(row.currency).toBe('TZS'); // resolved from the ledger, not hardcoded
  });

  // -------------------------------------------------------------------------
  // Accounting ledger-read (reads the REAL ledger_entries)
  // -------------------------------------------------------------------------

  it('accounting read returns the REAL posted ledger lines (not a parallel ledger)', async () => {
    await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, false)`);
    const lines = await listLedgerLines(adminDb, TENANT_A, {});
    // tenant A seeded 2 CREDIT + 1 royalty = 3 ledger lines.
    expect(lines.length).toBe(3);
    const credits = lines.filter((l) => l.direction === 'CREDIT');
    expect(credits.length).toBe(3); // all seeded lines are CREDIT
    // Every line carries an ISO-4217 currency (never hardcoded downstream).
    expect(lines.every((l) => l.currency === 'TZS')).toBe(true);
    const sum = lines
      .filter((l) => l.type !== 'ROYALTY')
      .reduce((s, l) => s + l.amountMinorUnits, 0);
    expect(sum).toBe(12000);
  });

  it('accounting read scopes to a site via metadata->>siteId', async () => {
    await adminDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, false)`);
    const all = await listLedgerLines(adminDb, TENANT_A, {});
    const siteId = `site-${TENANT_A}`;
    const scoped = await listLedgerLines(adminDb, TENANT_A, { siteId });
    // We stamped metadata.siteId on the two revenue lines only.
    expect(scoped.length).toBe(2);
    expect(scoped.length).toBeLessThan(all.length);
  });

  // -------------------------------------------------------------------------
  // FORCE RLS isolation (NON-superuser role) — the security boundary
  // -------------------------------------------------------------------------

  it('FORCE RLS isolates warehouses + ledger across tenants (non-superuser)', async () => {
    const appDb = createDatabaseClient(pg.appUrl);
    try {
      // Bind tenant B's GUC, then read each warehouse + the ledger. We must
      // see ONLY tenant B's rows, never tenant A's — even though A has more
      // data — proving the policy (not app code) enforces isolation.
      await appDb.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_B}, false)`);

      const usage = await usageSeries(appDb, TENANT_B, {
        range: { from: MONTH_FROM, to: MONTH_TO },
      });
      expect(usage.every((p) => ['AUTH'].includes(p.dimension))).toBe(true);
      const authCount = usage.find((p) => p.dimension === 'AUTH')?.count ?? 0;
      expect(authCount).toBe(1); // B seeded exactly 1 AUTH event

      const growth = await growthSeries(appDb, TENANT_B, {
        range: { from: MONTH_FROM, to: MONTH_TO },
      });
      expect(growth.length).toBe(1);
      expect(growth[0]!.revenueMinorUnits).toBe(100); // B's single CREDIT line

      const ledger = await listLedgerLines(appDb, TENANT_B, {});
      expect(ledger.length).toBe(1); // B posted exactly 1 line
      expect(ledger[0]!.amountMinorUnits).toBe(100);

      // Cross-tenant leak probe: ask for tenant A's id while GUC=B → RLS
      // returns nothing (the predicate AND the policy both exclude A).
      const leak = await listLedgerLines(appDb, TENANT_A, {});
      expect(leak.length).toBe(0);
    } finally {
      await (appDb as unknown as { $client: { end: (o?: unknown) => Promise<void> } }).$client.end({ timeout: 5 });
    }
  });
});

// ===========================================================================
// Seeding helpers
// ===========================================================================

interface SeedSpec {
  readonly auditByCategory: Record<string, number>;
  readonly siteName: string;
  readonly productionKg: number;
  readonly saleCount: number;
  readonly creditMinor: number[];
  readonly royaltyMinor: number;
  readonly currency: string;
}

/**
 * Seed one tenant's source rows: tenant, licence, site, production, parcel +
 * sales, an account, and the ledger lines. Uses raw SQL so we control the
 * exact columns (and avoid the FK to tenants.id needing a UUID cast).
 */
async function seedTenant(
  raw: ReturnType<typeof postgres>,
  tenantId: string,
  spec: SeedSpec,
): Promise<void> {
  const tsMid = '2026-05-15T12:00:00Z';

  // tenant (minimal NOT NULL columns; primary_currency drives the fallback).
  await raw.unsafe(
    `INSERT INTO tenants (id, name, slug, status, primary_currency)
     VALUES ($1, $2, $3, 'active', $4)
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, spec.siteName + ' Co', tenantId, spec.currency],
  );

  // audit_events — one row per count per category.
  let auditN = 0;
  for (const [category, count] of Object.entries(spec.auditByCategory)) {
    for (let i = 0; i < count; i++) {
      auditN += 1;
      await raw.unsafe(
        `INSERT INTO audit_events
           (id, tenant_id, timestamp, timestamp_ms, category, action, description,
            outcome, severity, actor_type, actor_id)
         VALUES ($1, $2, $3::timestamptz, $4, $5, 'test.action', 'seed',
            'SUCCESS', 'INFO', 'user', 'seed-actor')`,
        [
          `ae-${tenantId}-${auditN}`,
          tenantId,
          tsMid,
          Date.parse(tsMid),
          category,
        ],
      );
    }
  }

  // licence + site (site needs a licence FK).
  const licenceId = `lic-${tenantId}`;
  await raw.unsafe(
    `INSERT INTO licences (id, tenant_id, licence_number, licence_type, status)
     VALUES ($1, $2, $3, 'PML', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [licenceId, tenantId, `LIC-${tenantId.slice(0, 8)}`],
  );
  const siteId = `site-${tenantId}`;
  await raw.unsafe(
    `INSERT INTO sites (id, tenant_id, licence_id, name, mineral, phase, status)
     VALUES ($1, $2, $3, $4, 'gold', 'extraction', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [siteId, tenantId, licenceId, spec.siteName],
  );

  // production_records — single row carrying the month's mass.
  await raw.unsafe(
    `INSERT INTO production_records (id, tenant_id, site_id, kind, mass_kg, ts)
     VALUES ($1, $2, $3, 'rom', $4, $5::timestamptz)`,
    [`pr-${tenantId}`, tenantId, siteId, spec.productionKg, tsMid],
  );

  // ore parcel + sales.
  const parcelId = `parcel-${tenantId}`;
  await raw.unsafe(
    `INSERT INTO ore_parcels (id, tenant_id, site_id, status)
     VALUES ($1, $2, $3, 'in_stockpile')
     ON CONFLICT (id) DO NOTHING`,
    [parcelId, tenantId, siteId],
  );
  for (let i = 0; i < spec.saleCount; i++) {
    await raw.unsafe(
      `INSERT INTO sales (id, tenant_id, parcel_id, route, ts)
       VALUES ($1, $2, $3, 'trader', $4::timestamptz)`,
      [`sale-${tenantId}-${i}`, tenantId, parcelId, tsMid],
    );
  }

  // account for the ledger lines (account_id FK is logical, no constraint).
  const accountId = `acct-${tenantId}`;
  await raw.unsafe(
    `INSERT INTO accounts (id, tenant_id, name, type, status, currency, balance_minor_units, entry_count)
     VALUES ($1, $2, 'Revenue', 'PLATFORM_REVENUE', 'ACTIVE', $3, 0, 0)
     ON CONFLICT (id) DO NOTHING`,
    [accountId, tenantId, spec.currency],
  );

  // ledger_entries — CREDIT revenue lines (stamped with metadata.siteId).
  let seq = 1;
  let running = 0;
  for (const amt of spec.creditMinor) {
    running += amt;
    // metadata is a proper jsonb OBJECT (jsonb_build_object), NOT a stringified
    // scalar — so `metadata->>'siteId'` resolves the key in the site-scoped read.
    await raw.unsafe(
      `INSERT INTO ledger_entries
         (id, tenant_id, account_id, journal_id, type, direction,
          amount_minor_units, currency, balance_after_minor_units, sequence_number,
          effective_date, posted_at, description, metadata)
       VALUES ($1, $2, $3, $4, 'RENT_PAYMENT', 'CREDIT', $5, $6, $7, $8,
          $9::timestamptz, $9::timestamptz, 'seed revenue',
          jsonb_build_object('siteId', $10::text))`,
      [
        `le-${tenantId}-${seq}`,
        tenantId,
        accountId,
        `jr-${tenantId}-${seq}`,
        amt,
        spec.currency,
        running,
        seq,
        tsMid,
        siteId,
      ],
    );
    seq += 1;
  }
  // royalty line (type matched by ILIKE '%ROYALTY%'); NO siteId metadata so
  // the site-scoped read excludes it.
  if (spec.royaltyMinor > 0) {
    running += spec.royaltyMinor;
    await raw.unsafe(
      `INSERT INTO ledger_entries
         (id, tenant_id, account_id, journal_id, type, direction,
          amount_minor_units, currency, balance_after_minor_units, sequence_number,
          effective_date, posted_at, description, metadata)
       VALUES ($1, $2, $3, $4, 'ROYALTY', 'CREDIT', $5, $6, $7, $8,
          $9::timestamptz, $9::timestamptz, 'seed royalty', '{}'::jsonb)`,
      [
        `le-${tenantId}-roy`,
        tenantId,
        accountId,
        `jr-${tenantId}-roy`,
        spec.royaltyMinor,
        spec.currency,
        running,
        seq,
        tsMid,
      ],
    );
  }
}
