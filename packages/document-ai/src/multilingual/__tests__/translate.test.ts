import { describe, expect, it, vi } from 'vitest';
import {
  lexicalSimilarity,
  roundTripScore,
  translateTo,
} from '../translate.js';
import type { BrainPort } from '../../types.js';

describe('translateTo', () => {
  it('short-circuits when source equals target', async () => {
    const brain: BrainPort = { complete: vi.fn(async () => ({ text: 'X' })) };
    const out = await translateTo({
      text: 'hello world',
      sourceLang: 'en',
      targetLang: 'en',
      brain,
    });
    expect(out).toBe('hello world');
    expect(brain.complete).not.toHaveBeenCalled();
  });

  it('uses the brain when no translator is provided', async () => {
    const brain: BrainPort = {
      complete: vi.fn(async () => ({ text: 'Habari yako' })),
    };
    const out = await translateTo({
      text: 'How are you',
      sourceLang: 'en',
      targetLang: 'sw',
      brain,
    });
    expect(out).toBe('Habari yako');
  });

  it('uses a custom translator port when provided', async () => {
    const translator = {
      translate: vi.fn(async () => 'Bonjour'),
    };
    const out = await translateTo({
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fr',
      translator,
    });
    expect(out).toBe('Bonjour');
    expect(translator.translate).toHaveBeenCalledWith({
      text: 'Hello',
      sourceLang: 'en',
      targetLang: 'fr',
    });
  });

  it('throws when neither brain nor translator is provided', async () => {
    await expect(
      translateTo({
        text: 'X',
        sourceLang: 'en',
        targetLang: 'sw',
      })
    ).rejects.toThrow();
  });
});

describe('roundTripScore', () => {
  it('returns similarity 1 for an identity round-trip', async () => {
    const translator = { translate: vi.fn(async ({ text }: { text: string }) => text) };
    const score = await roundTripScore({
      text: 'hello world',
      sourceLang: 'en',
      viaLang: 'sw',
      translator,
    });
    expect(score.similarity).toBe(1);
  });

  it('returns lower similarity for diverged round-trip', async () => {
    let call = 0;
    const translator = {
      translate: vi.fn(async ({ text }: { text: string }) => {
        call += 1;
        return call === 1 ? `${text} XX` : 'different text';
      }),
    };
    const score = await roundTripScore({
      text: 'hello world',
      sourceLang: 'en',
      viaLang: 'sw',
      translator,
    });
    expect(score.similarity).toBeLessThan(1);
  });
});

describe('lexicalSimilarity', () => {
  it('returns 1 for identical inputs', () => {
    expect(lexicalSimilarity('hello world', 'hello world')).toBe(1);
  });
  it('returns 0 for fully disjoint inputs', () => {
    expect(lexicalSimilarity('abc def', 'xyz qrs')).toBe(0);
  });
  it('returns a fractional value for partial overlap', () => {
    const s = lexicalSimilarity('hello world peace', 'hello there peace');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});
