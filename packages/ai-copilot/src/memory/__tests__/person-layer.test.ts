/**
 * Tests for `person-layer.ts` — the federated personal-memory loader.
 *
 * Coverage targets (R8 spec):
 *   - load empty when no facts (graceful fallback)
 *   - load empty when personId blank
 *   - load empty when table missing (SQLSTATE 42P01 simulated)
 *   - upsert + load roundtrip with the deterministic stub driver
 *   - per-kind cap = 50 (PERSON_LAYER_PER_KIND_LIMIT)
 *   - expired cell filtering relies on SQL `now()` predicate
 *
 * The tests use a thin in-memory driver that mimics the row shape
 * postgres.js returns for `db.execute(sql\`...\`)` calls. Drizzle's
 * `sql` tag is replaced with a deterministic stub that captures the
 * literal interpolations so we can simulate the query plan.
 */

import { describe, it, expect } from 'vitest';
import {
  loadPersonLayer,
  upsertPersonalFact,
  flattenPersonLayer,
  PERSON_CELL_KINDS,
  PERSON_LAYER_PER_KIND_LIMIT,
  type PersonCellKind,
  type PersonLayerDrizzleClient,
  type PersonLayerSqlTemplate,
} from '../person-layer.js';

// ────────────────────────────────────────────────────────────────────
// Stub SQL template — returns the captured statement object verbatim
// so the in-memory driver below can dispatch on the array fragments.
// ────────────────────────────────────────────────────────────────────

interface StubStatement {
  readonly fragments: ReadonlyArray<string>;
  readonly values: ReadonlyArray<unknown>;
}

const stubSql: PersonLayerSqlTemplate = (strings, ...values) =>
  ({
    fragments: [...strings],
    values: [...values],
  }) as StubStatement;

// ────────────────────────────────────────────────────────────────────
// Test driver — stores cells in a Map; supports the two query shapes
// we issue (SELECT bucketed + INSERT ... ON CONFLICT).
// ────────────────────────────────────────────────────────────────────

interface FakeCell {
  id: string;
  person_id: string;
  cell_kind: PersonCellKind;
  key: string;
  value: unknown;
  confidence: number;
  source_tenant_id: string | null;
  source_thread_id: string | null;
  captured_at: Date;
  expires_at: Date | null;
}

function createFakeDriver(seed: FakeCell[] = []): {
  db: PersonLayerDrizzleClient;
  cells: Map<string, FakeCell>;
  failOnNext: () => void;
} {
  const cells = new Map<string, FakeCell>();
  for (const c of seed) cells.set(c.id, { ...c });
  let failNext = false;

  const driver: PersonLayerDrizzleClient = {
    async execute(query: unknown) {
      if (failNext) {
        failNext = false;
        throw new Error('relation "personal_memory_cells" does not exist');
      }
      const stmt = query as StubStatement;
      const head = (stmt.fragments[0] ?? '').toLowerCase();

      if (head.includes('with bucketed')) {
        const personId = String(stmt.values[0]);
        const perKindLimit = Number(stmt.values[1]);
        const now = Date.now();
        const matched = [...cells.values()]
          .filter((c) => c.person_id === personId)
          .filter((c) => c.expires_at === null || c.expires_at.getTime() > now)
          .sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());

        const grouped = new Map<string, FakeCell[]>();
        for (const cell of matched) {
          const bucket = grouped.get(cell.cell_kind) ?? [];
          bucket.push(cell);
          grouped.set(cell.cell_kind, bucket);
        }
        const out: FakeCell[] = [];
        for (const bucket of grouped.values()) {
          for (const cell of bucket.slice(0, perKindLimit)) {
            out.push(cell);
          }
        }
        return { rows: out };
      }

      if (head.includes('insert into personal_memory_cells')) {
        const [
          personId,
          cellKind,
          key,
          valueJson,
          confidence,
          sourceTenantId,
          sourceThreadId,
          expiresAt,
        ] = stmt.values;
        const id = `${String(personId)}|${String(cellKind)}|${String(key)}`;
        cells.set(id, {
          id,
          person_id: String(personId),
          cell_kind: cellKind as PersonCellKind,
          key: String(key),
          value: JSON.parse(String(valueJson)),
          confidence: Number(confidence),
          source_tenant_id:
            sourceTenantId === null || sourceTenantId === undefined
              ? null
              : String(sourceTenantId),
          source_thread_id:
            sourceThreadId === null || sourceThreadId === undefined
              ? null
              : String(sourceThreadId),
          captured_at: new Date(),
          expires_at:
            expiresAt === null || expiresAt === undefined
              ? null
              : new Date(String(expiresAt)),
        });
        return { rowCount: 1 };
      }

      return { rows: [] };
    },
  };

  return {
    db: driver,
    cells,
    failOnNext: () => {
      failNext = true;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe('loadPersonLayer — empty cases', () => {
  it('returns empty buckets when personId is blank', async () => {
    const { db } = createFakeDriver();
    const result = await loadPersonLayer({
      personId: '',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(result.preferences).toEqual([]);
    expect(result.context).toEqual([]);
    expect(result.recurringFacts).toEqual([]);
    expect(result.calibration).toEqual([]);
  });

  it('returns empty when currentTenantId is blank (refuses to mislabel)', async () => {
    const { db } = createFakeDriver([
      {
        id: 'c1',
        person_id: 'p1',
        cell_kind: 'preference',
        key: 'language',
        value: { lang: 'sw' },
        confidence: 1,
        source_tenant_id: null,
        source_thread_id: null,
        captured_at: new Date(),
        expires_at: null,
      },
    ]);
    const result = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: '',
      db,
      sqlTemplate: stubSql,
    });
    expect(flattenPersonLayer(result)).toEqual([]);
  });

  it('returns empty when the table is missing (SQLSTATE 42P01)', async () => {
    const { db, failOnNext } = createFakeDriver();
    failOnNext();
    const result = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(flattenPersonLayer(result)).toEqual([]);
  });

  it('returns empty when no rows match the personId', async () => {
    const { db } = createFakeDriver([
      {
        id: 'c1',
        person_id: 'other-person',
        cell_kind: 'preference',
        key: 'language',
        value: { lang: 'sw' },
        confidence: 1,
        source_tenant_id: null,
        source_thread_id: null,
        captured_at: new Date(),
        expires_at: null,
      },
    ]);
    const result = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(flattenPersonLayer(result)).toEqual([]);
  });
});

describe('upsertPersonalFact + loadPersonLayer roundtrip', () => {
  it('writes a preference and surfaces it on the next load', async () => {
    const { db } = createFakeDriver();

    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'preference',
      key: 'language',
      value: { lang: 'sw', formality: 'casual' },
      db,
      sqlTemplate: stubSql,
    });

    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });

    expect(layer.preferences.length).toBe(1);
    const cell = layer.preferences[0];
    expect(cell?.cellKind).toBe('preference');
    expect(cell?.key).toBe('language');
    expect(cell?.confidence).toBe(1);
  });

  it('clamps confidence to [0,1] on upsert', async () => {
    const { db } = createFakeDriver();
    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'context',
      key: 'flu',
      value: { recovering: true },
      confidence: 2.5,
      db,
      sqlTemplate: stubSql,
    });
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(layer.context[0]?.confidence).toBe(1);
  });

  it('routes each cell_kind into its own bucket', async () => {
    const { db } = createFakeDriver();
    for (const kind of PERSON_CELL_KINDS) {
      await upsertPersonalFact({
        personId: 'p1',
        cellKind: kind,
        key: `key-${kind}`,
        value: { kind },
        db,
        sqlTemplate: stubSql,
      });
    }
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(layer.preferences.length).toBe(1);
    expect(layer.recurringFacts.length).toBe(1);
    expect(layer.calibration.length).toBe(1);
    // sentiment folds into context per §10.6 — context bucket has 2.
    expect(layer.context.length).toBe(2);
  });

  it('silently ignores an invalid cellKind on upsert', async () => {
    const { db } = createFakeDriver();
    await upsertPersonalFact({
      personId: 'p1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cellKind: 'bogus' as any,
      key: 'x',
      value: {},
      db,
      sqlTemplate: stubSql,
    });
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(flattenPersonLayer(layer)).toEqual([]);
  });
});

