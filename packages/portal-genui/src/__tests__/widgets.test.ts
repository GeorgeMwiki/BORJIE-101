/**
 * Widget-catalog tests — covers every kind's config validator plus
 * the genui_part escape hatch.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_WIDGET_KINDS,
  WIDGET_KIND_REGISTRY,
  buildSampleWidget,
  getWidgetKindMetadata,
  parseWidgetConfig,
} from '../widgets/index.js';
import { PortalTabWidgetSchema } from '../types.js';

describe('WIDGET_KIND_REGISTRY', () => {
  it('has metadata for all 14 kinds', () => {
    expect(ALL_WIDGET_KINDS.length).toBe(14);
    for (const k of ALL_WIDGET_KINDS) {
      const meta = WIDGET_KIND_REGISTRY[k];
      expect(meta.rendererName).toBeTruthy();
      expect(meta.displayLabel).toBeTruthy();
    }
  });

  it('throws on unknown kind', () => {
    expect(() => getWidgetKindMetadata('not_a_kind' as 'kpi_card')).toThrow();
  });
});

describe('parseWidgetConfig', () => {
  for (const kind of ALL_WIDGET_KINDS) {
    it(`parses the sample config for kind=${kind}`, () => {
      const widget = buildSampleWidget(kind, `w_${kind}`, 'Sample');
      expect(() => parseWidgetConfig(widget)).not.toThrow();
    });
  }

  it('returns default config when widget.config is null', () => {
    const widget = {
      key: 'w',
      kind: 'kpi_card' as const,
      title: 'KPI',
      config: null,
    };
    const parsed = parseWidgetConfig(
      PortalTabWidgetSchema.parse(widget),
    ) as { label: string };
    expect(parsed.label).toBe('Metric');
  });
});

describe('PortalTabWidgetSchema', () => {
  it('requires genuiKind when kind=genui_part', () => {
    const result = PortalTabWidgetSchema.safeParse({
      key: 'w',
      kind: 'genui_part',
      title: 'AG-UI',
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('accepts genui_part with a genuiKind', () => {
    const result = PortalTabWidgetSchema.safeParse({
      key: 'w',
      kind: 'genui_part',
      title: 'AG-UI',
      config: {},
      genuiKind: 'kpi-grid',
    });
    expect(result.success).toBe(true);
  });

  it('rejects span > 12', () => {
    const result = PortalTabWidgetSchema.safeParse({
      key: 'w',
      kind: 'kpi_card',
      title: 'KPI',
      span: 13,
      config: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects gauge config where min >= max', () => {
    const widget = {
      key: 'w',
      kind: 'gauge' as const,
      title: 'g',
      config: { value: 5, min: 10, max: 0 },
    };
    expect(() =>
      parseWidgetConfig(PortalTabWidgetSchema.parse(widget)),
    ).toThrow();
  });
});

describe('buildSampleWidget', () => {
  it('produces a parseable widget for every kind', () => {
    for (const kind of ALL_WIDGET_KINDS) {
      const w = buildSampleWidget(kind, `k_${kind}`, 'T');
      expect(PortalTabWidgetSchema.safeParse(w).success).toBe(true);
    }
  });
});
