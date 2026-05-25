import { describe, expect, it } from 'vitest';
import {
  cachedSystemPrompt,
  estimatePromptCacheSavings,
  splitForPromptCache,
} from '../prompt-cache/cached-system-prompt.js';

describe('cachedSystemPrompt', () => {
  it('wraps a system string into a single text block with ephemeral cache_control', () => {
    const blocks = cachedSystemPrompt({ system: 'You are an assistant.' });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual({
      type: 'text',
      text: 'You are an assistant.',
      cache_control: { type: 'ephemeral' },
    });
  });

  it('respects custom ttl marker', () => {
    const blocks = cachedSystemPrompt({
      system: 'long prefix',
      cacheControl: { type: 'ephemeral', ttl: '1h' },
    });
    expect(blocks[0]?.cache_control?.ttl).toBe('1h');
  });
});

describe('splitForPromptCache', () => {
  it('tags last block of each message <= stableThroughIndex as cacheable', () => {
    const result = splitForPromptCache({
      messages: [
        { role: 'user', content: 'rules' },
        { role: 'assistant', content: 'understood' },
        { role: 'user', content: 'live question' },
      ],
      stableThroughIndex: 1,
    });
    expect(result.cacheable).toHaveLength(2);
    expect(result.live).toHaveLength(1);
    const firstCacheableBlocks = result.cacheable[0]!.content as readonly { cache_control?: unknown }[];
    expect(firstCacheableBlocks[firstCacheableBlocks.length - 1]!.cache_control).toEqual({
      type: 'ephemeral',
      ttl: '5m',
    });
  });

  it('honours ttl=1h when requested', () => {
    const result = splitForPromptCache({
      messages: [{ role: 'user', content: 'rules' }, { role: 'user', content: 'live' }],
      stableThroughIndex: 0,
      ttl: '1h',
    });
    const blocks = result.cacheable[0]!.content as readonly { cache_control?: { ttl?: string } }[];
    expect(blocks[blocks.length - 1]!.cache_control?.ttl).toBe('1h');
  });

  it('falls back to "all but last" when stableThroughIndex omitted', () => {
    const result = splitForPromptCache({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c' },
      ],
    });
    expect(result.live).toHaveLength(1);
    expect(result.cacheable).toHaveLength(2);
  });
});

describe('estimatePromptCacheSavings', () => {
  it('returns ~90% savings for cache reads (Anthropic 0.1× multiplier)', () => {
    const est = estimatePromptCacheSavings({
      cachedTokens: 1_000_000,
      pricePerMillionInputUsd: 3, // Claude Sonnet 4 input price
    });
    expect(est.hitSavingsPercent).toBe(90);
    expect(est.readCostMultiplier).toBe(0.1);
    expect(est.estimatedHitCostUsd).toBeCloseTo(0.3, 2);
  });

  it('uses 1.25× write multiplier for 5-minute TTL', () => {
    const est = estimatePromptCacheSavings({
      cachedTokens: 1_000_000,
      pricePerMillionInputUsd: 3,
    });
    expect(est.writeCostMultiplier).toBe(1.25);
    expect(est.estimatedMissCostUsd).toBeCloseTo(3.75, 2);
  });

  it('uses 2.0× write multiplier for 1-hour TTL', () => {
    const est = estimatePromptCacheSavings({
      cachedTokens: 1_000_000,
      pricePerMillionInputUsd: 3,
      ttl: '1h',
    });
    expect(est.writeCostMultiplier).toBe(2.0);
    expect(est.estimatedMissCostUsd).toBeCloseTo(6, 2);
  });
});
