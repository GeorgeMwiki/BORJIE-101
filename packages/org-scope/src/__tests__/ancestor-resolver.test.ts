import { describe, expect, it } from 'vitest';
import {
  isAncestor,
  isSelfOrAncestor,
  resolveAncestors,
} from '../hierarchy/ancestor-resolver.js';
import { buildOrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import {
  resolveDescendants,
  resolveSelfAndDescendants,
} from '../hierarchy/descendant-resolver.js';
import type { OrgUnit } from '../types.js';

function unit(id: string, parent: string | null, depth = 1): OrgUnit {
  return {
    id,
    tenant_id: 't-borjie',
    parent_unit_id: parent,
    default_kind: 'district',
    display_name: id,
    display_kind_singular: 'district',
    display_kind_plural: 'districts',
    materialised_path: `t-borjie/${id}`,
    depth,
    authority_inheritance: true,
    created_at: '2026-05-26T00:00:00.000Z',
    updated_at: '2026-05-26T00:00:00.000Z',
  };
}

const tree = buildOrgUnitTree({
  tenantId: 't-borjie',
  units: [
    unit('north-zone', null, 1),
    unit('geita', 'north-zone', 2),
    unit('geita-site-a', 'geita', 3),
    unit('mererani', 'north-zone', 2),
  ],
});

describe('ancestor-resolver', () => {
  it('resolves ancestors closest-first', () => {
    const chain = resolveAncestors(tree, 'geita-site-a');
    expect(chain?.map((u) => u.id)).toEqual(['geita', 'north-zone']);
  });

  it('returns null for unknown unit', () => {
    expect(resolveAncestors(tree, 'unknown')).toBeNull();
  });

  it('returns empty array for top-level unit', () => {
    expect(resolveAncestors(tree, 'north-zone')).toEqual([]);
  });

  it('detects ancestry across multiple hops', () => {
    expect(isAncestor(tree, 'north-zone', 'geita-site-a')).toBe(true);
    expect(isAncestor(tree, 'geita', 'geita-site-a')).toBe(true);
    expect(isAncestor(tree, 'mererani', 'geita-site-a')).toBe(false);
  });

  it('treats self as ancestor only for the inclusive variant', () => {
    expect(isAncestor(tree, 'geita', 'geita')).toBe(false);
    expect(isSelfOrAncestor(tree, 'geita', 'geita')).toBe(true);
  });
});

describe('descendant-resolver', () => {
  it('returns the subtree BFS-ordered', () => {
    const desc = resolveDescendants(tree, 'north-zone');
    expect(desc?.map((u) => u.id)).toEqual(['geita', 'mererani', 'geita-site-a']);
  });

  it('returns null for unknown unit', () => {
    expect(resolveDescendants(tree, 'unknown')).toBeNull();
  });

  it('includes self when requested', () => {
    const out = resolveSelfAndDescendants(tree, 'geita');
    expect(out?.map((u) => u.id)).toEqual(['geita', 'geita-site-a']);
  });
});
