import { describe, expect, it } from 'vitest';
import { compileQuery, defineCube, defineDimension, defineMetric, evaluateMemory } from '../semantic/index.js';
import type { ApiQuery, MemoryQuery, Query } from '../types.js';

describe('semantic / compileQuery (api)', () => {
  const apiCube = defineCube({
    name: 'remote_leases',
    source: { kind: 'api', endpoint: '/v1/cubes/leases' },
    metrics: [defineMetric({ id: 'cnt', name: 'cnt', agg: 'count', column: 'id' })],
    dimensions: [defineDimension({ id: 'status', name: 'status', column: 'status', kind: 'category' })],
  });

  it('returns an ApiQuery with tenant id injected and endpoint preserved', () => {
    const q: Query = { cube: 'remote_leases', tenantId: 't1', metrics: ['cnt'] };
    const r = compileQuery(apiCube, q) as ApiQuery;
    expect(r.kind).toBe('api');
    expect(r.endpoint).toBe('/v1/cubes/leases');
    expect(r.params['tenant_id']).toBe('t1');
    expect(r.tenantScoped).toBe(true);
  });

  it('passes filters + timeRange + timeGrain + limit + orderBy through unchanged', () => {
    const apiCubeT = defineCube({
      name: 'rl',
      source: { kind: 'api', endpoint: '/x' },
      metrics: [defineMetric({ id: 'cnt', name: 'cnt', agg: 'count', column: 'id' })],
      dimensions: [defineDimension({ id: 't', name: 't', column: 'ts', kind: 'time' })],
    });
    const r = compileQuery(apiCubeT, {
      cube: 'rl',
      tenantId: 't1',
      metrics: ['cnt'],
      dimensions: ['t'],
      timeGrain: 'day',
      filters: [{ column: 'status', op: 'eq', value: 'a' }],
      timeRange: { start: '2026-01-01', end: '2026-02-01' },
      orderBy: [{ id: 'cnt', direction: 'asc' }],
      limit: 10,
    }) as ApiQuery;
    expect(r.params['timeGrain']).toBe('day');
    expect(r.params['limit']).toBe(10);
    expect(Array.isArray(r.params['filters'])).toBe(true);
  });
});

describe('semantic / compileQuery + evaluateMemory', () => {
  const memCube = defineCube({
    name: 'inmem',
    source: {
      kind: 'memory',
      rows: [
        { tenant_id: 't1', month: '2026-01-15T00:00:00Z', amount: 100, status: 'active' },
        { tenant_id: 't1', month: '2026-01-20T00:00:00Z', amount: 50, status: 'active' },
        { tenant_id: 't1', month: '2026-02-05T00:00:00Z', amount: 75, status: 'cancelled' },
        { tenant_id: 't2', month: '2026-01-10T00:00:00Z', amount: 999, status: 'active' },
      ],
    },
    metrics: [defineMetric({ id: 'gmv', name: 'gmv', agg: 'sum', column: 'amount' })],
    dimensions: [
      defineDimension({ id: 'm', name: 'm', column: 'month', kind: 'time' }),
      defineDimension({ id: 'status', name: 'status', column: 'status', kind: 'category' }),
    ],
  });

  it('memory tenant injection isolates tenants', () => {
    const compiled = compileQuery(memCube, {
      cube: 'inmem',
      tenantId: 't1',
      metrics: ['gmv'],
    }) as MemoryQuery;
    const rows = evaluateMemory(compiled);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['gmv']).toBe(225); // 100+50+75
  });

  it('memory groups by month grain', () => {
    const compiled = compileQuery(memCube, {
      cube: 'inmem',
      tenantId: 't1',
      metrics: ['gmv'],
      dimensions: ['m'],
      timeGrain: 'month',
    }) as MemoryQuery;
    const rows = evaluateMemory(compiled);
    expect(rows).toHaveLength(2);
    const jan = rows.find((r) => String(r['m']).startsWith('2026-01'));
    expect(jan?.['gmv']).toBe(150);
  });

  it('memory groups by category dimension', () => {
    const compiled = compileQuery(memCube, {
      cube: 'inmem',
      tenantId: 't1',
      metrics: ['gmv'],
      dimensions: ['status'],
    }) as MemoryQuery;
    const rows = evaluateMemory(compiled);
    const active = rows.find((r) => r['status'] === 'active');
    expect(active?.['gmv']).toBe(150);
  });

  it('memory respects extra filters after tenant injection', () => {
    const compiled = compileQuery(memCube, {
      cube: 'inmem',
      tenantId: 't1',
      metrics: ['gmv'],
      filters: [{ column: 'status', op: 'eq', value: 'cancelled' }],
    }) as MemoryQuery;
    const rows = evaluateMemory(compiled);
    expect(rows[0]?.['gmv']).toBe(75);
  });

  it('memory median works', () => {
    const cube = defineCube({
      name: 'm',
      source: {
        kind: 'memory',
        rows: [
          { tenant_id: 't', v: 1 },
          { tenant_id: 't', v: 2 },
          { tenant_id: 't', v: 3 },
          { tenant_id: 't', v: 4 },
        ],
      },
      metrics: [defineMetric({ id: 'med', name: 'med', agg: 'median', column: 'v' })],
      dimensions: [],
    });
    const r = compileQuery(cube, { cube: 'm', tenantId: 't', metrics: ['med'] }) as MemoryQuery;
    const out = evaluateMemory(r);
    expect(out[0]?.['med']).toBe(2.5);
  });

  it('memory count_distinct ignores nulls', () => {
    const cube = defineCube({
      name: 'm',
      source: {
        kind: 'memory',
        rows: [
          { tenant_id: 't', v: 'a' },
          { tenant_id: 't', v: 'a' },
          { tenant_id: 't', v: 'b' },
          { tenant_id: 't', v: null },
        ],
      },
      metrics: [defineMetric({ id: 'd', name: 'd', agg: 'count_distinct', column: 'v' })],
      dimensions: [],
    });
    const r = compileQuery(cube, { cube: 'm', tenantId: 't', metrics: ['d'] }) as MemoryQuery;
    const out = evaluateMemory(r);
    expect(out[0]?.['d']).toBe(2);
  });
});
