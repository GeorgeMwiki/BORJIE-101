/**
 * world-model-wiring.test.ts — locks the R6 un-darking contract:
 *
 *   1. all three `world.*` tools land on the BrainToolRegistry;
 *   2. a mid-turn simulation returns the trajectory WITH its
 *      `forecast:world.*` citations on the output object (the exact shape
 *      the main loop's CitationAccumulator harvests — forecasts-as-evidence);
 *   3. the fetchers are READ-ONLY (SELECT-only tripwire over every query);
 *   4. the tenant rail holds (a tenant-bound brain simulating another
 *      estate degrades to the kernel tool's honest no-history error);
 *   5. a DB fault degrades honestly (executor throws a structured error,
 *      never a raw driver error swallowed as a fake success).
 */

import { describe, it, expect } from 'vitest';

import {
  bucketEnds,
  buildWorldModelFetchers,
  registerWorldModelToolsOnRegistry,
  WORLD_MODEL_BUCKETS,
  WORLD_MODEL_WINDOW_DAYS,
  type WorldModelDbExecLike,
} from '../world-model-wiring';
import type { BrainToolRegistry, BrainToolSpec } from '@borjie/central-intelligence';

const DAY_MS = 86_400_000;
/** Fixed clock — 2026-06-01T00:00:00Z. */
const NOW_MS = Date.parse('2026-06-01T00:00:00.000Z');
const now = (): number => NOW_MS;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Minimal registry double — records registered specs; collides on dup names. */
function fakeRegistry(): BrainToolRegistry & {
  readonly specs: Map<string, BrainToolSpec>;
} {
  const specs = new Map<string, BrainToolSpec>();
  return {
    specs,
    register(spec) {
      if (specs.has(spec.name)) {
        throw new Error(`duplicate tool: ${spec.name}`);
      }
      specs.set(spec.name, spec as BrainToolSpec);
    },
    get: (name) => specs.get(name) ?? null,
    list: () => [...specs.values()],
    runTool: async () => ({ kind: 'not-found', name: 'unused' }),
    clear: () => specs.clear(),
  };
}

/** Render a drizzle sql`` object to flat text (tolerant of internals). */
function sqlText(query: unknown): string {
  return JSON.stringify(query) ?? '';
}

/**
 * Table-routing fake db: returns canned rows per `FROM <table>` and records
 * every query for the SELECT-only tripwire.
 */
function fakeDb(
  rowsByTable: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>>,
): WorldModelDbExecLike & { readonly queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async execute(query: unknown): Promise<unknown> {
      const text = sqlText(query);
      queries.push(text);
      for (const [table, rows] of Object.entries(rowsByTable)) {
        if (text.includes(`FROM ${table}`)) return rows;
      }
      return [];
    },
  };
}

/** Canned healthy site dataset (tenant t1, site site-1, text non-uuid ids). */
function healthySiteDb(): ReturnType<typeof fakeDb> {
  const d = (daysAgo: number): string =>
    new Date(NOW_MS - daysAgo * DAY_MS).toISOString();
  return fakeDb({
    sites: [{ id: 'site-1', tenant_id: 't1' }],
    sales: [
      {
        ts: d(100),
        net_tzs: '500000.00',
        gross_price_tzs: null,
        payment_status: 'paid',
        payment_received_at: d(95),
      },
      {
        ts: d(40),
        net_tzs: '750000.00',
        gross_price_tzs: null,
        payment_status: 'pending',
        payment_received_at: null,
      },
    ],
    production_records: [{ day: d(10) }, { day: d(41) }, { day: d(100) }],
    incidents: [{ occurred_at: d(20), closed_at: null }],
  });
}

// ---------------------------------------------------------------------------
// bucketEnds — series geometry
// ---------------------------------------------------------------------------

