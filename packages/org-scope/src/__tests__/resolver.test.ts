import { describe, expect, it } from 'vitest';
import { buildOrgUnitTree } from '../hierarchy/org-unit-tree-builder.js';
import { resolveTerminologyForScope, term } from '../terminology/resolver.js';
import type { OrgUnit, TerminologyOverride } from '../types.js';

function unit(id: string, parent: string | null, name: string): OrgUnit {
  return {
    id,
    tenant_id: 't-borjie',
    parent_unit_id: parent,
    default_kind: 'district',
    display_name: name,
    display_kind_singular: 'district',
    display_kind_plural: 'districts',
    materialised_path:
      parent === null ? `borjie/${id}` : `borjie/${parent}/${id}`,
    depth: parent === null ? 1 : 2,
    authority_inheritance: true,
    created_at: '2026-05-26T00:00:00.000Z',
    updated_at: '2026-05-26T00:00:00.000Z',
  };
}

function override(
  orgUnitId: string | null,
  key: string,
  singularEn: string,
  pluralEn: string,
): TerminologyOverride {
  return {
    id: `${orgUnitId ?? 'root'}:${key}`,
    tenant_id: 't-borjie',
    org_unit_id: orgUnitId,
    key,
    singular_en: singularEn,
    plural_en: pluralEn,
    singular_sw: null,
    plural_sw: null,
    overridden_by: 'owner',
    overridden_at: '2026-05-20T00:00:00.000Z',
  };
}

const tree = buildOrgUnitTree({
  tenantId: 't-borjie',
  units: [
    unit('geita', null, 'Geita'),
    unit('geita-site-a', 'geita', 'Geita Site A'),
    unit('mererani', null, 'Mererani'),
  ],
});

describe('resolveTerminologyForScope', () => {
  it('returns defaults when no overrides are provided', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [],
    });
    expect(resolved.entries.get('parcel')?.singular_en).toBe('parcel');
    expect(resolved.entries.get('parcel')?.source).toBe('default');
  });

  it('applies tenant-wide override over default', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [override(null, 'parcel', 'package', 'packages')],
    });
    const entry = resolved.entries.get('parcel');
    expect(entry?.singular_en).toBe('package');
    expect(entry?.source).toBe('tenant');
  });

  it('applies org-unit-level override over tenant-wide', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: 'borjie/geita',
      tree,
      overrides: [
        override(null, 'parcel', 'package', 'packages'),
        override('geita', 'parcel', 'lot', 'lots'),
      ],
    });
    const entry = resolved.entries.get('parcel');
    expect(entry?.singular_en).toBe('lot');
    expect(entry?.source).toBe('org_unit');
  });

  it('walks up to ancestor override when no exact match', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: 'borjie/geita/geita-site-a',
      tree,
      overrides: [override('geita', 'site', 'pit', 'pits')],
    });
    const entry = resolved.entries.get('site');
    expect(entry?.singular_en).toBe('pit');
    expect(entry?.source).toBe('ancestor');
  });

  it('peer overrides do NOT leak between siblings', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: 'borjie/mererani',
      tree,
      overrides: [override('geita', 'parcel', 'lot', 'lots')],
    });
    const entry = resolved.entries.get('parcel');
    expect(entry?.singular_en).toBe('parcel');
    expect(entry?.source).toBe('default');
  });

  it('keeps Swahili fallback from default when override omits sw', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [override(null, 'parcel', 'package', 'packages')],
    });
    expect(resolved.entries.get('parcel')?.singular_sw).toBe('kifurushi');
  });

  it('ignores overrides from other tenants', () => {
    const foreign: TerminologyOverride = {
      ...override(null, 'parcel', 'package', 'packages'),
      tenant_id: 't-other',
    };
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [foreign],
    });
    expect(resolved.entries.get('parcel')?.source).toBe('default');
  });
});

describe('term()', () => {
  it('returns singular en by default', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [],
    });
    expect(term(resolved, 'parcel')).toBe('parcel');
  });

  it('returns plural when requested', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [],
    });
    expect(term(resolved, 'parcel', { plural: true })).toBe('parcels');
  });

  it('returns Swahili when requested', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [],
    });
    expect(term(resolved, 'parcel', { lang: 'sw' })).toBe('kifurushi');
    expect(term(resolved, 'parcel', { lang: 'sw', plural: true })).toBe('vifurushi');
  });

  it('returns the key as defensive fallback', () => {
    const resolved = resolveTerminologyForScope({
      tenantId: 't-borjie',
      scopePath: null,
      tree,
      overrides: [],
    });
    expect(term(resolved, 'nonexistent-key')).toBe('nonexistent-key');
  });
});
