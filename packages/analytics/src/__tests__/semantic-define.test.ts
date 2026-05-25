import { describe, expect, it } from 'vitest';
import { defineCube, defineDimension, defineMetric } from '../semantic/index.js';

describe('semantic / define', () => {
  it('freezes a metric so consumers cannot mutate it', () => {
    const m = defineMetric({ id: 'gmv', name: 'GMV', agg: 'sum', column: 'amount' });
    expect(Object.isFrozen(m)).toBe(true);
    expect(() => {
      (m as unknown as { name: string }).name = 'x';
    }).toThrow();
  });

  it('rejects ids that are not safe SQL identifiers', () => {
    expect(() => defineMetric({ id: '1bad', name: 'x', agg: 'sum', column: 'a' })).toThrow(/invalid/);
    expect(() => defineMetric({ id: 'bad-name', name: 'x', agg: 'sum', column: 'a' })).toThrow(/invalid/);
    expect(() => defineMetric({ id: 'a;DROP', name: 'x', agg: 'sum', column: 'a' })).toThrow(/invalid/);
  });

  it('rejects metric with empty column', () => {
    expect(() => defineMetric({ id: 'm', name: 'm', agg: 'sum', column: '' })).toThrow(/column/);
  });

  it('rejects dimension with empty column', () => {
    expect(() => defineDimension({ id: 'd', name: 'd', column: '', kind: 'category' })).toThrow(/column/);
  });

  it('defaults cube tenantColumn to tenant_id', () => {
    const cube = defineCube({
      name: 'leases',
      source: { kind: 'sql', table: 'leases' },
      metrics: [defineMetric({ id: 'cnt', name: 'cnt', agg: 'count', column: 'id' })],
      dimensions: [],
    });
    expect(cube.tenantColumn).toBe('tenant_id');
  });

  it('rejects cube with duplicate metric ids', () => {
    expect(() =>
      defineCube({
        name: 'x',
        source: { kind: 'sql', table: 't' },
        metrics: [
          defineMetric({ id: 'm', name: 'm', agg: 'sum', column: 'a' }),
          defineMetric({ id: 'm', name: 'm2', agg: 'sum', column: 'b' }),
        ],
        dimensions: [],
      }),
    ).toThrow(/duplicate metric/);
  });

  it('rejects cube with no metrics and no dimensions', () => {
    expect(() =>
      defineCube({
        name: 'x',
        source: { kind: 'sql', table: 't' },
        metrics: [],
        dimensions: [],
      }),
    ).toThrow(/no metrics/);
  });

  it('rejects cube with empty name', () => {
    expect(() =>
      defineCube({
        name: '',
        source: { kind: 'sql', table: 't' },
        metrics: [defineMetric({ id: 'm', name: 'm', agg: 'sum', column: 'a' })],
        dimensions: [],
      }),
    ).toThrow(/name/);
  });
});