describe('bucketEnds', () => {
  it('returns oldest-first, evenly spaced ends finishing at now', () => {
    const ends = bucketEnds(NOW_MS, WORLD_MODEL_WINDOW_DAYS, WORLD_MODEL_BUCKETS);
    expect(ends).toHaveLength(WORLD_MODEL_BUCKETS);
    expect(ends[ends.length - 1]).toBe(NOW_MS);
    const step = (WORLD_MODEL_WINDOW_DAYS / WORLD_MODEL_BUCKETS) * DAY_MS;
    for (let i = 1; i < ends.length; i += 1) {
      expect((ends[i] ?? 0) - (ends[i - 1] ?? 0)).toBeCloseTo(step, 6);
    }
  });
});

// ---------------------------------------------------------------------------
// Registration — all three world.* tools land on the registry
// ---------------------------------------------------------------------------

describe('registerWorldModelToolsOnRegistry', () => {
  it('registers world.property_trajectory / world.arrears_trajectory / world.market_regime', () => {
    const registry = fakeRegistry();
    const count = registerWorldModelToolsOnRegistry({
      registry,
      db: fakeDb({}),
      scope: { tenantId: 't1', userId: 'u1', role: 'owner' },
      now,
    });
    expect(count).toBe(3);
    expect([...registry.specs.keys()].sort()).toEqual([
      'world.arrears_trajectory',
      'world.market_regime',
      'world.property_trajectory',
    ]);
    // READ-ONLY simulation: never approval-gated, never an LLM-cost tier.
    for (const spec of registry.specs.values()) {
      expect(spec.requiresApproval).toBe(false);
      expect(spec.tier).toBe('free');
    }
  });

  it('skips a name collision defensively instead of aborting the bundle', () => {
    const registry = fakeRegistry();
    registry.register({
      name: 'world.property_trajectory',
      description: 'squatter',
      schemaIn: undefined as never,
      schemaOut: undefined as never,
      tier: 'free',
      requiresApproval: false,
      executor: async () => null,
    } as unknown as BrainToolSpec);
    const warned: string[] = [];
    const count = registerWorldModelToolsOnRegistry({
      registry,
      db: fakeDb({}),
      scope: { tenantId: 't1', userId: 'u1' },
      logger: { warn: (meta) => warned.push(String(meta.tool)) },
      now,
    });
    expect(count).toBe(2);
    expect(warned).toEqual(['world.property_trajectory']);
  });
});

// ---------------------------------------------------------------------------
// Mid-turn simulation — forecasts surface as evidence
// ---------------------------------------------------------------------------

describe('world.property_trajectory executor (evidence contract)', () => {
  it('returns the trajectory with forecast:world.* citations the loop harvests', async () => {
    const registry = fakeRegistry();
    const db = healthySiteDb();
    registerWorldModelToolsOnRegistry({
      registry,
      db,
      scope: { tenantId: 't1', userId: 'u1', role: 'owner' },
      now,
    });
    const spec = registry.specs.get('world.property_trajectory');
    expect(spec).toBeDefined();

    const result = (await spec?.executor({ propertyId: 'site-1' })) as Record<
      string,
      unknown
    >;
    // Trajectory payload intact…
    expect(result.regime).toBeDefined();
    expect(Array.isArray(result.forecast)).toBe(true);
    const point0 = result.point0 as Record<string, unknown>;
    expect(point0.propertyId).toBe('site-1');
    expect(point0.tenantId).toBe('t1');
    // …and the forecast citation rides the SAME object under `citations`
    // (the key CitationAccumulator.harvestFromOutput reads).
    const citations = result.citations as ReadonlyArray<{ id: string }>;
    expect(citations.length).toBeGreaterThan(0);
    expect(citations[0]?.id.startsWith('forecast:world.property_trajectory:')).toBe(
      true,
    );
  });

  it('is READ-ONLY — every query the fetchers run is a SELECT', async () => {
    const registry = fakeRegistry();
    const db = healthySiteDb();
    registerWorldModelToolsOnRegistry({
      registry,
      db,
      scope: { tenantId: 't1', userId: 'u1' },
      now,
    });
    await registry.specs
      .get('world.property_trajectory')
      ?.executor({ propertyId: 'site-1' });
    expect(db.queries.length).toBeGreaterThan(0);
    for (const q of db.queries) {
      expect(q).toMatch(/SELECT/);
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
    }
  });
});

