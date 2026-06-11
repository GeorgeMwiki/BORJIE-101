/**
 * Unit tests for the render-time locale-purity gate — the machine-check
 * behind the EN/SW absolute toggle (CLAUDE.md hard rail).
 */

import { describe, expect, it } from 'vitest';
import { assertLocalePurity, extractText } from '../locale-purity.js';

describe('assertLocalePurity', () => {
  it('passes a clean English view', () => {
    const view = {
      title: 'Mineral Royalty Statement',
      totals: { total: 'Total royalty payable' },
    };
    expect(assertLocalePurity(view, 'en').ok).toBe(true);
  });

  it('passes a clean Swahili view', () => {
    const view = {
      title: 'Taarifa ya Mrabaha wa Madini',
      totals: { jumla: 'Jumla ya mrabaha inayolipwa' },
    };
    expect(assertLocalePurity(view, 'sw').ok).toBe(true);
  });

  it('flags a Swahili leak inside an English document', () => {
    const view = { title: 'Royalty Statement', note: 'Jumla ya mrabaha' };
    const result = assertLocalePurity(view, 'en');
    expect(result.ok).toBe(false);
    expect(result.leaks).toContain('jumla');
    expect(result.leaks).toContain('mrabaha');
  });

  it('flags an English leak inside a Swahili document', () => {
    const view = { title: 'Taarifa ya Madini', note: 'Total signature' };
    const result = assertLocalePurity(view, 'sw');
    expect(result.ok).toBe(false);
    expect(result.leaks).toContain('total');
    expect(result.leaks).toContain('signature');
  });

  it('extractText walks nested arrays + objects', () => {
    const view = {
      a: 'one',
      b: ['two', { c: 'three' }],
      d: 42,
    };
    const text = extractText(view);
    expect(text).toContain('one');
    expect(text).toContain('two');
    expect(text).toContain('three');
    expect(text).not.toContain('42');
  });
});
