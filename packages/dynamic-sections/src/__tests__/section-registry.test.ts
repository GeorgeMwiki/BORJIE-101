/**
 * `SectionRegistry` immutability + identity tests.
 */

import { describe, expect, it } from 'vitest';
import { SectionRegistry } from '../registry/section-registry.js';
import type { Section } from '../contracts/section.js';

function mk(key: string): Section {
  return {
    key,
    label: key,
    icon: 'circle',
    entity_type: key,
    sort_order: 10,
    visibility_predicate: { kind: 'has-entities', entity_type: key },
    component_loader: () => Promise.resolve({ default: () => null as unknown as JSX.Element }),
  };
}

describe('SectionRegistry', () => {
  it('starts empty when constructed without arguments', () => {
    expect(new SectionRegistry().all).toEqual([]);
  });

  it('exposes initial sections via `all`', () => {
    const reg = new SectionRegistry([mk('a'), mk('b')]);
    expect(reg.all.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('returns a new instance on register (never mutates self)', () => {
    const initial = new SectionRegistry();
    const next = initial.register(mk('a'));
    expect(initial.all).toEqual([]);
    expect(next.all.map((s) => s.key)).toEqual(['a']);
    expect(next).not.toBe(initial);
  });

  it('throws on duplicate-key register', () => {
    const reg = new SectionRegistry([mk('a')]);
    expect(() => reg.register(mk('a'))).toThrow(/duplicate section key/);
  });

  it('returns a new instance on unregister (never mutates self)', () => {
    const initial = new SectionRegistry([mk('a'), mk('b')]);
    const next = initial.unregister('a');
    expect(initial.all.map((s) => s.key)).toEqual(['a', 'b']);
    expect(next.all.map((s) => s.key)).toEqual(['b']);
  });

  it('unregister is idempotent for missing keys', () => {
    const reg = new SectionRegistry([mk('a')]);
    const next = reg.unregister('nope');
    expect(next.all.map((s) => s.key)).toEqual(['a']);
  });

  it('get returns the section by key, undefined if missing', () => {
    const reg = new SectionRegistry([mk('a'), mk('b')]);
    expect(reg.get('a')?.key).toBe('a');
    expect(reg.get('zzz')).toBeUndefined();
  });

  it('registerAll bulk-registers sections', () => {
    const reg = new SectionRegistry().registerAll([
      mk('a'),
      mk('b'),
      mk('c'),
    ]);
    expect(reg.all.map((s) => s.key)).toEqual(['a', 'b', 'c']);
  });

  it('registerAll throws on the first duplicate', () => {
    expect(() =>
      new SectionRegistry().registerAll([mk('a'), mk('a')]),
    ).toThrow(/duplicate section key 'a'/);
  });
});
