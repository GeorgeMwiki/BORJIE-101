/**
 * Tests for the independent render-effect verifier (Law 3) — the checker that
 * lives OUTSIDE the generating model and diffs declared intent vs the effect
 * the finished spec would actually have. Locks every detector:
 *
 *   - dark-pattern lint (pre-checked consent, required+readonly, hidden consent)
 *   - label/verb divergence (read-label-mutates, action-label-reads)
 *   - surprise-action (mutating affordance on a declared read-only / tracker tab)
 *   - chart-truth (length / value / currency / unit), with synthetic arrays
 *
 * The verifier NEVER throws and DEFAULTS TO ALLOW under uncertainty while still
 * emitting a low-confidence residual.
 */

import { describe, expect, it } from 'vitest';
import {
  checkChartTruth,
  verifyRenderEffect,
  type ChartSeriesPoint,
  type DeclaredRenderIntent,
} from '../render-effect.js';
import { parsePortalTab, type PortalTab } from '../../types.js';

// ---------------------------------------------------------------------------
// Builders — produce a SCHEMA-VALID PortalTab so the verifier runs on real
// parsed input (proves it composes with the canonical schema).
// ---------------------------------------------------------------------------

interface FieldOverrides {
  readonly key?: string;
  readonly label?: string;
  readonly kind?: PortalTab['sections'][number]['fields'][number]['kind'];
  readonly help?: string;
  readonly required?: boolean;
  readonly readonly?: boolean;
  readonly default?: string | number | boolean | null;
  readonly hiddenInList?: boolean;
}

function field(o: FieldOverrides = {}) {
  return {
    key: o.key ?? 'f1',
    label: o.label ?? 'Field one',
    kind: o.kind ?? ('text' as const),
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.required !== undefined ? { required: o.required } : {}),
    ...(o.readonly !== undefined ? { readonly: o.readonly } : {}),
    ...(o.default !== undefined ? { default: o.default } : {}),
    ...(o.hiddenInList !== undefined ? { hiddenInList: o.hiddenInList } : {}),
  };
}

interface WidgetOverrides {
  readonly key?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly binding?: Record<string, unknown>;
}

function widget(o: WidgetOverrides = {}) {
  return {
    key: o.key ?? 'w1',
    kind: 'table' as const,
    title: o.title ?? 'Records',
    ...(o.subtitle !== undefined ? { subtitle: o.subtitle } : {}),
    config: null,
    ...(o.binding !== undefined ? { binding: o.binding } : {}),
  };
}

