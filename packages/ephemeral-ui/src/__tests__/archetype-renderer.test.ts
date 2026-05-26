import { describe, expect, it } from 'vitest';
import { renderArchetype } from '../composer/archetype-renderer.js';
import type { UIHints } from '../types.js';

const hints: UIHints = {
  preferred_size: 'tab',
  preferred_colors: ['var(--borjie-color-primary)'],
  preferred_layout: 'cards',
  emphasis: 'narrative',
  mobile_strategy: 'reflow',
};

describe('renderArchetype', () => {
  it('renders list_with_filters with a filter_bar + list', () => {
    const p = renderArchetype(
      'list_with_filters',
      { items: [{ id: 'a' }], filters: ['site'] },
      hints,
    );
    expect(p.archetype).toBe('list_with_filters');
    expect(p.sections.map((s) => s.kind)).toEqual(['filter_bar', 'list']);
  });

  it('renders chart_with_table with chart + table', () => {
    const p = renderArchetype(
      'chart_with_table',
      { series: [1, 2, 3], rows: [{ a: 1 }] },
      hints,
    );
    expect(p.archetype).toBe('chart_with_table');
    expect(p.sections.map((s) => s.kind)).toEqual(['chart', 'table']);
  });

  it('renders kpi_grid with kpi section', () => {
    const p = renderArchetype(
      'kpi_grid',
      { kpis: [{ id: 'usd_exposure', value: 1_200_000 }] },
      hints,
    );
    expect(p.archetype).toBe('kpi_grid');
    expect(p.sections[0]?.kind).toBe('kpi');
  });

  it('falls back to numeric top-level fields when kpis missing', () => {
    const p = renderArchetype(
      'kpi_grid',
      { usd: 100, eur: 50, label: 'ignored' },
      hints,
    );
    expect(p.sections[0]?.kind).toBe('kpi');
    const kpis = (p.sections[0]?.payload['kpis'] ?? []) as ReadonlyArray<{
      id: string;
      value: unknown;
    }>;
    expect(kpis.map((k) => k.id).sort()).toEqual(['eur', 'usd']);
  });

  it('renders a fallback for non-Phase-1 archetypes', () => {
    const archetypes = [
      'map_with_overlays',
      'pipeline_kanban',
      'calendar_timeline',
      'document_render',
      'split_compare',
      'wizard_form',
      'detail_with_chain',
      'composite',
    ] as const;
    for (const a of archetypes) {
      const p = renderArchetype(a, { something: 1 }, hints);
      expect(p.archetype).toBe(a);
      expect(p.sections[0]?.kind).toBe('fallback');
    }
  });
});