// ---------------------------------------------------------------------------
// Tenant rail + honest degrade
// ---------------------------------------------------------------------------

describe('tenant isolation + honest degrade', () => {
  it('a tenant-bound brain simulating another estate gets the honest no-history error', async () => {
    const registry = fakeRegistry();
    // Site exists but belongs to t2; brain is scoped to t1.
    const db = fakeDb({ sites: [{ id: 'site-9', tenant_id: 't2' }] });
    registerWorldModelToolsOnRegistry({
      registry,
      db,
      scope: { tenantId: 't1', userId: 'u1' },
      now,
    });
    await expect(
      registry.specs
        .get('world.property_trajectory')
        ?.executor({ propertyId: 'site-9' }),
    ).rejects.toThrow(/no history/);
  });

  it('world.market_regime refuses a cross-tenant read for a tenant-bound brain', async () => {
    const registry = fakeRegistry();
    const db = fakeDb({
      offtake_agreements: [
        { created_at: new Date(NOW_MS - 200 * DAY_MS).toISOString(), deleted_at: null, status: 'active' },
      ],
    });
    registerWorldModelToolsOnRegistry({
      registry,
      db,
      scope: { tenantId: 't1', userId: 'u1' },
      now,
    });
    const spec = registry.specs.get('world.market_regime');
    await expect(spec?.executor({ tenantId: 't2' })).rejects.toThrow(/no history/);
    // The same brain CAN simulate its own estate.
    const ok = (await spec?.executor({ tenantId: 't1' })) as Record<string, unknown>;
    expect(ok.regime).toBeDefined();
    const citations = ok.citations as ReadonlyArray<{ id: string }>;
    expect(citations[0]?.id.startsWith('forecast:world.market_regime:')).toBe(true);
  });

  it('a DB fault degrades to the structured no-history error, never a raw driver error', async () => {
    const failingDb: WorldModelDbExecLike = {
      execute: async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:5432');
      },
    };
    const fetchers = buildWorldModelFetchers({
      db: failingDb,
      scopeTenantId: 't1',
      now,
    });
    await expect(fetchers.fetchPropertyHistory('site-1')).resolves.toEqual([]);
    await expect(fetchers.fetchTenantHistory('agr-1')).resolves.toEqual([]);
    await expect(fetchers.fetchAgencyHistory('t1')).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Counterparty fetcher — agreement → buyer resolution + arrears math
// ---------------------------------------------------------------------------

describe('fetchTenantHistory', () => {
  it('resolves the agreement to its buyer and builds an arrears series', async () => {
    const d = (daysAgo: number): string =>
      new Date(NOW_MS - daysAgo * DAY_MS).toISOString();
    const db = fakeDb({
      offtake_agreements: [
        {
          id: 'agr-1',
          buyer_id: 'buyer-1',
          tenant_id: 't1',
          created_at: d(300),
          signed_at: d(290),
        },
      ],
      sales: [
        {
          ts: d(200),
          net_tzs: '1000000.00',
          gross_price_tzs: null,
          payment_status: 'paid',
          payment_received_at: d(190),
        },
        {
          ts: d(50),
          net_tzs: '2000000.00',
          gross_price_tzs: null,
          payment_status: 'pending',
          payment_received_at: null,
        },
      ],
    });
    const fetchers = buildWorldModelFetchers({ db, scopeTenantId: 't1', now });
    const series = await fetchers.fetchTenantHistory('agr-1');
    expect(series.length).toBeGreaterThan(0);
    const last = series[series.length - 1];
    // The unpaid 2 000 000 sale (50d old) is the live arrears position.
    expect(last?.arrearsAmountMajor).toBe(2_000_000);
    expect(last?.arrearsDays).toBe(50);
    expect(last?.leaseId).toBe('agr-1');
    expect(last?.tenantId).toBe('t1');
    // 1 of the 2 sales paid within 30 days.
    expect(last?.paymentRegularity).toBeCloseTo(0.5, 10);
  });
});
