/**
 * Tests — resolver.ts (opportunity-scanner state resolver).
 *
 * These tests guard the three un-dark fixes on the opportunity scanner:
 *
 *   (a) RLS-DARKNESS — the brain tool must bind the `app.current_tenant_id`
 *       GUC around the resolver reads. Verified in
 *       `opportunity-scanner-tools.wiring.test.ts` (call-site). Here we
 *       assert the resolver itself is a pure read over a stub db so the
 *       binding wrapper can drive it.
 *
 *   (b) WRONG COLUMN — `external_benchmarks` is keyed by `metric_id`, NOT
 *       `benchmark_id`. A stub Postgres that rejects the legacy
 *       `benchmark_id` column proves the fuel slice returns REAL data only
 *       after the column fix (RED before → GREEN after).
 *
 *   (c) CRASH-SAFETY — a slice whose table is genuinely absent degrades to
 *       `null` for THAT slice WITHOUT throwing the whole scan; existing
 *       tables still return their real rows.
 *
 * The stub db reconstructs each query's text from drizzle's `queryChunks`
 * and behaves like a real Postgres:
 *   - a `benchmark_id` reference throws `column ... does not exist`
 *   - a query over a genuinely-missing relation throws `relation ... does not exist`
 *   - otherwise it returns the seeded rows for the target table
 */

import { describe, expect, it } from 'vitest';
import { resolveScanState, type ScanStateResolverDb } from '../resolver';
import {
  configureOpportunityScannerTools,
  opportunityScanTool,
} from '../../../composition/brain-tools/opportunity-scanner-tools';

// Tables the resolver reads for the create+seed / reference slices. Migration
// 0369 now creates every one of them and the seed populates real data (see the
// `resolveScanState — newly-real slices (0369 backing)` block + the
// opportunity-scanner-backing-0369.integration.test.ts live proof). This list
// is used ONLY by the crash-safety test to simulate a DB where a slice's table
// is genuinely absent (e.g. mid-migration / a fresh tenant with no ingest yet)
// and MUST degrade to null WITHOUT throwing the whole scan.
const MISSING_TABLES = [
  'tra_royalty_election_state',
  'nemc_amnesty_windows',
  'nemc_amnesty_qualifications',
  'marketplace_buyer_offers',
  'marketplace_buyers',
  'bot_gold_windows',
  'tenant_loans',
  'tenant_cash_positions',
  'tenant_energy_profile',
  'tenant_operations_profile',
  'vendor_spend_rollup',
  'workforce_apprenticeship_eligibility',
  'forestry_carbon_eligibility',
  'peer_cohort_tenant_position',
  'peer_cohort_top_patterns',
  'tenant_operational_patterns',
];

interface ChunkLike {
  readonly value?: ReadonlyArray<string>;
}

/** Reconstruct the SQL text from a drizzle `sql` template's queryChunks. */
function queryText(query: unknown): string {
  const chunks = (query as { queryChunks?: ReadonlyArray<unknown> })
    .queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((c) => {
      const chunk = c as ChunkLike;
      return Array.isArray(chunk?.value) ? chunk.value.join('') : '';
    })
    .join('');
}

type Seed = Record<string, ReadonlyArray<Record<string, unknown>>>;

interface StubDb extends ScanStateResolverDb {
  readonly setConfigCalls: string[];
}

/**
 * Build a stub db that mimics a FORCE-RLS Postgres closely enough to prove
 * the column + crash-safety fixes:
 *   - `set_config(...)` statements are recorded (RLS-binding proof).
 *   - a query naming `benchmark_id` throws — the legacy wrong column.
 *   - a query over a genuinely-missing table throws `relation does not exist`.
 *   - otherwise, the first EXISTING table named in the query drives the row set.
 */
function makeStubDb(seed: Seed): StubDb {
  const setConfigCalls: string[] = [];
  const execute = async (query: unknown): Promise<unknown> => {
    const text = queryText(query);

    if (text.includes('set_config')) {
      setConfigCalls.push(text);
      return { rows: [] };
    }

    // (b) legacy column — real PG rejects it.
    if (/\bbenchmark_id\b/.test(text)) {
      throw new Error('column "benchmark_id" does not exist');
    }

    // (c) genuinely-missing relation — real PG rejects it. A table listed in
    // MISSING_TABLES is only "missing" when the current seed does NOT provide
    // it: the create+seed slices seed these tables to prove they are now real,
    // while the crash-safety test leaves them unseeded to prove degrade-to-null.
    for (const missing of MISSING_TABLES) {
      if (Object.prototype.hasOwnProperty.call(seed, missing)) continue;
      const re = new RegExp(`\\b${missing}\\b`);
      if (re.test(text)) {
        throw new Error(`relation "${missing}" does not exist`);
      }
    }

    // Existing tables — return seeded rows for whichever table the query hits.
    for (const [table, rows] of Object.entries(seed)) {
      const re = new RegExp(`\\b${table}\\b`);
      if (re.test(text)) {
        return { rows };
      }
    }
    return { rows: [] };
  };
  return { execute, setConfigCalls };
}

