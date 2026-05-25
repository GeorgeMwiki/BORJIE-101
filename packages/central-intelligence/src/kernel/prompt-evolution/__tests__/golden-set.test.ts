/**
 * Golden set — unit tests.
 *
 * Coverage:
 *   1. createFrozenGoldenSet uses the default top-5 cases when none given
 *   2. version is the SHA256 of the canonicalised case list (stable)
 *   3. rebuilding with the same cases produces the same version
 *   4. rebuilding with different cases produces a different version
 *   5. an empty input throws
 *   6. rotateGoldenSet ALWAYS throws (automated rotation forbidden)
 *   7. cases array is frozen (Object.isFrozen)
 */

import { describe, it, expect } from 'vitest';
import {
  createFrozenGoldenSet,
  rotateGoldenSet,
  __FROZEN_CASES__,
} from '../golden-set.js';

describe('golden-set', () => {
  it('builds a default golden set with at least 5 capability rows', () => {
    const gs = createFrozenGoldenSet();
    expect(gs.cases.length).toBeGreaterThanOrEqual(5);
    const caps = new Set(gs.cases.map((c) => c.capability));
    expect(caps.size).toBeGreaterThanOrEqual(5);
  });

  it('version is the SHA256 of the canonicalised case list', () => {
    const gs = createFrozenGoldenSet();
    expect(gs.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same cases produce the same version (deterministic)', () => {
    const a = createFrozenGoldenSet(__FROZEN_CASES__);
    const b = createFrozenGoldenSet(__FROZEN_CASES__);
    expect(a.version).toBe(b.version);
  });

  it('different cases produce a different version', () => {
    const a = createFrozenGoldenSet();
    const altered = [
      ...__FROZEN_CASES__,
      {
        id: 'extra-case',
        input: 'extra',
        expectedOutput: 'extra-out',
        capability: 'extra-cap',
      },
    ];
    const b = createFrozenGoldenSet(altered);
    expect(a.version).not.toBe(b.version);
  });

  it('throws when given an empty case list', () => {
    expect(() => createFrozenGoldenSet([])).toThrow();
  });

  it('rotateGoldenSet always throws (automated rotation forbidden)', () => {
    expect(() => rotateGoldenSet(undefined as never)).toThrow(
      /rotation forbidden/i,
    );
  });

  it('cases array is frozen', () => {
    const gs = createFrozenGoldenSet();
    expect(Object.isFrozen(gs.cases)).toBe(true);
  });
});
