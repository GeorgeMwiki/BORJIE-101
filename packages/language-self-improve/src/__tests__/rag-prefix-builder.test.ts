import { describe, expect, it } from 'vitest';

import {
  approximateTokenCounter,
  buildRagPrefix,
} from '../adapter/rag-prefix-builder.js';
import type { TrainingPair } from '../types.js';

function mk(id: string, aggregate: number): TrainingPair {
  return Object.freeze({
    id,
    tenantId: 't',
    sourceText: 'sample source ' + id,
    targetText: 'sample target ' + id,
    lang: 'sw',
    utteranceId: null,
    scores: Object.freeze({
      wer: 0.05,
      per: 0.05,
      grammar: 0.9,
      terminology: 0.9,
      aggregate,
      recipientConsent: 'per-user-learn' as const,
    }),
    included: true,
    exclusionReason: null,
    recordedAt: '2026-05-26T10:00:00Z',
    auditHash: 'h',
    prevHash: 'p',
  });
}

describe('rag-prefix-builder', () => {
  it('respects the token budget', () => {
    const pairs = Array.from({ length: 50 }, (_, i) => mk(`p${i}`, 0.9));
    const result = buildRagPrefix(pairs, {
      maxTokens: 100,
      preamble: 'pre',
      tokenCounter: approximateTokenCounter,
    });
    expect(result.tokenCount).toBeLessThanOrEqual(100);
    expect(result.includedPairCount).toBeLessThan(50);
  });

  it('returns just the preamble when no pairs provided', () => {
    const result = buildRagPrefix([]);
    expect(result.includedPairCount).toBe(0);
  });

  it('orders exemplars by aggregate score descending', () => {
    const pairs = [mk('low', 0.5), mk('high', 0.99), mk('mid', 0.75)];
    const result = buildRagPrefix(pairs, {
      maxTokens: 10_000,
      preamble: 'X',
      tokenCounter: approximateTokenCounter,
    });
    const highIndex = result.text.indexOf('high');
    const midIndex = result.text.indexOf('mid');
    const lowIndex = result.text.indexOf('low');
    expect(highIndex).toBeLessThan(midIndex);
    expect(midIndex).toBeLessThan(lowIndex);
  });
});
