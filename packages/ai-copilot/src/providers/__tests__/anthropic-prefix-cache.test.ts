/**
 * Anthropic prompt prefix-cache coverage.
 *
 * Locks the policy contract:
 *   - system prompt always tagged when present
 *   - tools array tagged when present
 *   - long historical messages tagged only when stable AND > threshold
 *   - never exceeds 4 breakpoints (Anthropic hard limit)
 *   - never mutates the input body
 */

import { describe, it, expect } from 'vitest';
import {
  applyPrefixCache,
  applyPrefixCacheWithTelemetry,
  defaultEstimateTokens,
  defaultHashContent,
  DEFAULT_MAX_BREAKPOINTS,
  DEFAULT_MIN_STABLE_HISTORY_TOKENS,
  EPHEMERAL_CACHE_MARKER,
  type AnthropicRequestBody,
  type AnthropicTextBlock,
  type AnthropicToolDef,
  type PrefixCacheTelemetryEvent,
} from '../anthropic-prefix-cache.js';

function buildBody(over: Partial<AnthropicRequestBody> = {}): AnthropicRequestBody {
  return {
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'hi' }],
    ...over,
  };
}

describe('applyPrefixCache — disabled', () => {
  it('returns the body unchanged when enabled=false', () => {
    const body = buildBody({ system: 'You are Claude.' });
    const result = applyPrefixCache(body, { enabled: false });
    expect(result.body).toBe(body);
    expect(result.breakpointsApplied).toBe(0);
  });

  it('returns the body unchanged when maxBreakpoints=0', () => {
    const body = buildBody({ system: 'sys' });
    const result = applyPrefixCache(body, { maxBreakpoints: 0 });
    expect(result.body).toBe(body);
    expect(result.markedSystem).toBe(false);
  });
});

