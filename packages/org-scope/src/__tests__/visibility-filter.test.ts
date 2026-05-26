import { describe, expect, it } from 'vitest';
import { buildOrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import { buildVisibilityFilter } from '../scope/visibility-filter.js';
import type { OrgUnit, UserScopeBinding } from '../types.js';

function unit(id: string, parent: string | null): OrgUnit {
  return {
    id,
    tenant_id: 't-borjie',
    parent_unit_id: parent,
    default_kind: 'district',
    display_name: id,
    display_kind_singular: 'district',
    display_kind_plural: 'districts',
    materialised_path: parent === null ? `t-borjie/${id}` : `t-borjie/${parent}/${id}`,
    depth: parent === null ? 1 : 2,
    authority_inheritance: true,
    created_at: '2026-05-26T00:00:00.000Z',
    updated_at: '2026-05-26T00:00:00.000Z',
  };
}

function binding(
  id: string,
  scopeKind: UserScopeBinding['scope_kind'],
  orgUnitId: string | null,
  authorityTierMax: 0 | 1 | 2,
  overrides: Partial<UserScopeBinding> = {},
): UserScopeBinding {
  return {
    id,
    user_id: 'u-1',
    tenant_id: 't-borjie',
    scope_kind: scopeKind,
    org_unit_id: orgUnitId,
    role: 'admin',
    authority_tier_max: authorityTierMax,
    granted_at: '2026-05-01T00:00:00.000Z',
    granted_by: 'owner',
    revoked_at: null,
    ...overrides,
  };
}

const tree = buildOrgUnitTree({
  tenantId: 't-borjie',
  units: [
    unit('geita', null),
    unit('geita-site-a', 'geita'),
    unit('mererani', null),
  ],
});

describe('buildVisibilityFilter', () => {
  it('returns tenant-wide filter for tenant_root binding', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [binding('b-1', 'tenant_root', null, 2)],
      tree,
    });
    expect(out.is_tenant_root).toBe(true);
    expect(out.filter.org_unit_ids).toEqual([]);
    expect(out.authority_tier_max).toBe(2);
  });

  it('expands org_unit binding with descendants', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [binding('b-1', 'org_unit', 'geita', 2)],
      tree,
    });
    expect(out.is_tenant_root).toBe(false);
    expect(new Set(out.filter.org_unit_ids)).toEqual(
      new Set(['geita', 'geita-site-a']),
    );
    expect(out.filter.include_descendants).toBe(true);
  });

  it('unions multiple bindings', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [
        binding('b-1', 'org_unit', 'geita', 1),
        binding('b-2', 'org_unit', 'mererani', 2),
      ],
      tree,
    });
    expect(new Set(out.filter.org_unit_ids)).toEqual(
      new Set(['geita', 'geita-site-a', 'mererani']),
    );
    expect(out.authority_tier_max).toBe(2);
  });

  it('returns empty filter + tier 0 when no bindings', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [],
      tree,
    });
    expect(out.filter.org_unit_ids).toEqual([]);
    expect(out.authority_tier_max).toBe(0);
    expect(out.is_tenant_root).toBe(false);
  });

  it('respects activeBindingId narrow', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [
        binding('b-1', 'org_unit', 'geita', 2),
        binding('b-2', 'org_unit', 'mererani', 1),
      ],
      tree,
      activeBindingId: 'b-2',
    });
    expect(new Set(out.filter.org_unit_ids)).toEqual(new Set(['mererani']));
    expect(out.authority_tier_max).toBe(1);
  });

  it('ignores revoked bindings', () => {
    const out = buildVisibilityFilter({
      tenantId: 't-borjie',
      bindings: [
        binding('b-1', 'tenant_root', null, 2, {
          revoked_at: '2026-05-20T00:00:00.000Z',
        }),
      ],
      tree,
    });
    expect(out.is_tenant_root).toBe(false);
  });
});
