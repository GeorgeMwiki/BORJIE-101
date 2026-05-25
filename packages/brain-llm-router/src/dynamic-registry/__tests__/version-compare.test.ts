/**
 * Tests for `version-compare.ts` — numeric-aware id ordering.
 */

import { describe, expect, it } from 'vitest';
import { compareModelIds, pickNewest } from '../version-compare.js';

describe('compareModelIds', () => {
  it('returns 0 for equal ids', () => {
    expect(compareModelIds('claude-opus-4-7', 'claude-opus-4-7')).toBe(0);
  });

  it('orders claude-opus-4-8 > claude-opus-4-7', () => {
    expect(compareModelIds('claude-opus-4-8', 'claude-opus-4-7')).toBe(1);
    expect(compareModelIds('claude-opus-4-7', 'claude-opus-4-8')).toBe(-1);
  });

  it('orders dated build above plain (longer = newer)', () => {
    expect(
      compareModelIds(
        'claude-opus-4-6-20251130',
        'claude-opus-4-6',
      ),
    ).toBe(1);
  });

  it('orders bare major-minor by minor', () => {
    expect(compareModelIds('gpt-5.4-mini', 'gpt-5.3-mini')).toBe(1);
    expect(compareModelIds('gpt-5.3-mini', 'gpt-5.4-mini')).toBe(-1);
  });

  it('orders v-prefixed semver as numbers', () => {
    expect(compareModelIds('embed-v4.0', 'embed-v3.0')).toBe(1);
    expect(compareModelIds('embed-v3.0', 'embed-v4.0')).toBe(-1);
  });

  it('orders underscore v-prefixed ids', () => {
    expect(compareModelIds('eleven_v3', 'eleven_v2')).toBe(1);
    expect(compareModelIds('eleven_v3', 'eleven_v4')).toBe(-1);
  });

  it('places numeric build below string preview', () => {
    // gpt-5-2024-12-01 (all numeric tail) vs gpt-5-preview
    // Numeric < string by design — preview tags rank higher lex but
    // we expect plain numeric to be considered "older" than alpha tag.
    // This is the design choice in compareTokens.
    expect(
      compareModelIds('gpt-5-2024-12-01', 'gpt-5-preview'),
    ).toBe(-1);
  });

  it('handles case-insensitive string compare', () => {
    expect(compareModelIds('foo-A', 'foo-a')).toBe(0);
  });

  it('orders pure-alpha last-segment lex', () => {
    expect(compareModelIds('claude-3-haiku', 'claude-3-opus')).toBe(-1);
  });

  it('handles mixed-length ids by extra-segment-wins', () => {
    expect(compareModelIds('claude-opus-4', 'claude-opus-4-7')).toBe(-1);
    expect(compareModelIds('claude-opus-4-7', 'claude-opus-4')).toBe(1);
  });

  it('treats different separators uniformly', () => {
    expect(compareModelIds('embed-v4.0', 'embed_v4_0')).toBe(0);
  });

  it('handles single-segment ids', () => {
    expect(compareModelIds('whisper', 'whisper')).toBe(0);
    expect(compareModelIds('whisper-2', 'whisper-1')).toBe(1);
  });
});

describe('pickNewest', () => {
  it('throws on empty input', () => {
    expect(() => pickNewest([])).toThrow(/empty id list/);
  });

  it('returns the sole id', () => {
    expect(pickNewest(['claude-opus-4-7'])).toBe('claude-opus-4-7');
  });

  it('picks newest claude opus', () => {
    const ids = [
      'claude-opus-4-6',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6-20251130',
    ];
    expect(pickNewest(ids)).toBe('claude-opus-4-8');
  });

  it('picks newest openai gpt-5 family', () => {
    const ids = ['gpt-5', 'gpt-5.4', 'gpt-5.2', 'gpt-5.3'];
    expect(pickNewest(ids)).toBe('gpt-5.4');
  });

  it('picks newest cohere embed', () => {
    expect(pickNewest(['embed-v3.0', 'embed-v4.0', 'embed-v2.0'])).toBe(
      'embed-v4.0',
    );
  });

  it('picks newest elevenlabs eleven_v', () => {
    expect(pickNewest(['eleven_v2', 'eleven_v3', 'eleven_v1'])).toBe(
      'eleven_v3',
    );
  });
});
