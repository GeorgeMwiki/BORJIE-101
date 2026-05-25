import { describe, expect, it } from 'vitest';
import {
  composeFromTemplate,
  evaluateDashboard,
  type QueryFetcher,
} from '../dashboards/index.js';
import type { CompiledQuery, ParsedRow, Query } from '../types.js';

const fakeRows: readonly ParsedRow[] = [
  { month: '2026-01', gmv: 100 },
  { month: '2026-02', gmv: 200 },
];

const fakeFetcher: QueryFetcher = {
  async fetch() {
    return fakeRows;
  },
};

const fakeCompile = (q: Query): CompiledQuery =>
  Object.freeze({
    kind: 'sql',
    sql: 'SELECT 1',
    params: { p0: q.tenantId },
    tenantScoped: true,
  });

describe('dashboards / evaluateDashboard', () => {
  it('returns a rendered widget per definition widget', async () => {
    const def = composeFromTemplate('leasing-financial-performance', { tenantId: 't1' });
    const r = await evaluateDashboard({ definition: def, fetcher: fakeFetcher, compile: fakeCompile });
    expect(r.widgets).toHaveLength(def.widgets.length);
    expect(r.tenantId).toBe('t1');
  });

  it('chart widgets get their fetched rows applied to data.values', async () => {
    const def = composeFromTemplate('leasing-financial-performance', { tenantId: 't1' });
    const r = await evaluateDashboard({ definition: def, fetcher: fakeFetcher, compile: fakeCompile });
    const chartWidget = r.widgets.find((w) => w.kind === 'chart');
    expect(chartWidget).toBeDefined();
    const values = (chartWidget!.spec as { data?: { values?: readonly unknown[] } }).data?.values;
    expect(values).toEqual(fakeRows);
  });

  it('surfaces fetcher errors on a per-widget basis', async () => {
    const def = composeFromTemplate('maintenance-ops', { tenantId: 't1' });
    const erroring: QueryFetcher = {
      async fetch() {
        throw new Error('db down');
      },
    };
    const r = await evaluateDashboard({ definition: def, fetcher: erroring, compile: fakeCompile });
    const erroredWidgets = r.widgets.filter((w) => w.error);
    expect(erroredWidgets.length).toBeGreaterThan(0);
    expect(erroredWidgets[0]?.error).toContain('db down');
  });

  it('markdown widgets have empty rows + no fetcher call', async () => {
    const def = composeFromTemplate('portfolio-overview', { tenantId: 't1' });
    let calls = 0;
    const counted: QueryFetcher = {
      async fetch() {
        calls++;
        return [];
      },
    };
    const r = await evaluateDashboard({ definition: def, fetcher: counted, compile: fakeCompile });
    const md = r.widgets.find((w) => w.kind === 'markdown');
    expect(md?.rows).toEqual([]);
    // calls = number of non-markdown widgets
    const expected = def.widgets.filter((w) => w.kind !== 'markdown' && w.query).length;
    expect(calls).toBe(expected);
  });

  it('uses dashboard defaultTimeRange when widget has none', async () => {
    const def = composeFromTemplate('leasing-financial-performance', {
      tenantId: 't1',
      defaultTimeRange: { start: '2026-01-01', end: '2026-02-01' },
    });
    let observed: Query | null = null;
    const obs = (q: Query) => {
      observed = q;
      return fakeCompile(q);
    };
    await evaluateDashboard({ definition: def, fetcher: fakeFetcher, compile: obs });
    expect((observed as unknown as Query | null)?.timeRange?.start).toBe('2026-01-01');
  });
});
