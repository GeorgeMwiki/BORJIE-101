/**
 * block-selector tests — CE-6.
 */

import { describe, it, expect } from 'vitest';
import { selectInlineBlock } from '../block-selector.js';

describe('selectInlineBlock — overrides', () => {
  it('forceKind always wins', () => {
    expect(selectInlineBlock({ rows: [{ a: 1, b: 2 }] }, { forceKind: 'mini_metric' }))
      .toBe('mini_metric');
  });

  it('isPlan returns plan_preview regardless of result shape', () => {
    expect(selectInlineBlock({ rows: [] }, { isPlan: true })).toBe('plan_preview');
  });

  it('HIGH stakes returns confirmation_card', () => {
    expect(selectInlineBlock({ ok: true }, { stakes: 'HIGH' })).toBe(
      'confirmation_card',
    );
  });

  it('forceKind beats isPlan + stakes', () => {
    expect(
      selectInlineBlock({}, { forceKind: 'inline_table', isPlan: true, stakes: 'HIGH' }),
    ).toBe('inline_table');
  });
});

describe('selectInlineBlock — structural inference', () => {
  it('non-object result → none', () => {
    expect(selectInlineBlock(null)).toBe('none');
    expect(selectInlineBlock('hi')).toBe('none');
    expect(selectInlineBlock(42)).toBe('none');
  });

  it('rows of objects → inline_table', () => {
    expect(
      selectInlineBlock({ rows: [{ name: 'a', count: 1 }, { name: 'b', count: 2 }] }),
    ).toBe('inline_table');
  });

  it('items of single-key objects → falls back since not a row', () => {
    expect(selectInlineBlock({ items: [{ a: 1 }] })).toBe('none');
  });

  it('chart-style series → inline_chart', () => {
    expect(
      selectInlineBlock({
        series: [
          { date: '2026-01-01', value: 100 },
          { date: '2026-02-01', value: 120 },
        ],
      }),
    ).toBe('inline_chart');
  });

  it('comparison ranked → inline_comparison', () => {
    expect(
      selectInlineBlock({
        ranked: [
          { name: 'A', score: 0.9 },
          { name: 'B', score: 0.7 },
        ],
      }),
    ).toBe('inline_comparison');
  });

  it('draft text → draft_preview', () => {
    expect(selectInlineBlock({ draft: 'Dear ABC,\n\nIt is with...' })).toBe(
      'draft_preview',
    );
  });

  it('single metric → mini_metric', () => {
    expect(selectInlineBlock({ total: 1_234_567 })).toBe('mini_metric');
  });

  it('plain prose object → none', () => {
    expect(selectInlineBlock({ message: 'Hello there' })).toBe('none');
  });
});

describe('selectInlineBlock — edge cases', () => {
  it('empty arrays do not trigger their inferred kind', () => {
    expect(selectInlineBlock({ rows: [] })).toBe('none');
    expect(selectInlineBlock({ series: [] })).toBe('none');
  });

  it('priority: draft > chart > comparison > table > metric', () => {
    // Object with multiple hint keys — draft wins.
    expect(
      selectInlineBlock({
        draft: 'x',
        series: [{ date: 'd', value: 1 }],
        rows: [{ a: 1, b: 2 }],
        total: 5,
      }),
    ).toBe('draft_preview');
  });
});
