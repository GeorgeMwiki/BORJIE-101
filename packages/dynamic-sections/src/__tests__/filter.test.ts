/**
 * `filterSections` tests — predicate evaluation + scope filtering +
 * stable sort.
 */

import { describe, expect, it } from 'vitest';
import { filterSections } from '../registry/filter.js';
import type {
  Section,
  SectionContext,
} from '../contracts/section.js';

function fakeLoader() {
  return Promise.resolve({ default: () => null as unknown as JSX.Element });
}

function section(over: Partial<Section> & Pick<Section, 'key'>): Section {
  return {
    label: `Section ${over.key}`,
    icon: 'circle',
    entity_type: over.key,
    sort_order: 100,
    visibility_predicate: { kind: 'has-entities', entity_type: over.key },
    component_loader: fakeLoader,
    ...over,
  };
}

function ctx(over: Partial<SectionContext> = {}): SectionContext {
  return {
    tenantId: 't1',
    scope: 'owner-customer',
    entityCounts: {},
    roles: [],
    featureFlags: [],
    ...over,
  };
}

describe('filterSections', () => {
  it('returns an empty list when no sections register', () => {
    expect(filterSections([], ctx())).toEqual([]);
  });

  it('excludes sections whose predicate is false', () => {
    const sections = [section({ key: 'a' }), section({ key: 'b' })];
    const result = filterSections(sections, ctx());
    expect(result).toEqual([]);
  });

  it('includes only sections whose predicate is true', () => {
    const sections = [section({ key: 'a' }), section({ key: 'b' })];
    const result = filterSections(
      sections,
      ctx({ entityCounts: { a: 1 } }),
    );
    expect(result.map((s) => s.key)).toEqual(['a']);
  });

  it('sorts by sort_order ascending', () => {
    const sections = [
      section({ key: 'a', sort_order: 50 }),
      section({ key: 'b', sort_order: 10 }),
      section({ key: 'c', sort_order: 30 }),
    ];
    const result = filterSections(
      sections,
      ctx({ entityCounts: { a: 1, b: 1, c: 1 } }),
    );
    expect(result.map((s) => s.key)).toEqual(['b', 'c', 'a']);
  });

  it('breaks sort_order ties using key (lexicographic)', () => {
    const sections = [
      section({ key: 'gamma', sort_order: 10 }),
      section({ key: 'alpha', sort_order: 10 }),
      section({ key: 'beta', sort_order: 10 }),
    ];
    const result = filterSections(
      sections,
      ctx({ entityCounts: { alpha: 1, beta: 1, gamma: 1 } }),
    );
    expect(result.map((s) => s.key)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('omits a section if its scopes list excludes the active scope', () => {
    const sections = [
      section({ key: 'admin-only', scopes: ['internal-admin'] }),
    ];
    const result = filterSections(
      sections,
      ctx({
        scope: 'owner-customer',
        entityCounts: { 'admin-only': 5 },
      }),
    );
    expect(result).toEqual([]);
  });

  it('includes a section if its scopes list includes the active scope', () => {
    const sections = [
      section({ key: 'admin-only', scopes: ['internal-admin'] }),
    ];
    const result = filterSections(
      sections,
      ctx({
        scope: 'internal-admin',
        entityCounts: { 'admin-only': 5 },
      }),
    );
    expect(result.map((s) => s.key)).toEqual(['admin-only']);
  });

  it('treats a missing scopes property as "both scopes"', () => {
    const sections = [section({ key: 'shared' })];
    const owner = filterSections(
      sections,
      ctx({
        scope: 'owner-customer',
        entityCounts: { shared: 1 },
      }),
    );
    const admin = filterSections(
      sections,
      ctx({
        scope: 'internal-admin',
        entityCounts: { shared: 1 },
      }),
    );
    expect(owner.map((s) => s.key)).toEqual(['shared']);
    expect(admin.map((s) => s.key)).toEqual(['shared']);
  });

  it('treats an empty scopes array as "both scopes"', () => {
    const sections = [section({ key: 'shared', scopes: [] })];
    const owner = filterSections(
      sections,
      ctx({
        scope: 'owner-customer',
        entityCounts: { shared: 1 },
      }),
    );
    expect(owner.map((s) => s.key)).toEqual(['shared']);
  });

  it('returns a fresh array — never mutates the input', () => {
    const sections = [
      section({ key: 'b', sort_order: 20 }),
      section({ key: 'a', sort_order: 10 }),
    ];
    const before = sections.map((s) => s.key);
    filterSections(
      sections,
      ctx({ entityCounts: { a: 1, b: 1 } }),
    );
    expect(sections.map((s) => s.key)).toEqual(before);
  });
});
