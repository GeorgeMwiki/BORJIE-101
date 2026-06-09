/**
 * Tests for the control-plane config validators.
 */

import { describe, expect, it } from 'vitest';
import { validateRoutingConfig, validateEnsemble } from '../validate.js';
import { ladderFromRouting } from '../config-model.js';

describe('validateRoutingConfig', () => {
  it('accepts a minimal valid config (core only)', () => {
    const res = validateRoutingConfig({ coreModel: 'a/b' });
    expect(res.success).toBe(true);
    expect(res.data?.coreModel).toBe('a/b');
    expect(res.data?.orderedFallbacks).toEqual([]);
  });

  it('rejects a config without a coreModel', () => {
    const res = validateRoutingConfig({ orderedFallbacks: ['a'] });
    expect(res.success).toBe(false);
    expect(res.issues?.some((i) => i.includes('coreModel'))).toBe(true);
  });

  it('rejects non-string fallbacks', () => {
    const res = validateRoutingConfig({ coreModel: 'a', orderedFallbacks: [1, 2] });
    expect(res.success).toBe(false);
  });

  it('validates a nested ensemble + perUseCase map', () => {
    const res = validateRoutingConfig({
      coreModel: 'core',
      orderedFallbacks: ['fb1'],
      ensemble: { enabled: true, members: ['m1', 'm2'], combineStrategy: 'majority-vote' },
      perUseCase: { casual_chat: 'haiku' },
    });
    expect(res.success).toBe(true);
    expect(res.data?.ensemble?.members).toEqual(['m1', 'm2']);
    expect(res.data?.perUseCase?.casual_chat).toBe('haiku');
  });

  it('rejects a perUseCase entry with a non-string model', () => {
    const res = validateRoutingConfig({
      coreModel: 'core',
      perUseCase: { x: 123 },
    });
    expect(res.success).toBe(false);
  });
});

describe('validateEnsemble', () => {
  it('rejects an empty members list', () => {
    const res = validateEnsemble({ enabled: true, members: [], combineStrategy: 'first-wins' });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown combine strategy', () => {
    const res = validateEnsemble({ enabled: true, members: ['a'], combineStrategy: 'bogus' });
    expect(res.success).toBe(false);
  });

  it('accepts judge-synthesis with a judge model', () => {
    const res = validateEnsemble({
      enabled: true,
      members: ['a', 'b'],
      combineStrategy: 'judge-synthesis',
      judgeModel: 'judge',
    });
    expect(res.success).toBe(true);
    expect(res.data?.judgeModel).toBe('judge');
  });
});

describe('ladderFromRouting', () => {
  it('flattens [core, ...fallbacks] de-duplicating while preserving order', () => {
    const ladder = ladderFromRouting({
      coreModel: 'a',
      orderedFallbacks: ['b', 'a', 'c', 'b'],
    });
    expect(ladder).toEqual(['a', 'b', 'c']);
  });

  it('drops empty/blank entries', () => {
    const ladder = ladderFromRouting({
      coreModel: 'a',
      orderedFallbacks: ['', '  ', 'b'],
    });
    expect(ladder).toEqual(['a', 'b']);
  });
});
