import { describe, expect, it } from 'vitest';
import { generateCounterfactuals } from '../counterfactual-generator.js';
import type { ProtectedAttributeSpec } from '../types.js';

const RACE_SPEC: ProtectedAttributeSpec = {
  id: 'race',
  profileKey: 'race',
  values: ['black', 'white', 'asian'],
  jurisdictions: ['US'],
  citation: 'FHA',
};

describe('generateCounterfactuals', () => {
  it('returns one pair per non-original value', () => {
    const pairs = generateCounterfactuals(
      { race: 'black', income: 5000 },
      RACE_SPEC,
    );
    expect(pairs).toHaveLength(2);
    expect(pairs.map((p) => p.counterfactualValue).sort()).toEqual(['asian', 'white']);
  });

  it('preserves the original profile in every pair', () => {
    const profile = { race: 'black', income: 5000 };
    const pairs = generateCounterfactuals(profile, RACE_SPEC);
    for (const p of pairs) {
      expect(p.originalProfile).toBe(profile);
    }
  });

  it('flips only the protected attribute key', () => {
    const profile = { race: 'black', income: 5000, name: 'jane' };
    const pairs = generateCounterfactuals(profile, RACE_SPEC);
    for (const p of pairs) {
      expect(p.counterfactualProfile.income).toBe(5000);
      expect(p.counterfactualProfile.name).toBe('jane');
      expect(p.counterfactualProfile.race).not.toBe('black');
    }
  });

  it('returns empty when profile lacks the attribute key', () => {
    const pairs = generateCounterfactuals({ income: 5000 }, RACE_SPEC);
    expect(pairs).toHaveLength(0);
  });

  it('captures originalValue accurately', () => {
    const pairs = generateCounterfactuals({ race: 'asian' }, RACE_SPEC);
    for (const p of pairs) {
      expect(p.originalValue).toBe('asian');
    }
  });

  it('returns empty when only one value in spec matches original', () => {
    const spec: ProtectedAttributeSpec = {
      ...RACE_SPEC,
      values: ['black'],
    };
    const pairs = generateCounterfactuals({ race: 'black' }, spec);
    expect(pairs).toHaveLength(0);
  });

  it('coerces non-string original values to string', () => {
    const spec: ProtectedAttributeSpec = {
      ...RACE_SPEC,
      profileKey: 'is_pregnant',
      values: ['true', 'false'],
    };
    const pairs = generateCounterfactuals({ is_pregnant: true }, spec);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.originalValue).toBe('true');
    expect(pairs[0]?.counterfactualValue).toBe('false');
  });
});
