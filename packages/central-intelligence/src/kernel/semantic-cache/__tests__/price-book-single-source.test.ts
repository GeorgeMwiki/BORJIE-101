/**
 * Proof: the semantic-cache cost rates are read from THE single
 * PriceBook source (`@borjie/brain-llm-router/price-book`) and still
 * carry EXACTLY the figures the cache shipped before the consolidation
 * (zero-behavior-change repoint).
 */

import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_PRICE_RATES,
  getDefaultPriceBook,
} from '@borjie/brain-llm-router/price-book';

import {
  HAIKU_4_5_RATE,
  OPUS_4_6_RATE,
  SONNET_4_6_RATE,
  createCostRateRegistry,
} from '../semantic-cache.js';

describe('semantic-cache rates — single PriceBook source', () => {
  it('rate consts are reference-identical to the PriceBook rows', () => {
    expect(SONNET_4_6_RATE).toBe(ANTHROPIC_PRICE_RATES.sonnet);
    expect(OPUS_4_6_RATE).toBe(ANTHROPIC_PRICE_RATES.opus);
    expect(HAIKU_4_5_RATE).toBe(ANTHROPIC_PRICE_RATES.haiku);
  });

  it('figures are unchanged from the pre-consolidation table', () => {
    expect(SONNET_4_6_RATE).toEqual({
      modelId: 'claude-sonnet-4-6',
      promptUsdPer1k: 0.003,
      completionUsdPer1k: 0.015,
    });
    expect(OPUS_4_6_RATE).toEqual({
      modelId: 'claude-opus-4-8',
      promptUsdPer1k: 0.005,
      completionUsdPer1k: 0.025,
    });
    expect(HAIKU_4_5_RATE).toEqual({
      modelId: 'claude-haiku-4-5',
      promptUsdPer1k: 0.0008,
      completionUsdPer1k: 0.004,
    });
  });

  it('registry rates equal PriceBook rates for the same model id', () => {
    const registry = createCostRateRegistry();
    const book = getDefaultPriceBook();
    for (const modelId of [
      'claude-sonnet-4-6',
      'claude-opus-4-8',
      'claude-haiku-4-5',
    ]) {
      const fromRegistry = registry.rateFor(modelId);
      const fromBook = book.getRates(modelId);
      expect(fromRegistry.promptUsdPer1k).toBe(fromBook.promptUsdPer1k);
      expect(fromRegistry.completionUsdPer1k).toBe(
        fromBook.completionUsdPer1k,
      );
    }
  });
});
