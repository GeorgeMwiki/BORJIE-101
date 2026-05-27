import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KIND_THRESHOLD,
  editDistanceCapped,
  jaccard,
  resolve,
  type EntityRecord,
} from '../kg-entity-resolution.js';
import type { EntityId } from '../types.js';

const id = (s: string) => s as EntityId;

describe('kg-entity-resolution', () => {
  it('jaccard returns 1 for identical strings', () => {
    expect(jaccard('Acme Holdings', 'Acme Holdings')).toBe(1);
  });

  it('jaccard returns 0 for disjoint tokens', () => {
    expect(jaccard('alpha beta', 'gamma delta')).toBe(0);
  });

  it('jaccard returns 1 when both inputs are empty', () => {
    expect(jaccard('', '')).toBe(1);
  });

  it('jaccard is symmetric', () => {
    const a = 'foo bar baz';
    const b = 'bar baz qux';
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });

  it('editDistanceCapped returns 0 for equal strings', () => {
    expect(editDistanceCapped('kitten', 'kitten', 5)).toBe(0);
  });

  it('editDistanceCapped respects cap', () => {
    expect(editDistanceCapped('a', 'zzzzzzzzzz', 3)).toBe(3);
  });

  it('resolve says keep-separate when kinds differ', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'person',
      canonicalName: 'Acme',
      aliases: [],
      identifiers: {},
    };
    const b: EntityRecord = { ...a, id: id('b'), kind: 'org' };
    expect(resolve(a, b).verdict).toBe('keep-separate');
  });

  it('resolve says merge when identifier matches', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'person',
      canonicalName: 'Alice X',
      aliases: [],
      identifiers: { email: 'a@x.com' },
    };
    const b: EntityRecord = {
      id: id('b'),
      kind: 'person',
      canonicalName: 'Different Name',
      aliases: [],
      identifiers: { email: 'a@x.com' },
    };
    const r = resolve(a, b);
    expect(r.verdict).toBe('merge');
    expect(r.score).toBe(1);
  });

  it('resolve uses alias matches', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'org',
      canonicalName: 'Acme Holdings Plc',
      aliases: ['Acme'],
      identifiers: {},
    };
    const b: EntityRecord = {
      id: id('b'),
      kind: 'org',
      canonicalName: 'Acme',
      aliases: [],
      identifiers: {},
    };
    expect(resolve(a, b).verdict).toBe('merge');
  });

  it('resolve uses needs-review band', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'property',
      canonicalName: 'Riverside Apartments',
      aliases: [],
      identifiers: {},
    };
    const b: EntityRecord = {
      id: id('b'),
      kind: 'property',
      canonicalName: 'Riverside Apts',
      aliases: [],
      identifiers: {},
    };
    const r = resolve(a, b);
    expect(['needs-review', 'merge']).toContain(r.verdict);
  });

  it('resolve returns keep-separate for clearly different names', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'org',
      canonicalName: 'Aardvark Ltd',
      aliases: [],
      identifiers: {},
    };
    const b: EntityRecord = {
      id: id('b'),
      kind: 'org',
      canonicalName: 'Zebra Co',
      aliases: [],
      identifiers: {},
    };
    expect(resolve(a, b).verdict).toBe('keep-separate');
  });

  it('default thresholds have property as highest bar', () => {
    expect(DEFAULT_KIND_THRESHOLD.property).toBeGreaterThan(DEFAULT_KIND_THRESHOLD.org);
  });

  it('resolve handles diacritics gracefully', () => {
    const a: EntityRecord = {
      id: id('a'),
      kind: 'person',
      canonicalName: 'José García',
      aliases: [],
      identifiers: {},
    };
    const b: EntityRecord = {
      id: id('b'),
      kind: 'person',
      canonicalName: 'Jose Garcia',
      aliases: [],
      identifiers: {},
    };
    expect(['merge', 'needs-review']).toContain(resolve(a, b).verdict);
  });
});
