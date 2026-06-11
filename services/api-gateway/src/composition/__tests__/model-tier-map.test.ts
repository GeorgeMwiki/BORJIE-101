/**
 * Intelligence-Elasticity — composition-root tier map contract.
 *
 * The literal ids below are the PROOF HARNESS: they assert the default
 * resolution yields EXACTLY the ids the wiring files shipped with
 * before the repoint (zero-behavior-change), and that the env-backed
 * map is the ONE swap point.
 */

import { describe, expect, it } from 'vitest';

import { readTierModelMap, resolveTierModel } from '../model-tier-map.js';

describe('model-tier-map — default resolution', () => {
  it('resolves the rank-driven cascade (deep=Fable core reasoning, standard=next, cheap=floor)', () => {
    expect(resolveTierModel('cheap', {})).toBe('claude-haiku-4-5');
    expect(resolveTierModel('standard', {})).toBe('claude-opus-4-8');
    expect(resolveTierModel('deep', {})).toBe('claude-fable-5');
  });
});

describe('model-tier-map — env-backed override map', () => {
  it('BORJIE_MODEL_TIER_* pin wins over the registry default', () => {
    const env = {
      BORJIE_MODEL_TIER_CHEAP: 'claude-haiku-9-9',
      BORJIE_MODEL_TIER_STANDARD: 'claude-sonnet-9-9',
      BORJIE_MODEL_TIER_DEEP: 'claude-opus-9-9',
    };
    expect(resolveTierModel('cheap', env)).toBe('claude-haiku-9-9');
    expect(resolveTierModel('standard', env)).toBe('claude-sonnet-9-9');
    expect(resolveTierModel('deep', env)).toBe('claude-opus-9-9');
  });

  it('overriding one tier leaves the others on registry defaults', () => {
    const env = { BORJIE_MODEL_TIER_DEEP: 'claude-opus-9-9' };
    expect(resolveTierModel('deep', env)).toBe('claude-opus-9-9');
    expect(resolveTierModel('cheap', env)).toBe('claude-haiku-4-5');
    expect(resolveTierModel('standard', env)).toBe('claude-opus-4-8');
  });

  it('blank/whitespace env values are ignored', () => {
    const env = {
      BORJIE_MODEL_TIER_CHEAP: '',
      BORJIE_MODEL_TIER_STANDARD: '   ',
    };
    expect(readTierModelMap(env)).toEqual({});
    expect(resolveTierModel('cheap', env)).toBe('claude-haiku-4-5');
    expect(resolveTierModel('standard', env)).toBe('claude-opus-4-8');
  });

  it('readTierModelMap returns a frozen map of only set tiers', () => {
    const map = readTierModelMap({ BORJIE_MODEL_TIER_STANDARD: ' m1 ' });
    expect(map).toEqual({ standard: 'm1' });
    expect(Object.isFrozen(map)).toBe(true);
  });
});

describe('model-tier-map — dynamic auto-promotion (intelligence-elasticity)', () => {
  it('reordering the capability rank at runtime re-points the tiers (no redeploy)', () => {
    // Operator declares a different front via BORJIE_ANTHROPIC_RANK — DEEP
    // (core reasoning) follows the rank front, the rest cascade. This is the
    // mechanism by which a superior new Anthropic family takes core reasoning
    // with zero call-site change (here demonstrated by reordering known
    // families so the assertion is deterministic).
    const env = { BORJIE_ANTHROPIC_RANK: 'opus,fable,sonnet,haiku' };
    expect(resolveTierModel('deep', env)).toBe('claude-opus-4-8'); // new front
    expect(resolveTierModel('standard', env)).toBe('claude-fable-5'); // next
    expect(resolveTierModel('cheap', env)).toBe('claude-haiku-4-5'); // floor
  });

  it('default rank keeps Fable at core reasoning (deep)', () => {
    expect(resolveTierModel('deep', {})).toBe('claude-fable-5');
    expect(resolveTierModel('standard', {})).toBe('claude-opus-4-8');
  });
});
