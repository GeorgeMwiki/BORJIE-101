import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COST_PER_1K_CENTS,
  nextAllowedTier,
  projectCallCostCents,
} from '../index.js';

describe('nextAllowedTier', () => {
  it('returns the next-cheapest allowed tier', () => {
    expect(nextAllowedTier('opus', ['haiku', 'sonnet', 'opus'])).toBe('sonnet');
    expect(nextAllowedTier('sonnet', ['haiku', 'sonnet', 'opus'])).toBe('haiku');
  });

  it('skips disallowed intermediate tiers', () => {
    expect(nextAllowedTier('opus', ['haiku', 'opus'])).toBe('haiku');
  });

  it('returns null when at the bottom', () => {
    expect(nextAllowedTier('haiku', ['haiku', 'sonnet', 'opus'])).toBeNull();
  });

  it('returns null when nothing cheaper is allowed', () => {
    expect(nextAllowedTier('sonnet', ['sonnet'])).toBeNull();
  });
});

describe('projectCallCostCents', () => {
  it('uses opus pricing for opus', () => {
    const cents = projectCallCostCents(1000, 'opus', DEFAULT_COST_PER_1K_CENTS);
    expect(cents).toBe(DEFAULT_COST_PER_1K_CENTS.opus);
  });

  it('uses sonnet pricing for sonnet', () => {
    const cents = projectCallCostCents(1000, 'sonnet', DEFAULT_COST_PER_1K_CENTS);
    expect(cents).toBe(DEFAULT_COST_PER_1K_CENTS.sonnet);
  });

  it('uses haiku pricing for haiku', () => {
    const cents = projectCallCostCents(1000, 'haiku', DEFAULT_COST_PER_1K_CENTS);
    expect(cents).toBe(DEFAULT_COST_PER_1K_CENTS.haiku);
  });

  it('rounds to the nearest cent', () => {
    const cents = projectCallCostCents(33, 'haiku', DEFAULT_COST_PER_1K_CENTS);
    expect(Number.isInteger(cents)).toBe(true);
  });

  it('scales linearly with tokens', () => {
    const a = projectCallCostCents(2000, 'opus', DEFAULT_COST_PER_1K_CENTS);
    const b = projectCallCostCents(4000, 'opus', DEFAULT_COST_PER_1K_CENTS);
    expect(b).toBe(2 * a);
  });
});