function buildTab(opts: {
  fields?: ReadonlyArray<FieldOverrides>;
  widgets?: ReadonlyArray<WidgetOverrides>;
}): PortalTab {
  const fields = (opts.fields ?? [{}]).map(field);
  const widgets = (opts.widgets ?? []).map(widget);
  return parsePortalTab({
    id: 'tab_1',
    version: 1,
    tenantId: 't1',
    userId: 'u1',
    tabKey: 'hr.payroll',
    title: 'Payroll',
    description: 'Tracks payroll',
    icon: 'wallet',
    domain: 'hr',
    sections: [
      {
        key: 's1',
        title: 'Main',
        fields,
        widgets,
      },
    ],
    permissions: { visibleToPersonas: ['owner'] },
    audit: {
      createdBy: 'sys',
      updatedBy: 'sys',
      history: [],
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

// ---------------------------------------------------------------------------
// Clean baseline
// ---------------------------------------------------------------------------

describe('verifyRenderEffect — clean spec', () => {
  it('returns ok with no findings for a plain read-only tab', () => {
    const tab = buildTab({
      fields: [{ key: 'name', label: 'Name', kind: 'text' }],
      widgets: [
        {
          key: 'list',
          title: 'View employees',
          binding: { kind: 'query', resource: 'employees' },
        },
      ],
    });
    const verdict = verifyRenderEffect(tab);
    expect(verdict.ok).toBe(true);
    expect(verdict.findings).toHaveLength(0);
  });

  it('does not flag an action-labelled widget that actually mutates', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'act',
          title: 'Create reminder',
          binding: { kind: 'tool', toolId: 'create_reminder' },
        },
      ],
    });
    expect(verifyRenderEffect(tab).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dark-pattern lint
// ---------------------------------------------------------------------------

describe('verifyRenderEffect — dark-pattern lint', () => {
  it('flags a pre-checked consent toggle (high confidence)', () => {
    const tab = buildTab({
      fields: [
        {
          key: 'marketing',
          label: 'Subscribe to marketing emails',
          kind: 'toggle',
          default: true,
        },
      ],
    });
    const verdict = verifyRenderEffect(tab);
    const f = verdict.findings.find(
      (x) => x.kind === 'dark-pattern.prechecked-consent',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
    expect(verdict.ok).toBe(false);
  });

  it('emits only a LOW-confidence residual for a defaulted-true non-consent toggle', () => {
    const tab = buildTab({
      fields: [
        { key: 'darkmode', label: 'Dark mode', kind: 'toggle', default: true },
      ],
    });
    const verdict = verifyRenderEffect(tab);
    const f = verdict.findings.find(
      (x) => x.kind === 'dark-pattern.prechecked-consent',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('low');
  });

  it('does NOT flag a consent toggle that defaults OFF', () => {
    const tab = buildTab({
      fields: [
        {
          key: 'marketing',
          label: 'Subscribe to marketing emails',
          kind: 'toggle',
          default: false,
        },
      ],
    });
    expect(verifyRenderEffect(tab).ok).toBe(true);
  });

  it('flags a required+readonly contradiction (high confidence)', () => {
    const tab = buildTab({
      fields: [
        { key: 'sysid', label: 'System ID', required: true, readonly: true },
      ],
    });
    const f = verifyRenderEffect(tab).findings.find(
      (x) => x.kind === 'dark-pattern.required-readonly',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
  });

  it('flags a consent toggle hidden from list views (interface interference)', () => {
    const tab = buildTab({
      fields: [
        {
          key: 'agree',
          label: 'I agree to the terms',
          kind: 'checkbox',
          hiddenInList: true,
        },
      ],
    });
    const f = verifyRenderEffect(tab).findings.find(
      (x) => x.kind === 'dark-pattern.hidden-consent',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Label / verb divergence
// ---------------------------------------------------------------------------

describe('verifyRenderEffect — label/verb divergence', () => {
  it('flags a read-labelled widget that binds a MUTATING tool (high)', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'sneaky',
          title: 'View payroll summary',
          binding: { kind: 'tool', toolId: 'create_mining_task' },
        },
      ],
    });
    const verdict = verifyRenderEffect(tab);
    const f = verdict.findings.find(
      (x) => x.kind === 'label-verb.read-label-mutates',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
  });

  it('does NOT flag a read-labelled widget bound to a read-mostly tool', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'exp',
          title: 'View export',
          binding: { kind: 'tool', toolId: 'export_records' },
        },
      ],
    });
    expect(
      verifyRenderEffect(tab).findings.some(
        (x) => x.kind === 'label-verb.read-label-mutates',
      ),
    ).toBe(false);
  });

  it('flags an action-labelled widget that only QUERIES (medium)', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'mislabel',
          title: 'Create new shipment',
          binding: { kind: 'query', resource: 'shipments' },
        },
      ],
    });
    const f = verifyRenderEffect(tab).findings.find(
      (x) => x.kind === 'label-verb.action-label-reads',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Surprise-action
// ---------------------------------------------------------------------------

describe('verifyRenderEffect — surprise-action', () => {
  const readOnlyIntent: DeclaredRenderIntent = { disposition: 'read-only' };

  it('flags a mutating affordance on a tab declared read-only (high)', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'act',
          title: 'Quick actions',
          binding: { kind: 'tool', toolId: 'notify_owner' },
        },
      ],
    });
    const verdict = verifyRenderEffect(tab, readOnlyIntent);
    const f = verdict.findings.find(
      (x) => x.kind === 'surprise-action.mutating-on-tracker',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
  });

  it('does NOT flag the same action when intent is interactive', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'act',
          title: 'Quick actions',
          binding: { kind: 'tool', toolId: 'notify_owner' },
        },
      ],
    });
    const verdict = verifyRenderEffect(tab, { disposition: 'interactive' });
    expect(
      verdict.findings.some(
        (x) => x.kind === 'surprise-action.mutating-on-tracker',
      ),
    ).toBe(false);
  });

  it('does NOT flag a query binding on a tracker tab', () => {
    const tab = buildTab({
      widgets: [
        {
          key: 'list',
          title: 'Recent incidents',
          binding: { kind: 'query', resource: 'incidents' },
        },
      ],
    });
    expect(verifyRenderEffect(tab, { disposition: 'tracker' }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

describe('verifyRenderEffect — robustness', () => {
  it('never throws on a malformed tab object', () => {
    // Deliberately bypass the schema to feed garbage.
    const garbage = { sections: null } as unknown as PortalTab;
    expect(() => verifyRenderEffect(garbage)).not.toThrow();
    expect(verifyRenderEffect(garbage).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkChartTruth — the lying-chart detector
// ---------------------------------------------------------------------------

describe('checkChartTruth', () => {
  const series = (vals: number[]): ChartSeriesPoint[] =>
    vals.map((value) => ({ value }));

  it('passes when rendered matches queried', () => {
    expect(checkChartTruth(series([1, 2, 3]), series([1, 2, 3])).ok).toBe(true);
  });

  it('flags a length mismatch (dropped/injected points)', () => {
    const f = checkChartTruth(series([1, 2]), series([1, 2, 3])).findings.find(
      (x) => x.kind === 'chart-truth.length-mismatch',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
  });

  it('flags a value that overstates the data beyond tolerance', () => {
    const f = checkChartTruth(series([10]), series([5])).findings.find(
      (x) => x.kind === 'chart-truth.value-divergence',
    );
    expect(f).toBeDefined();
    expect(f?.confidence).toBe('high');
  });

  it('tolerates floating-point noise within tolerance', () => {
    expect(
      checkChartTruth(series([5.00001]), series([5]), {
        relativeTolerance: 0.001,
      }).ok,
    ).toBe(true);
  });

  it('flags a mixed-currency rendered series', () => {
    const rendered: ChartSeriesPoint[] = [
      { value: 1, currencyCode: 'TZS' },
      { value: 2, currencyCode: 'USD' },
    ];
    const queried: ChartSeriesPoint[] = [
      { value: 1, currencyCode: 'TZS' },
      { value: 2, currencyCode: 'USD' },
    ];
    const f = checkChartTruth(rendered, queried).findings.find(
      (x) => x.kind === 'chart-truth.mixed-currency',
    );
    expect(f).toBeDefined();
  });

  it('flags a per-point currency relabel without conversion', () => {
    const rendered: ChartSeriesPoint[] = [{ value: 100, currencyCode: 'USD' }];
    const queried: ChartSeriesPoint[] = [{ value: 100, currencyCode: 'TZS' }];
    const f = checkChartTruth(rendered, queried).findings.find(
      (x) =>
        x.kind === 'chart-truth.mixed-currency' &&
        x.path === 'chart.series[0]',
    );
    expect(f).toBeDefined();
  });

  it('flags unit confusion across the series', () => {
    const rendered: ChartSeriesPoint[] = [
      { value: 1, unit: 'kg' },
      { value: 2, unit: 'tonnes' },
    ];
    const f = checkChartTruth(rendered, rendered).findings.find(
      (x) => x.kind === 'chart-truth.unit-confusion',
    );
    expect(f).toBeDefined();
  });

  it('flags a per-point unit disagreement vs the queried truth', () => {
    const rendered: ChartSeriesPoint[] = [{ value: 1000, unit: 'kg' }];
    const queried: ChartSeriesPoint[] = [{ value: 1000, unit: 'tonnes' }];
    const f = checkChartTruth(rendered, queried).findings.find(
      (x) =>
        x.kind === 'chart-truth.unit-confusion' && x.path === 'chart.series[0]',
    );
    expect(f).toBeDefined();
  });

  it('emits a LOW-confidence advisory (not a throw) on non-array input', () => {
    const verdict = checkChartTruth(
      null as unknown as ChartSeriesPoint[],
      series([1]),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.findings[0]?.confidence).toBe('low');
  });

  it('emits a LOW-confidence residual for a non-numeric point', () => {
    const rendered = [{ value: Number.NaN }] as ChartSeriesPoint[];
    const verdict = checkChartTruth(rendered, series([1]));
    expect(
      verdict.findings.some(
        (x) =>
          x.kind === 'chart-truth.value-divergence' && x.confidence === 'low',
      ),
    ).toBe(true);
  });
});