describe('resolveScanState', () => {
  const tenantId = 'tenant-scan-1';

  it('returns REAL fuel data from existing tables (metric_id column fix)', async () => {
    const db = makeStubDb({
      shift_reports: [{ litres: 1200, tonnes: 400 }],
      peer_cohort_aggregates: [{ p25: 2.5 }],
      // external_benchmarks keyed by metric_id — reachable ONLY once the
      // resolver queries metric_id (not benchmark_id).
      external_benchmarks: [{ price: 3300, value: 3300 }],
      procurement_purchase_orders: [{ supplier_count: 2 }],
    });

    const state = await resolveScanState(db, tenantId);

    // RED before the column fix: the diesel query used `benchmark_id`, which
    // threw and nulled the WHOLE fuel slice. GREEN after: metric_id resolves,
    // so the slice returns real numbers.
    expect(state.fuel).not.toBeNull();
    expect(state.fuel?.litresPerTonneRolling30d).toBe(3); // 1200 / 400
    expect(state.fuel?.peerP25LitresPerTonne).toBe(2.5);
    expect(state.fuel?.currentDieselTzsPerLitre).toBe(3300);
    expect(state.fuel?.tonnesProducedRolling30d).toBe(400);
  });

  it('degrades a missing-table slice to null WITHOUT throwing the whole scan', async () => {
    const db = makeStubDb({
      // Only the fuel-slice tables are present; every other slice hits a
      // missing table and must degrade to null.
      shift_reports: [{ litres: 600, tonnes: 300 }],
      peer_cohort_aggregates: [{ p25: 1.9 }],
      external_benchmarks: [{ price: 3100, value: 3100 }],
      estate_entities: [{ subs: 1, has_holding: true, forestry: 0 }],
      insurance_policies: [
        {
          expires_at: new Date(Date.now() + 10 * 86_400_000).toISOString(),
          premium: 5_000_000,
        },
      ],
    });

    // Must resolve, not reject — crash-safety across ~17 absent tables.
    const state = await resolveScanState(db, tenantId);

    // Slices over genuinely-missing tables are null.
    expect(state.energy).toBeNull(); // tenant_energy_profile absent
    expect(state.tax).toBeNull(); // tra_royalty_election_state absent
    expect(state.regulator).toBeNull(); // nemc_amnesty_windows absent
    expect(state.marketplace).toBeNull(); // marketplace_buyer_offers absent
    expect(state.capital).toBeNull(); // tenant_loans absent

    // Slices over EXISTING tables still carry real data.
    expect(state.fuel).not.toBeNull();
    expect(state.fuel?.litresPerTonneRolling30d).toBe(2); // 600 / 300
    expect(state.estate).not.toBeNull();
    expect(state.estate?.subsidiaryCount).toBe(1);
    expect(state.insurance).not.toBeNull();
    expect(state.insurance?.currentAnnualPremiumTzs).toBe(5_000_000);
  });

  it('never fabricates: an empty existing table yields null-safe zero metrics', async () => {
    const db = makeStubDb({
      shift_reports: [{ litres: 0, tonnes: 0 }],
      peer_cohort_aggregates: [],
      external_benchmarks: [],
      procurement_purchase_orders: [],
    });

    const state = await resolveScanState(db, tenantId);
    expect(state.fuel).not.toBeNull();
    // No tonnes → litresPerTonne is null (never a fabricated 0-division value).
    expect(state.fuel?.litresPerTonneRolling30d).toBeNull();
    expect(state.fuel?.currentDieselTzsPerLitre).toBeNull();
    expect(state.fuel?.supplierCount).toBe(0);
  });
});

