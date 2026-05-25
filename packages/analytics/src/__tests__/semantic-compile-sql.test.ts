import { describe, expect, it } from 'vitest';
import {
  compileQuery,
  defineCube,
  defineDimension,
  defineMetric,
} from '../semantic/index.js';
import type { Query, SqlQuery } from '../types.js';

const leases = defineCube({
  name: 'leases',
  source: { kind: 'sql', table: 'leases' },
  metrics: [
    defineMetric({ id: 'gmv', name: 'GMV', agg: 'sum', column: 'amount' }),
    defineMetric({ id: 'cnt', name: 'count', agg: 'count', column: 'id' }),
    defineMetric({ id: 'avg_rent', name: 'avg rent', agg: 'avg', column: 'rent' }),
  ],
  dimensions: [
    defineDimension({ id: 'month', name: 'Month', column: 'signed_at', kind: 'time' }),
    defineDimension({ id: 'status', name: 'Status', column: 'status', kind: 'category' }),
  ],
});

function asSql(q: ReturnType<typeof compileQuery>): SqlQuery {
  if (q.kind !== 'sql') throw new Error('expected sql');
  return q;
}

describe('semantic / compileQuery (sql)', () => {
  it('always injects tenant filter first', () => {
    const q: Query = { cube: 'leases', tenantId: 't1', metrics: ['gmv'] };
    const r = asSql(compileQuery(leases, q));
    expect(r.tenantScoped).toBe(true);
    expect(r.sql).toMatch(/WHERE tenant_id = :p0/);
    expect(r.params['p0']).toBe('t1');
  });

  it('rejects missing tenantId', () => {
    expect(() =>
      compileQuery(leases, { cube: 'leases', tenantId: '', metrics: ['gmv'] }),
    ).toThrow(/tenantId/);
  });

  it('rejects unknown metric', () => {
    expect(() =>
      compileQuery(leases, { cube: 'leases', tenantId: 't1', metrics: ['nope'] }),
    ).toThrow(/no metric/);
  });

  it('rejects unknown dimension', () => {
    expect(() =>
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        dimensions: ['nope'],
      }),
    ).toThrow(/no dimension/);
  });

  it('rejects timeGrain without a time dimension', () => {
    expect(() =>
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        timeGrain: 'month',
      }),
    ).toThrow(/timeGrain/);
  });

  it('emits date_trunc when timeGrain + time dim are present', () => {
    const r = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        dimensions: ['month'],
        timeGrain: 'month',
      }),
    );
    expect(r.sql).toContain("date_trunc('month', signed_at)");
    expect(r.sql).toContain('GROUP BY month');
  });

  it('compiles all aggregations', () => {
    for (const agg of ['sum', 'count', 'avg', 'min', 'max', 'count_distinct', 'median'] as const) {
      const cube = defineCube({
        name: 'x',
        source: { kind: 'sql', table: 't' },
        metrics: [defineMetric({ id: 'm', name: 'm', agg, column: 'v' })],
        dimensions: [],
      });
      const r = asSql(compileQuery(cube, { cube: 'x', tenantId: 't', metrics: ['m'] }));
      expect(r.sql).toMatch(/SELECT/);
    }
  });

  it('handles eq/neq/gt/gte/lt/lte filters', () => {
    const ops: Array<'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'> = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'];
    for (const op of ops) {
      const r = asSql(
        compileQuery(leases, {
          cube: 'leases',
          tenantId: 't1',
          metrics: ['gmv'],
          filters: [{ column: 'amount', op, value: 100 }],
        }),
      );
      expect(r.sql).toContain('amount');
      expect(Object.values(r.params)).toContain(100);
    }
  });

  it('handles in / not_in filters with placeholders', () => {
    const r = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'status', op: 'in', value: ['active', 'signed'] }],
      }),
    );
    expect(r.sql).toMatch(/status IN \(:p\d, :p\d\)/);
  });

  it('rejects empty in/not_in arrays', () => {
    expect(() =>
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'status', op: 'in', value: [] }],
      }),
    ).toThrow(/non-empty/);
  });

  it('handles between with two placeholders', () => {
    const r = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'amount', op: 'between', value: [10, 20] }],
      }),
    );
    expect(r.sql).toMatch(/amount BETWEEN :p\d AND :p\d/);
    expect(Object.values(r.params)).toContain(10);
    expect(Object.values(r.params)).toContain(20);
  });

  it('handles contains + starts_with', () => {
    const r1 = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'status', op: 'contains', value: 'sign' }],
      }),
    );
    expect(Object.values(r1.params)).toContain('%sign%');
    const r2 = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'status', op: 'starts_with', value: 'sign' }],
      }),
    );
    expect(Object.values(r2.params)).toContain('sign%');
  });

  it('compiles timeRange to >= and < bounds', () => {
    const r = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        timeRange: { start: '2026-01-01', end: '2026-02-01', column: 'signed_at' },
      }),
    );
    expect(r.sql).toMatch(/signed_at >= :p\d/);
    expect(r.sql).toMatch(/signed_at < :p\d/);
  });

  it('emits ORDER BY and LIMIT', () => {
    const r = asSql(
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        dimensions: ['status'],
        orderBy: [{ id: 'gmv', direction: 'desc' }],
        limit: 50,
      }),
    );
    expect(r.sql).toContain('ORDER BY gmv DESC');
    expect(r.sql).toContain('LIMIT 50');
  });

  it('refuses unsafe table identifiers at compile time', () => {
    const evilCube = defineCube({
      name: 'x',
      source: { kind: 'sql', table: 'leases; DROP TABLE x' },
      metrics: [defineMetric({ id: 'm', name: 'm', agg: 'count', column: 'a' })],
      dimensions: [],
    });
    expect(() => compileQuery(evilCube, { cube: 'x', tenantId: 't1', metrics: ['m'] })).toThrow(/unsafe/);
  });

  it('refuses unsafe filter column identifiers', () => {
    expect(() =>
      compileQuery(leases, {
        cube: 'leases',
        tenantId: 't1',
        metrics: ['gmv'],
        filters: [{ column: 'amount; DROP', op: 'eq', value: 1 }],
      }),
    ).toThrow(/unsafe/);
  });

  it('uses a custom tenantColumn when configured', () => {
    const cube = defineCube({
      name: 'tenants_v2',
      source: { kind: 'sql', table: 'tenants_v2' },
      metrics: [defineMetric({ id: 'cnt', name: 'cnt', agg: 'count', column: 'id' })],
      dimensions: [],
      tenantColumn: 'org_id',
    });
    const r = asSql(compileQuery(cube, { cube: 'tenants_v2', tenantId: 'org-1', metrics: ['cnt'] }));
    expect(r.sql).toMatch(/WHERE org_id = :p0/);
  });
});
