import { describe, expect, it } from 'vitest';
import {
  buildOrgUnitTree,
  TreeBuildError,
} from '../hierarchy/org-unit-tree-builder.js';
import type { OrgUnit } from '../types.js';

function unit(partial: Partial<OrgUnit> & Pick<OrgUnit, 'id'>): OrgUnit {
  return {
    id: partial.id,
    tenant_id: partial.tenant_id ?? 't-borjie',
    parent_unit_id: partial.parent_unit_id ?? null,
    default_kind: partial.default_kind ?? 'district',
    display_name: partial.display_name ?? `unit-${partial.id}`,
    display_kind_singular: partial.display_kind_singular ?? 'district',
    display_kind_plural: partial.display_kind_plural ?? 'districts',
    materialised_path: partial.materialised_path ?? `t-borjie/${partial.id}`,
    depth: partial.depth ?? 1,
    authority_inheritance: partial.authority_inheritance ?? true,
    created_at: partial.created_at ?? '2026-05-26T00:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-05-26T00:00:00.000Z',
  };
}

describe('buildOrgUnitTree', () => {
  it('builds a 3-level tree with stable child ordering', () => {
    const geita = unit({ id: 'u-geita', display_name: 'Geita' });
    const mererani = unit({ id: 'u-mererani', display_name: 'Mererani' });
    const geitaSiteA = unit({
      id: 'u-geita-site-a',
      parent_unit_id: 'u-geita',
      display_name: 'Geita Site A',
      materialised_path: 't-borjie/geita/site-a',
      depth: 2,
    });
    const tree = buildOrgUnitTree({
      tenantId: 't-borjie',
      units: [mererani, geita, geitaSiteA],
    });
    expect(tree.roots.map((r) => r.id)).toEqual(['u-geita', 'u-mererani']);
    expect(tree.childrenByParent.get('u-geita')?.map((c) => c.id)).toEqual([
      'u-geita-site-a',
    ]);
    expect(tree.byId.size).toBe(3);
  });

  it('rejects tenant_id mismatch', () => {
    expect(() =>
      buildOrgUnitTree({
        tenantId: 't-borjie',
        units: [unit({ id: 'u-1', tenant_id: 't-other' })],
      }),
    ).toThrow(TreeBuildError);
  });

  it('rejects duplicate unit ids', () => {
    expect(() =>
      buildOrgUnitTree({
        tenantId: 't-borjie',
        units: [unit({ id: 'u-1' }), unit({ id: 'u-1', display_name: 'dup' })],
      }),
    ).toThrow(TreeBuildError);
  });

  it('rejects orphaned parents', () => {
    expect(() =>
      buildOrgUnitTree({
        tenantId: 't-borjie',
        units: [unit({ id: 'u-1', parent_unit_id: 'u-missing' })],
      }),
    ).toThrow(TreeBuildError);
  });

  it('returns an empty tree for an empty input', () => {
    const tree = buildOrgUnitTree({ tenantId: 't-borjie', units: [] });
    expect(tree.byId.size).toBe(0);
    expect(tree.roots.length).toBe(0);
  });
});
