import { describe, expect, it } from 'vitest';
import { buildOrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import { resolveUserScope } from '../scope/resolve-user-scope.js';
import type { OrgUnit, TerminologyOverride, UserScopeBinding } from '../types.js';

function unit(id: string, parent: string | null, path: string): OrgUnit {
  return {
    id,
    tenant_id: 't-borjie',
    parent_unit_id: parent,
    default_kind: 'district',
    display_name: id,
    display_kind_singular: 'district',
    display_kind_plural: 'districts',
    materialised_path: path,
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
  tier: 0 | 1 | 2,
): UserScopeBinding {
  return {
    id,
    user_id: 'u-1',
    tenant_id: 't-borjie',
    scope_kind: scopeKind,
    org_unit_id: orgUnitId,
    role: 'admin',
    authority_tier_max: tier,
    granted_at: '2026-05-01T00:00:00.000Z',
    granted_by: 'owner',
    revoked_at: null,
  };
}

const tree = buildOrgUnitTree({
  tenantId: 't-borjie',
  units: [
    unit('geita', null, 'borjie/geita'),
    unit('geita-site-a', 'geita', 'borjie/geita/site-a'),
    unit('mererani', null, 'borjie/mererani'),
  ],
});

describe('resolveUserScope', () => {
  it('classifies owner with tenant_root binding as tenant_root scope', () => {
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [binding('b-root', 'tenant_root', null, 2)],
      tree,
      terminologyOverrides: [],
    });
    expect(scope.kind).toBe('tenant_root');
    expect(scope.authority_tier_max).toBe(2);
    expect(scope.legacy_mode).toBe(false);
  });

  it('classifies single org_unit binding as org_unit scope and sets scope_path', () => {
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [binding('b-geita', 'org_unit', 'geita', 2)],
      tree,
      terminologyOverrides: [],
    });
    expect(scope.kind).toBe('org_unit');
    expect(scope.resolved_terminology.scope_path).toBe('borjie/geita');
  });

  it('classifies multi-unit bindings as multi_org_unit and clears scope_path', () => {
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [
        binding('b-geita', 'org_unit', 'geita', 2),
        binding('b-merer', 'org_unit', 'mererani', 1),
      ],
      tree,
      terminologyOverrides: [],
    });
    expect(scope.kind).toBe('multi_org_unit');
    expect(scope.resolved_terminology.scope_path).toBeNull();
  });

  it('applies scoped terminology override when resolving for an org_unit', () => {
    const override: TerminologyOverride = {
      id: 'o-1',
      tenant_id: 't-borjie',
      org_unit_id: 'geita',
      key: 'parcel',
      singular_en: 'lot',
      plural_en: 'lots',
      singular_sw: null,
      plural_sw: null,
      overridden_by: 'owner',
      overridden_at: '2026-05-20T00:00:00.000Z',
    };
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [binding('b-geita', 'org_unit', 'geita', 2)],
      tree,
      terminologyOverrides: [override],
    });
    expect(scope.resolved_terminology.entries.get('parcel')?.singular_en).toBe('lot');
  });

  it('returns legacy_mode when the tenant has no org units', () => {
    const emptyTree = buildOrgUnitTree({ tenantId: 't-borjie', units: [] });
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [binding('b-root', 'tenant_root', null, 2)],
      tree: emptyTree,
      terminologyOverrides: [],
    });
    expect(scope.legacy_mode).toBe(true);
  });

  it('filters published recipes by org_unit visibility', () => {
    const scope = resolveUserScope({
      tenantId: 't-borjie',
      bindings: [binding('b-geita', 'org_unit', 'geita', 2)],
      tree,
      terminologyOverrides: [],
      publishedRecipes: [
        { recipe_id: 'r-shared', org_unit_id: null },
        { recipe_id: 'r-geita', org_unit_id: 'geita' },
        { recipe_id: 'r-merer', org_unit_id: 'mererani' },
      ],
    });
    expect(scope.visible_recipes).toContain('r-shared');
    expect(scope.visible_recipes).toContain('r-geita');
    expect(scope.visible_recipes).not.toContain('r-merer');
  });
});
