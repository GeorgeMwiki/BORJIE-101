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

// Tables that never shipped (no migration creates them). A query over any
// of these must reject like real Postgres — the resolver slice catches it
// and degrades to null, never throwing the whole scan.
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

    // (c) genuinely-missing relation — real PG rejects it.
    for (const missing of MISSING_TABLES) {
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