describe('loadPersonLayer — per-kind 50-cap', () => {
  it('caps at PERSON_LAYER_PER_KIND_LIMIT (50)', async () => {
    expect(PERSON_LAYER_PER_KIND_LIMIT).toBe(50);
    const seed: FakeCell[] = [];
    const baseTime = Date.now();
    for (let i = 0; i < 75; i++) {
      seed.push({
        id: `c${i}`,
        person_id: 'p1',
        cell_kind: 'preference',
        key: `key-${i}`,
        value: { i },
        confidence: 1,
        source_tenant_id: null,
        source_thread_id: null,
        captured_at: new Date(baseTime + i),
        expires_at: null,
      });
    }
    const { db } = createFakeDriver(seed);
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    expect(layer.preferences.length).toBe(50);
  });

  it('honours a custom perKindLimit override', async () => {
    const seed: FakeCell[] = [];
    for (let i = 0; i < 30; i++) {
      seed.push({
        id: `c${i}`,
        person_id: 'p1',
        cell_kind: 'context',
        key: `key-${i}`,
        value: {},
        confidence: 1,
        source_tenant_id: null,
        source_thread_id: null,
        captured_at: new Date(Date.now() + i),
        expires_at: null,
      });
    }
    const { db } = createFakeDriver(seed);
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
      perKindLimit: 10,
    });
    expect(layer.context.length).toBe(10);
  });
});

describe('flattenPersonLayer ordering', () => {
  it('preserves the documented bucket order', async () => {
    const { db } = createFakeDriver();
    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'preference',
      key: 'pref-key',
      value: {},
      db,
      sqlTemplate: stubSql,
    });
    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'context',
      key: 'ctx-key',
      value: {},
      db,
      sqlTemplate: stubSql,
    });
    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'recurring-fact',
      key: 'rec-key',
      value: {},
      db,
      sqlTemplate: stubSql,
    });
    await upsertPersonalFact({
      personId: 'p1',
      cellKind: 'calibration',
      key: 'cal-key',
      value: {},
      db,
      sqlTemplate: stubSql,
    });
    const layer = await loadPersonLayer({
      personId: 'p1',
      currentTenantId: 'tenant-A',
      db,
      sqlTemplate: stubSql,
    });
    const flat = flattenPersonLayer(layer);
    expect(flat.map((c) => c.cellKind)).toEqual([
      'preference',
      'context',
      'recurring-fact',
      'calibration',
    ]);
  });
});
