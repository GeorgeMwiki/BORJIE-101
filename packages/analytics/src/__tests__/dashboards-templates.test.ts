import { describe, expect, it } from 'vitest';
import { composeFromTemplate, TEMPLATE_NAMES } from '../dashboards/index.js';

describe('dashboards / templates', () => {
  it('TEMPLATE_NAMES lists exactly the 4 SOTA templates', () => {
    expect(TEMPLATE_NAMES).toEqual([
      'leasing-financial-performance',
      'maintenance-ops',
      'tenant-credit',
      'portfolio-overview',
    ]);
  });

  for (const name of TEMPLATE_NAMES) {
    it(`composes '${name}' without error and pins tenantId on every widget`, () => {
      const dash = composeFromTemplate(name, { tenantId: 't-acme' });
      expect(dash.tenantId).toBe('t-acme');
      expect(dash.layout).toBe('grid-12');
      expect(dash.widgets.length).toBeGreaterThan(0);
      for (const w of dash.widgets) {
        if (w.query) {
          expect(w.query.tenantId).toBe('t-acme');
        }
      }
    });
  }

  it('leasing template has 4 KPI tiles + 2 charts', () => {
    const dash = composeFromTemplate('leasing-financial-performance', { tenantId: 't1' });
    expect(dash.widgets.filter((w) => w.kind === 'kpi')).toHaveLength(4);
    expect(dash.widgets.filter((w) => w.kind === 'chart')).toHaveLength(2);
  });

  it('portfolio template includes a markdown widget', () => {
    const dash = composeFromTemplate('portfolio-overview', { tenantId: 't1' });
    expect(dash.widgets.some((w) => w.kind === 'markdown')).toBe(true);
  });

  it('honours defaultTimeRange', () => {
    const dash = composeFromTemplate('leasing-financial-performance', {
      tenantId: 't1',
      defaultTimeRange: { start: '2026-01-01', end: '2026-02-01' },
    });
    expect(dash.defaultTimeRange?.start).toBe('2026-01-01');
  });

  it('name override wins', () => {
    const dash = composeFromTemplate('maintenance-ops', { tenantId: 't1', name: 'Ops Cockpit' });
    expect(dash.name).toBe('Ops Cockpit');
  });
});
