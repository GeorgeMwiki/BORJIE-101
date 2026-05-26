import { describe, expect, it } from 'vitest';
import {
  brandLockPass,
  checkPreferredColors,
} from '../composer/brand-lock-pass.js';
import type { UIHints } from '../types.js';

function hintsWith(colors: ReadonlyArray<string>): UIHints {
  return {
    preferred_size: 'tab',
    preferred_colors: colors,
    preferred_layout: 'cards',
    emphasis: 'narrative',
    mobile_strategy: 'reflow',
  };
}

describe('brand-lock-pass', () => {
  it('passes on var(--borjie-...) tokens', () => {
    const r = brandLockPass({
      hints: hintsWith(['var(--borjie-color-primary)']),
    });
    expect(r.ok).toBe(true);
  });

  it('passes on bare --borjie-* token names', () => {
    const r = brandLockPass({
      hints: hintsWith(['--borjie-color-surface']),
    });
    expect(r.ok).toBe(true);
  });

  it('rejects raw hex colors', () => {
    const r = brandLockPass({
      hints: hintsWith(['#ff0', '#aabbcc']),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.offenders.length).toBe(2);
    }
  });

  it('rejects rgb()/rgba() literals', () => {
    const r = brandLockPass({
      hints: hintsWith(['rgb(255, 0, 0)', 'rgba(255, 0, 0, 0.5)']),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects hsl()/hsla() literals', () => {
    const r = brandLockPass({
      hints: hintsWith(['hsl(120, 50%, 50%)']),
    });
    expect(r.ok).toBe(false);
  });

  it('rejects raw oklch() literals (numeric)', () => {
    const r = brandLockPass({
      hints: hintsWith(['oklch(0.5 0.2 30)']),
    });
    expect(r.ok).toBe(false);
  });

  it('checkPreferredColors returns the offending strings', () => {
    const offenders = checkPreferredColors(
      hintsWith(['var(--borjie-color-x)', '#aaa']),
    );
    expect(offenders).toEqual(['#aaa']);
  });

  it('rejects raw values in stylingStrings', () => {
    const r = brandLockPass({
      hints: hintsWith(['var(--borjie-color-primary)']),
      stylingStrings: ['#1234ff'],
    });
    expect(r.ok).toBe(false);
  });
});
