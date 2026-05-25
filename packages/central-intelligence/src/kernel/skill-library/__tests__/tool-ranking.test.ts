/**
 * Embedding-indexed ToolSearch — unit tests.
 *
 * The ranker pre-computes embeddings of `(name + description +
 * sample-args)` for each tool and returns top-k by cosine. These tests
 * use a deterministic word-vector embedder so we can pin expected
 * orderings.
 *
 * Coverage:
 *   1. ranks tools by cosine to the goal embedding.
 *   2. honours the top-k limit.
 *   3. falls back to keyword ranker when embedder is null.
 *   4. falls back when embedder throws on the goal.
 *   5. uses the shared cache so re-runs don't re-embed.
 *   6. empty goal → empty result.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createEmbeddingToolSearch,
  type ToolDescriptor,
} from '../../orchestrator/context-budget.js';
import type { TextEmbedder } from '../../kernel-types.js';

/**
 * Deterministic embedder. Splits the text on non-alpha and emits a
 * sparse vector counting each token in a fixed lexicon. Identical
 * texts produce identical vectors so the cosine ranker is fully
 * predictable.
 */
function deterministicEmbedder(): TextEmbedder & { calls: number } {
  const vocab = [
    'sms',
    'phone',
    'send',
    'email',
    'mail',
    'arrears',
    'tenant',
    'lookup',
    'budget',
    'forecast',
    'invoice',
    'pay',
    'refund',
  ];
  return {
    calls: 0,
    async embed(text: string) {
      this.calls += 1;
      const lower = text.toLowerCase();
      return vocab.map((w) => {
        const matches = lower.match(new RegExp(`\\b${w}\\b`, 'g'));
        return matches === null ? 0 : matches.length;
      });
    },
  };
}

const TOOLS: ReadonlyArray<ToolDescriptor> = [
  {
    name: 'sendSms',
    description: 'Send an sms message to a phone number',
    keywords: ['sms', 'phone', 'send'],
    sampleArgs: ['phone +255700000000'],
  },
  {
    name: 'sendEmail',
    description: 'Send an email message to a mail address',
    keywords: ['email', 'mail', 'send'],
    sampleArgs: ['email tenant@example.com'],
  },
  {
    name: 'lookupTenantArrears',
    description: 'Look up tenant arrears balance',
    keywords: ['lookup', 'arrears', 'tenant'],
    sampleArgs: ['tenant T-7'],
  },
  {
    name: 'forecastBudget',
    description: 'Forecast the budget for a property',
    keywords: ['budget', 'forecast'],
    sampleArgs: [],
  },
];

describe('createEmbeddingToolSearch', () => {
  it('ranks tools by cosine similarity to the goal embedding', async () => {
    const embedder = deterministicEmbedder();
    const search = createEmbeddingToolSearch(TOOLS, { embedder });
    const out = await search.searchRelevant('please send sms to tenant', 4);
    expect(out[0]?.name).toBe('sendSms');
  });

  it('honours the top-k limit', async () => {
    const embedder = deterministicEmbedder();
    const search = createEmbeddingToolSearch(TOOLS, { embedder });
    const out = await search.searchRelevant('send sms', 2);
    expect(out).toHaveLength(2);
  });

  it('falls back to keyword ranker when embedder is null', async () => {
    const search = createEmbeddingToolSearch(TOOLS, { embedder: null });
    const out = await search.searchRelevant('send sms phone', 3);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((t) => t.name === 'sendSms')).toBe(true);
  });

  it('falls back when embedder throws on the goal', async () => {
    const flaky: TextEmbedder = {
      async embed() {
        throw new Error('boom');
      },
    };
    const search = createEmbeddingToolSearch(TOOLS, { embedder: flaky });
    const out = await search.searchRelevant('send sms phone', 3);
    expect(out.length).toBeGreaterThan(0);
  });

  it('reuses the shared embedding cache across instances', async () => {
    const cache = new Map<string, ReadonlyArray<number>>();
    const embedder1 = deterministicEmbedder();
    const search1 = createEmbeddingToolSearch(TOOLS, {
      embedder: embedder1,
      cache,
    });
    await search1.searchRelevant('send sms', 4);
    const callsAfterFirst = embedder1.calls;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const embedder2 = deterministicEmbedder();
    const search2 = createEmbeddingToolSearch(TOOLS, {
      embedder: embedder2,
      cache,
    });
    await search2.searchRelevant('send sms', 4);
    // Second instance only embedded the goal — tool corpora were warm.
    expect(embedder2.calls).toBe(1);
  });

  it('returns empty for an empty goal', async () => {
    const embedder = deterministicEmbedder();
    const search = createEmbeddingToolSearch(TOOLS, { embedder });
    expect(await search.searchRelevant('   ', 3)).toEqual([]);
  });

  it('falls back when no tool produced a positive cosine', async () => {
    const fallback = {
      searchRelevant: vi.fn(async () => [
        TOOLS[3] as ToolDescriptor, // forecastBudget
      ]),
    };
    // Orthogonal: goal vocab disjoint from any tool corpus token.
    const orth: TextEmbedder = {
      async embed(text: string) {
        // tools embed via lexicon match; for the goal we return a vector
        // whose only non-zero slot is at index 0 ('sms')—but we use the
        // same embedder for tools below in deterministicEmbedder. To
        // force the fallback, we lie: zero vector for the goal.
        if (text.includes('GOAL')) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        return deterministicEmbedder().embed(text);
      },
    };
    const search = createEmbeddingToolSearch(TOOLS, {
      embedder: orth,
      fallback,
    });
    const out = await search.searchRelevant('GOAL TEXT', 1);
    expect(fallback.searchRelevant).toHaveBeenCalled();
    expect(out[0]?.name).toBe('forecastBudget');
  });
});