describe('mining.opportunities.scan — RLS binding (a)', () => {
  /**
   * Transaction-capable stub: `withTenantContext` binds the tenant GUC only
   * when the db exposes `.transaction`. This mirror lets the wrapper run its
   * `set_config('app.current_tenant_id', ...)` statements and records them,
   * proving the brain tool no longer reads the raw pool RLS-dark.
   */
  function makeTxDb(seed: Seed) {
    const setConfigCalls: string[] = [];
    const execute = async (query: unknown): Promise<unknown> => {
      const text = queryText(query);
      if (text.includes('set_config')) {
        setConfigCalls.push(text);
        return { rows: [] };
      }
      const inner = makeStubDb(seed);
      return inner.execute(query);
    };
    const tx = { execute };
    const db = {
      execute,
      transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> =>
        fn(tx),
    };
    return { db, setConfigCalls };
  }

  it('binds app.current_tenant_id around the resolver reads', async () => {
    const tenantId = 'tenant-rls-1';
    const { db, setConfigCalls } = makeTxDb({
      shift_reports: [{ litres: 900, tonnes: 300 }],
      peer_cohort_aggregates: [{ p25: 2.1 }],
      external_benchmarks: [{ price: 3200, value: 3200 }],
      procurement_purchase_orders: [{ supplier_count: 1 }],
    });

    configureOpportunityScannerTools({
      db: db as unknown as ScanStateResolverDb,
    });

    const result = await opportunityScanTool.handler(
      { maxResults: 3 },
      {
        tenantId,
        actorId: 'actor-1',
        personaSlug: 'T1_owner_strategist',
      },
    );

    // The wrapper must have bound the canonical tenant GUC to THIS tenant
    // before any resolver SELECT ran — otherwise the reads are RLS-dark.
    const boundTenant = setConfigCalls.some(
      (c) => c.includes('app.current_tenant_id'),
    );
    expect(boundTenant).toBe(true);
    // And the scan still produces a well-formed envelope over real data.
    expect(result.generatedAt).toEqual(expect.any(String));
    expect(Array.isArray(result.opportunities)).toBe(true);
  });
});

/**
 * Newly-real slices (migration 0369 backing).
 *
 * Each slice below reads a table that migration 0369 now CREATES and the seed
 * populates. Before this wiring the table was a phantom relation — the stub
 * would reject it (see MISSING_TABLES) and the slice degraded to null, so no
 * rule could fire. Here the stub returns the seeded rows (keyed by the exact
 * result aliases the resolver reads) and every slice returns REAL data.
 *
 * RED before 0369: these tables were in MISSING_TABLES → the slice was null.
 * GREEN after: the tables exist + carry seeded rows → real, non-null slices.
 */
