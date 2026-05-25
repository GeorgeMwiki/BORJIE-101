/**
 * Data-source adapter tests.
 */

import { describe, it, expect } from 'vitest';
import {
  InMemoryReportDataAdapter,
  createDevDataAdapter,
} from '../index.js';

describe('InMemoryReportDataAdapter', () => {
  it('returns placeholder narrative for unknown dataSource', async () => {
    const adapter = new InMemoryReportDataAdapter();
    const r = await adapter.resolve({
      tenantId: 't1',
      dataSource: 'unknown.key',
      params: {},
    });
    expect(r.kind).toBe('narrative');
    expect(r.narrative).toMatch(/data unavailable/);
  });

  it('dispatches to registered handler', async () => {
    const adapter = new InMemoryReportDataAdapter();
    adapter.register('foo', {
      resolve: async () => ({ kind: 'narrative', narrative: 'hi' }),
    });
    const r = await adapter.resolve({
      tenantId: 't1',
      dataSource: 'foo',
      params: {},
    });
    expect(r.narrative).toBe('hi');
  });

  it('createDevDataAdapter registers all built-in data keys', async () => {
    const adapter = createDevDataAdapter();

    // sanity-check a few keys from the built-in templates
    const keys = [
      'payments-ledger.revenue.month_summary',
      'occupancy.portfolio.summary',
      'payments-ledger.arrears.buckets',
      'kpi.snapshot',
      'strategy.risks',
      'customer.statement.transactions',
    ];

    for (const k of keys) {
      const r = await adapter.resolve({
        tenantId: 't1',
        dataSource: k,
        params: {},
      });
      // It must not return the "unknown data source" placeholder.
      if (r.kind === 'narrative') {
        expect(r.narrative).not.toMatch(/data unavailable/);
      } else {
        // table / chart / kpi_grid — just verify the field is set.
        expect(
          r.table != null || r.chart != null || r.kpi_grid != null,
        ).toBe(true);
      }
    }
  });
});
