import { describe, expect, it } from 'vitest';
import { InMemoryUserScopeBindingRepository } from '../bindings/binding-repository.js';
import { InMemoryTerminologyOverrideRepository } from '../terminology/override-repository.js';

describe('InMemoryUserScopeBindingRepository', () => {
  it('grants, lists, and revokes bindings', async () => {
    const repo = new InMemoryUserScopeBindingRepository();
    const grant = await repo.grant({
      userId: 'u-1',
      tenantId: 't-borjie',
      scopeKind: 'org_unit',
      orgUnitId: 'geita',
      role: 'admin',
      authorityTierMax: 2,
      grantedBy: 'owner',
    });
    expect(grant.user_id).toBe('u-1');

    const listed = await repo.list({ tenantId: 't-borjie', userId: 'u-1' });
    expect(listed.length).toBe(1);

    await repo.revoke(grant.id);
    const afterRevoke = await repo.list({ tenantId: 't-borjie', userId: 'u-1' });
    expect(afterRevoke.length).toBe(0);

    const includingRevoked = await repo.list({
      tenantId: 't-borjie',
      userId: 'u-1',
      includeRevoked: true,
    });
    expect(includingRevoked.length).toBe(1);
    expect(includingRevoked[0]?.revoked_at).not.toBeNull();
  });

  it('filters by org_unit_id when provided', async () => {
    const repo = new InMemoryUserScopeBindingRepository();
    await repo.grant({
      userId: 'u-1',
      tenantId: 't-borjie',
      scopeKind: 'org_unit',
      orgUnitId: 'geita',
      role: 'admin',
      authorityTierMax: 2,
      grantedBy: 'owner',
    });
    await repo.grant({
      userId: 'u-2',
      tenantId: 't-borjie',
      scopeKind: 'org_unit',
      orgUnitId: 'mererani',
      role: 'admin',
      authorityTierMax: 2,
      grantedBy: 'owner',
    });
    const geitaOnly = await repo.list({ tenantId: 't-borjie', orgUnitId: 'geita' });
    expect(geitaOnly.length).toBe(1);
    expect(geitaOnly[0]?.user_id).toBe('u-1');
  });
});

describe('InMemoryTerminologyOverrideRepository', () => {
  it('upserts and lists overrides', async () => {
    const repo = new InMemoryTerminologyOverrideRepository();
    const first = await repo.upsert({
      tenantId: 't-borjie',
      orgUnitId: 'geita',
      key: 'parcel',
      singularEn: 'lot',
      pluralEn: 'lots',
      singularSw: null,
      pluralSw: null,
      overriddenBy: 'owner',
    });
    expect(first.singular_en).toBe('lot');

    // Upserting again updates the existing row (same id).
    const second = await repo.upsert({
      tenantId: 't-borjie',
      orgUnitId: 'geita',
      key: 'parcel',
      singularEn: 'parcel-v2',
      pluralEn: 'parcels-v2',
      singularSw: null,
      pluralSw: null,
      overriddenBy: 'owner',
    });
    expect(second.id).toBe(first.id);
    expect(second.singular_en).toBe('parcel-v2');

    const listed = await repo.list({ tenantId: 't-borjie', key: 'parcel' });
    expect(listed.length).toBe(1);

    await repo.remove(second.id);
    const afterRemove = await repo.list({ tenantId: 't-borjie', key: 'parcel' });
    expect(afterRemove.length).toBe(0);
  });

  it('filters by orgUnitId === null for tenant-wide rows', async () => {
    const repo = new InMemoryTerminologyOverrideRepository();
    await repo.upsert({
      tenantId: 't-borjie',
      orgUnitId: null,
      key: 'parcel',
      singularEn: 'package',
      pluralEn: 'packages',
      singularSw: null,
      pluralSw: null,
      overriddenBy: 'owner',
    });
    const tenantWide = await repo.list({ tenantId: 't-borjie', orgUnitId: null });
    expect(tenantWide.length).toBe(1);
  });
});