describe('applyPrefixCache — system prompt', () => {
  it('tags a string system prompt with cache_control', () => {
    const body = buildBody({ system: 'You are Claude. Be helpful.' });
    const result = applyPrefixCache(body);
    expect(result.markedSystem).toBe(true);
    expect(Array.isArray(result.body.system)).toBe(true);
    const blocks = result.body.system as ReadonlyArray<AnthropicTextBlock>;
    expect(blocks[0]?.cache_control).toEqual(EPHEMERAL_CACHE_MARKER);
    expect(blocks[0]?.text).toBe('You are Claude. Be helpful.');
  });

  it('tags the LAST block of an array system prompt', () => {
    const body = buildBody({
      system: [
        { type: 'text', text: 'block one' },
        { type: 'text', text: 'block two' },
      ],
    });
    const result = applyPrefixCache(body);
    const blocks = result.body.system as ReadonlyArray<AnthropicTextBlock>;
    expect(blocks[0]?.cache_control).toBeUndefined();
    expect(blocks[1]?.cache_control).toEqual(EPHEMERAL_CACHE_MARKER);
  });

  it('skips marking when system is empty string', () => {
    const body = buildBody({ system: '' });
    const result = applyPrefixCache(body);
    expect(result.markedSystem).toBe(false);
  });

  it('does NOT mutate the input body', () => {
    const body = buildBody({ system: 'sys' });
    const snapshot = JSON.stringify(body);
    applyPrefixCache(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });
});

describe('applyPrefixCache — tools', () => {
  const tools: ReadonlyArray<AnthropicToolDef> = [
    {
      name: 'lookup_lease',
      description: 'Look up a lease by id',
      input_schema: { type: 'object', properties: {} },
    },
    {
      name: 'compute_rent',
      description: 'Compute prorated rent',
      input_schema: { type: 'object', properties: {} },
    },
  ];

  it('tags the LAST tool definition with cache_control', () => {
    const body = buildBody({ tools });
    const result = applyPrefixCache(body);
    expect(result.markedTools).toBe(true);
    const out = result.body.tools as ReadonlyArray<AnthropicToolDef>;
    expect(out[0]?.cache_control).toBeUndefined();
    expect(out[1]?.cache_control).toEqual(EPHEMERAL_CACHE_MARKER);
  });

  it('skips marking when tools is empty', () => {
    const body = buildBody({ tools: [] });
    const result = applyPrefixCache(body);
    expect(result.markedTools).toBe(false);
  });
});

describe('applyPrefixCache — historical messages', () => {
  it('does NOT mark when no stableHistoryHashes supplied', () => {
    const longContent = 'x'.repeat(5_000); // ~1250 tokens
    const body = buildBody({
      messages: [
        { role: 'user', content: longContent },
        { role: 'assistant', content: 'short reply' },
        { role: 'user', content: 'follow up' },
      ],
    });
    const result = applyPrefixCache(body);
    expect(result.markedHistoryIndices).toEqual([]);
  });

  it('marks stable + long historical messages', () => {
    const longContent = 'x'.repeat(5_000);
    const stableHashes = new Set<string>([defaultHashContent(longContent)]);
    const body = buildBody({
      messages: [
        { role: 'user', content: longContent },
        { role: 'assistant', content: 'short reply' },
        { role: 'user', content: 'follow up' },
      ],
    });
    const result = applyPrefixCache(body, { stableHistoryHashes: stableHashes });
    expect(result.markedHistoryIndices).toEqual([0]);
    const messages = result.body.messages as ReadonlyArray<{
      content: ReadonlyArray<AnthropicTextBlock>;
    }>;
    const blocks = messages[0]?.content;
    expect(Array.isArray(blocks)).toBe(true);
    if (Array.isArray(blocks)) {
      const last = blocks[blocks.length - 1];
      expect(last?.cache_control).toEqual(EPHEMERAL_CACHE_MARKER);
    }
  });

  it('does NOT mark short historical messages even when in stable set', () => {
    const shortContent = 'short text'; // ~3 tokens
    const stableHashes = new Set<string>([defaultHashContent(shortContent)]);
    const body = buildBody({
      messages: [
        { role: 'user', content: shortContent },
        { role: 'user', content: 'now' },
      ],
    });
    const result = applyPrefixCache(body, { stableHistoryHashes: stableHashes });
    expect(result.markedHistoryIndices).toEqual([]);
  });

  it('never marks the FINAL message (current turn)', () => {
    const longContent = 'x'.repeat(8_000);
    const hashes = new Set<string>([defaultHashContent(longContent)]);
    const body = buildBody({
      messages: [{ role: 'user', content: longContent }],
    });
    const result = applyPrefixCache(body, { stableHistoryHashes: hashes });
    expect(result.markedHistoryIndices).toEqual([]);
  });

  it('respects custom minStableHistoryTokens threshold', () => {
    const mid = 'y'.repeat(200); // ~50 tokens
    const hashes = new Set<string>([defaultHashContent(mid)]);
    const body = buildBody({
      messages: [
        { role: 'user', content: mid },
        { role: 'user', content: 'final' },
      ],
    });
    const result = applyPrefixCache(body, {
      stableHistoryHashes: hashes,
      minStableHistoryTokens: 10,
    });
    expect(result.markedHistoryIndices).toEqual([0]);
  });
});

describe('applyPrefixCache — breakpoint cap', () => {
  it('never emits more than 4 breakpoints (Anthropic hard limit)', () => {
    const longContent = (n: number): string => 'x'.repeat(5_000 + n);
    const contents = [longContent(0), longContent(1), longContent(2), longContent(3)];
    const hashes = new Set<string>(contents.map(defaultHashContent));
    const body = buildBody({
      system: 'sys',
      tools: [
        {
          name: 'tool_a',
          description: '',
          input_schema: {},
        },
      ],
      messages: [
        { role: 'user', content: contents[0] ?? '' },
        { role: 'assistant', content: contents[1] ?? '' },
        { role: 'user', content: contents[2] ?? '' },
        { role: 'assistant', content: contents[3] ?? '' },
        { role: 'user', content: 'current turn' },
      ],
    });
    const result = applyPrefixCache(body, { stableHistoryHashes: hashes });
    expect(result.breakpointsApplied).toBeLessThanOrEqual(DEFAULT_MAX_BREAKPOINTS);
    expect(result.breakpointsApplied).toBe(4);
    // System + tools consume 2; only 2 historical breakpoints remain
    // even though all 4 are eligible.
    expect(result.markedSystem).toBe(true);
    expect(result.markedTools).toBe(true);
    expect(result.markedHistoryIndices.length).toBe(2);
  });

  it('honors a custom maxBreakpoints below the global cap', () => {
    const body = buildBody({
      system: 'sys',
      tools: [{ name: 't', description: '', input_schema: {} }],
    });
    const result = applyPrefixCache(body, { maxBreakpoints: 1 });
    expect(result.breakpointsApplied).toBe(1);
    expect(result.markedSystem).toBe(true);
    expect(result.markedTools).toBe(false);
  });
});

describe('helpers', () => {
  it('defaultEstimateTokens returns 0 for empty input', () => {
    expect(defaultEstimateTokens('')).toBe(0);
  });
  it('defaultEstimateTokens rounds UP — 5 chars ≈ 2 tokens', () => {
    expect(defaultEstimateTokens('abcde')).toBe(2);
  });
  it('defaultHashContent is deterministic + scope-stable', () => {
    expect(defaultHashContent('hello')).toBe(defaultHashContent('hello'));
    expect(defaultHashContent('hello')).not.toBe(defaultHashContent('world'));
  });
  it('DEFAULT_MIN_STABLE_HISTORY_TOKENS is 1024 (Anthropic guidance)', () => {
    expect(DEFAULT_MIN_STABLE_HISTORY_TOKENS).toBe(1024);
  });
});

describe('applyPrefixCacheWithTelemetry', () => {
  it('emits a telemetry event with marked-block counts', () => {
    const events: PrefixCacheTelemetryEvent[] = [];
    const body = buildBody({
      system: 'sys',
      tools: [{ name: 't', description: '', input_schema: {} }],
    });
    applyPrefixCacheWithTelemetry(body, {}, { record: (e) => events.push(e) });
    expect(events.length).toBe(1);
    expect(events[0]?.breakpointsApplied).toBe(2);
    expect(events[0]?.markedSystem).toBe(true);
    expect(events[0]?.markedTools).toBe(true);
    expect(events[0]?.markedHistoryCount).toBe(0);
  });

  it('sink failure does not throw', () => {
    const body = buildBody({ system: 'sys' });
    expect(() =>
      applyPrefixCacheWithTelemetry(body, {}, {
        record: () => {
          throw new Error('telemetry down');
        },
      }),
    ).not.toThrow();
  });
});