describe('resolveScanState — newly-real slices (0369 backing)', () => {
  const tenantId = 'tenant-0369';

  // external_benchmarks + peer_cohort_aggregates + bot_gold_windows are the
  // reference tables the BENCH track owns; seed them so the reference-reading
  // slices are exercised too. Keyed by every alias the resolver reads.
  const referenceSeed = {
    external_benchmarks: [
      {
        price: 3300, // diesel_tzs_per_litre AS price
        fix: 2400, // lbma_am_usd_per_oz AS fix
        subsidy: 1_200_000, // veta_apprenticeship_subsidy_tzs AS subsidy
        fee: 45_000, // ica_cert_per_cert_fee_tzs AS fee
        rate: 14.0, // tib_borrower_rate_tier_b_pct / carbon rate AS rate
        y: 9.5, // bot_91d_tbill_yield_pct AS y
        value: 3300,
      },
    ],
    peer_cohort_aggregates: [{ p25: 2.5 }],
    bot_gold_windows: [{ open: true }],
  };

  function fullSeed() {
    return {
      ...referenceSeed,
      shift_reports: [{ litres: 185, tonnes: 52 }],
      ore_parcels: [{ kg: 1650 }],
      estate_entities: [{ subs: 2, has_holding: true, forestry: 1 }],
      estate_capital_movements: [{ surplus: 88_000_000 }],
      succession_plans: [{ overdue: 1 }],
      insurance_policies: [
        {
          expires_at: new Date(Date.now() + 20 * 86_400_000).toISOString(),
          premium: 5_000_000,
        },
      ],
      insurance_quotes: [{ best_quote: 4_200_000 }],
      tra_royalty_election_state: [
        { days_until: 21, current_rate: 7, alt_rate: 6, quarter_amount: 96_000_000 },
      ],
      nemc_amnesty_windows: [
        { open: true, days_remaining: 45, qualifies: true, penalty: 42_000_000 },
      ],
      // Named in the regulator query's EXISTS subquery — present so the stub
      // treats it as a real relation (the `qualifies` result comes off the
      // window row above, which mirrors the real query's boolean column).
      nemc_amnesty_qualifications: [],
      marketplace_buyer_offers: [
        { premium: 0.65, oz: 128, buyer: 'Mwanza Bullion Traders Ltd' },
      ],
      marketplace_buyers: [
        {
          buyer_id: 'mb-1',
          buyer_name: 'Dar Precious Metals Co',
          premium: 0.72,
          oz: 96,
        },
      ],
      tenant_loans: [{ rate: 18, balance: 640_000_000 }],
      tenant_cash_positions: [{ cash: 530_000_000, idle: 320_000_000 }],
      tenant_energy_profile: [{ grid: 292, solar: 180, kwh: 48_000 }],
      tenant_operations_profile: [
        {
          night_idle: 34,
          night_fuel: 1_800,
          haul_mean: 640,
          haul_p25: 410,
          rejected: 220,
          downstream: 34_000,
          stockpile: 42,
        },
      ],
      peer_cohort_top_patterns: [
        { pattern: 'gravity_concentration_before_cyanide', tenant_uses: false },
      ],
      // The peer-pattern query names tenant_operational_patterns inside its
      // EXISTS subquery; seed it AFTER peer_cohort_top_patterns so the stub's
      // first-match resolves the FROM table (top_patterns) for the row, and
      // present it so the relation is not treated as missing.
      tenant_operational_patterns: [
        { pattern: 'gravity_concentration_before_cyanide', tenant_uses: false },
      ],
      peer_cohort_tenant_position: [{ pct: 62 }],
      vendor_spend_rollup: [
        { category: 'diesel', supplier_count: 2, annual_spend: 750_000_000 },
      ],
      workforce_apprenticeship_eligibility: [{ eligible: 2 }],
      workforce_certifications: [{ expiring: 3 }],
      forestry_carbon_eligibility: [{ ha: 180 }],
    };
  }

  it('tax slice returns REAL TRA election data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.tax).not.toBeNull();
    expect(state.tax?.currentRoyaltyRatePct).toBe(7);
    expect(state.tax?.altRoyaltyRatePct).toBe(6);
    expect(state.tax?.quarterlyRoyaltyTzs).toBe(96_000_000);
  });

  it('regulator slice returns REAL NEMC amnesty data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.regulator).not.toBeNull();
    expect(state.regulator?.nemcAmnestyWindowOpen).toBe(true);
    expect(state.regulator?.tenantQualifiesForAmnesty).toBe(true);
    expect(state.regulator?.estimatedPenaltyAvoidedTzs).toBe(42_000_000);
  });

  it('capital slice returns REAL loan + idle-cash + benchmark data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.capital).not.toBeNull();
    expect(state.capital?.currentLoanRatePct).toBe(18);
    expect(state.capital?.loanBalanceTzs).toBe(640_000_000);
    expect(state.capital?.idleCashOver90dTzs).toBe(320_000_000);
    expect(state.capital?.tibillsYieldPct).toBe(9.5);
  });

  it('energy slice returns REAL grid-vs-solar tariff data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.energy).not.toBeNull();
    expect(state.energy?.currentGridTariffTzsPerKwh).toBe(292);
    expect(state.energy?.solarHybridTzsPerKwh).toBe(180);
  });

  it('ops slice returns REAL operations-profile data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.ops).not.toBeNull();
    expect(state.ops?.nightShiftIdleCapacityPct).toBe(34);
    expect(state.ops?.stockpileAgeP90Days).toBe(42);
  });

  it('marketplace + counterparties slices return REAL buyer data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.marketplace?.latestBuyerName).toBe('Mwanza Bullion Traders Ltd');
    expect(state.marketplace?.latestBuyerOfferPremiumOverLbmaPct).toBe(0.65);
    expect(state.counterparties?.newBuyerPremiumOpportunity?.buyerName).toBe(
      'Dar Precious Metals Co',
    );
  });

  it('vendors + workforce + carbon + peer slices return REAL data', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.vendors?.categoriesWithMultipleSuppliers[0]?.category).toBe('diesel');
    expect(state.workforce?.apprenticeshipEligibleCount).toBe(2);
    expect(state.workforce?.vetaSubsidyPerApprenticeTzs).toBe(1_200_000);
    expect(state.carbon?.eligibleHectares).toBe(180);
    expect(state.peer?.tenantProductionPercentile).toBe(62);
    expect(state.peer?.p75Pattern).toBe('gravity_concentration_before_cyanide');
  });

  it('fx slice converts real stockpile mass_kg to troy ounces', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.fx).not.toBeNull();
    // 1650 kg / 0.0311034768 kg/oz ≈ 53049 oz.
    expect(state.fx?.parcelOzReady).toBeGreaterThan(50_000);
    expect(state.fx?.lbmaFixUsdPerOz).toBe(2400);
  });

  it('estate slice reads real hierarchy + intercompany surplus', async () => {
    const state = await resolveScanState(makeStubDb(fullSeed()), tenantId);
    expect(state.estate?.subsidiaryCount).toBe(2);
    expect(state.estate?.holdingCoExists).toBe(true);
    expect(state.estate?.intercompanySurplusTzs).toBe(88_000_000);
  });
});
