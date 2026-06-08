import { describe, expect, it } from 'vitest';
import {
  MODEL_PRICE_CARD,
  callCostCents,
  costWeightedTokens,
  modelCostWeight,
} from '../metering.js';

describe('MODEL_PRICE_CARD', () => {
  it('matches the doc §1.3 list-price card ($/M in/out)', () => {
    expect(MODEL_PRICE_CARD.haiku).toEqual({
      inputPerMillionUsd: 1,
      outputPerMillionUsd: 5,
    });
    expect(MODEL_PRICE_CARD.sonnet).toEqual({
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
    });
    expect(MODEL_PRICE_CARD.opus).toEqual({
      inputPerMillionUsd: 5,
      outputPerMillionUsd: 25,
    });
  });

  it('is frozen (immutability)', () => {
    expect(Object.isFrozen(MODEL_PRICE_CARD)).toBe(true);
  });
});

describe('callCostCents', () => {
  it('prices 1M output Opus tokens at $25 = 2500 cents', () => {
    expect(callCostCents('opus', 0, 1_000_000)).toBe(2500);
  });

  it('prices 1M input + 1M output Sonnet at $3 + $15 = 1800 cents', () => {
    expect(callCostCents('sonnet', 1_000_000, 1_000_000)).toBe(1800);
  });

  it('returns 0 for a zero-token call', () => {
    expect(callCostCents('haiku', 0, 0)).toBe(0);
  });

  it('rejects negative token counts', () => {
    expect(() => callCostCents('opus', -1, 0)).toThrow();
    expect(() => callCostCents('opus', 0, NaN)).toThrow();
  });
});

describe('costWeightedTokens — the cost-weighted meter unit', () => {
  it('weights Opus ~1.7x Sonnet for the same token shape (doc §1.3)', () => {
    const sonnet = costWeightedTokens('sonnet', 1000, 1000);
    const opus = costWeightedTokens('opus', 1000, 1000);
    const ratio = opus / sonnet;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(1.75);
  });

  it('weights Haiku well below Sonnet (cheaper → fewer units)', () => {
    const sonnet = costWeightedTokens('sonnet', 1000, 1000);
    const haiku = costWeightedTokens('haiku', 1000, 1000);
    expect(haiku).toBeLessThan(sonnet);
    expect(haiku / sonnet).toBeCloseTo(1 / 3, 1);
  });

  it('a balanced Sonnet call ≈ raw token count (Sonnet is the anchor)', () => {
    // 1000 in + 1000 out at the 50/50 reference mix ≈ 2000 weighted units.
    const weighted = costWeightedTokens('sonnet', 1000, 1000);
    expect(weighted).toBeCloseTo(2000, 0);
  });

  it('output tokens cost more than input tokens (per the price card)', () => {
    const inputOnly = costWeightedTokens('opus', 1000, 0);
    const outputOnly = costWeightedTokens('opus', 0, 1000);
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });

  it('is additive across input/output (pure linear meter)', () => {
    const a = costWeightedTokens('sonnet', 500, 0);
    const b = costWeightedTokens('sonnet', 0, 500);
    const both = costWeightedTokens('sonnet', 500, 500);
    expect(both).toBeCloseTo(a + b, 6);
  });

  it('returns 0 for a zero-token call and rejects negatives', () => {
    expect(costWeightedTokens('opus', 0, 0)).toBe(0);
    expect(() => costWeightedTokens('opus', -5, 0)).toThrow();
  });
});

describe('modelCostWeight', () => {
  it('is 1.0 for the Sonnet reference and ~1.667 for Opus', () => {
    expect(modelCostWeight('sonnet')).toBe(1);
    expect(modelCostWeight('opus')).toBeCloseTo(25 / 15, 5);
    expect(modelCostWeight('haiku')).toBeCloseTo(5 / 15, 5);
  });
});
