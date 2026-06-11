/**
 * Seed-library coverage invariants.
 *
 * The Generation agent relies on a balanced prior pool; these tests pin
 * the library's shape so a future edit cannot silently unbalance it.
 */
import { describe, it, expect } from 'vitest';
import {
  SEED_LIBRARY,
  seedsByArea,
  seedsByPerspective,
  findSeedById,
} from '../seed-library/index.js';
import {
  HypothesisSeedSchema,
  DISCOVERY_AREAS,
  PERSPECTIVES,
} from '../types.js';

describe('seed library invariants', () => {
  it('contains exactly 25 seeds', () => {
    expect(SEED_LIBRARY).toHaveLength(25);
  });

  it('has exactly 5 seeds per discovery area', () => {
    for (const area of DISCOVERY_AREAS) {
      expect(seedsByArea(area)).toHaveLength(5);
    }
  });

  it('covers every perspective with at least one seed', () => {
    for (const perspective of PERSPECTIVES) {
      expect(seedsByPerspective(perspective).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has globally unique seed ids', () => {
    const ids = SEED_LIBRARY.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('validates every seed against the zod schema', () => {
    for (const seed of SEED_LIBRARY) {
      const parsed = HypothesisSeedSchema.safeParse(seed);
      expect(parsed.success, `seed ${seed.id} failed schema`).toBe(true);
    }
  });

  it('findSeedById resolves a known id and returns undefined for unknown', () => {
    const first = SEED_LIBRARY[0]!;
    expect(findSeedById(first.id)?.id).toBe(first.id);
    expect(findSeedById('does-not-exist')).toBeUndefined();
  });
});
