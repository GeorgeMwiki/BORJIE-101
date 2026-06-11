/**
 * PriceBook — single-source price-table contract.
 *
 * The literal ids + figures below are the PROOF HARNESS: they assert the
 * consolidated table still ships EXACTLY the numbers the two former
 * consumers (ai-governance `costPerToken` + semantic-cache rate consts)
 * carried, so the consolidation is a zero-behavior-change repoint.
 */

import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_PRICE_RATES,
  DEFAULT_PRICE_RATE_ID,
  PRICE_BOOK_FALLBACK_RATES,
  createPriceBook,
  getDefaultPriceBook,
  type ModelPriceRate,
} from '../price-book.js';

/** The exact figures both former tables shipped (USD per 1K tokens). */
const EXPECTED_TABLE: ReadonlyArray<readonly [string, number, number]> = [
  ['claude-opus-4-8', 0.005, 0.025],
  ['claude-sonnet-4-6', 0.003, 0.015],
  ['claude-haiku-4-5', 0.0008, 0.004],
  ['gpt-4-turbo-preview', 0.01, 0.03],
  ['gpt-4-turbo', 0.01, 0.03],
  ['gpt-4', 0.03, 0.06],
  ['gpt-3.5-turbo', 0.0005, 0.0015],
  ['default', 0.003, 0.015],
];

describe('price-book — frozen fallback table', () => {
  it('ships EXACTLY the figures both former consumers carried', () => {
    const book = getDefaultPriceBook();
    for (const [modelId, prompt, completion] of EXPECTED_TABLE) {
      const rates = book.getRates(modelId);
      expect(rates.modelId).toBe(modelId);
      expect(rates.promptUsdPer1k).toBe(prompt);
      expect(rates.completionUsdPer1k).toBe(completion);
    }
  });

  it('anthropic rows are keyed by the dynamic-registry baselines', () => {
    expect(ANTHROPIC_PRICE_RATES.opus.modelId).toBe('claude-opus-4-8');
    expect(ANTHROPIC_PRICE_RATES.sonnet.modelId).toBe('claude-sonnet-4-6');
    expect(ANTHROPIC_PRICE_RATES.haiku.modelId).toBe('claude-haiku-4-5');
  });

  it('unknown model ids fall back to the default (Sonnet-class) row', () => {
    const rates = getDefaultPriceBook().getRates('some-future-model');
    expect(rates.modelId).toBe(DEFAULT_PRICE_RATE_ID);
    expect(rates.promptUsdPer1k).toBe(0.003);
    expect(rates.completionUsdPer1k).toBe(0.015);
  });

  it('table rows are frozen', () => {
    expect(Object.isFrozen(PRICE_BOOK_FALLBACK_RATES)).toBe(true);
    for (const row of PRICE_BOOK_FALLBACK_RATES) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });
});

describe('price-book — refresh seam', () => {
  it('is a no-op without a source', async () => {
    const book = createPriceBook();
    await expect(book.refresh()).resolves.toBe(0);
  });

  it('merges valid source rows OVER the fallback', async () => {
    const fresh: ModelPriceRate = {
      modelId: 'claude-sonnet-4-6',
      promptUsdPer1k: 0.004,
      completionUsdPer1k: 0.02,
    };
    const book = createPriceBook({
      source: { load: async () => [fresh] },
    });
    // Before refresh: fallback figures.
    expect(book.getRates('claude-sonnet-4-6').promptUsdPer1k).toBe(0.003);
    await expect(book.refresh()).resolves.toBe(1);
    expect(book.getRates('claude-sonnet-4-6').promptUsdPer1k).toBe(0.004);
    // Untouched rows keep the fallback figures.
    expect(book.getRates('claude-haiku-4-5').promptUsdPer1k).toBe(0.0008);
  });

  it('rejects malformed rows and survives source faults', async () => {
    const bad = createPriceBook({
      source: {
        load: async () =>
          [
            { modelId: '', promptUsdPer1k: 1, completionUsdPer1k: 1 },
            { modelId: 'x', promptUsdPer1k: Number.NaN, completionUsdPer1k: 1 },
          ] as ReadonlyArray<ModelPriceRate>,
      },
    });
    await expect(bad.refresh()).resolves.toBe(0);

    const throwing = createPriceBook({
      source: {
        load: async () => {
          throw new Error('db down');
        },
      },
    });
    await expect(throwing.refresh()).resolves.toBe(0);
    // Snapshot intact after the fault.
    expect(throwing.getRates('claude-opus-4-8').completionUsdPer1k).toBe(0.025);
  });
});
