/**
 * Seed-registry shape tests — verify the eight Borjie mining-domain
 * sections, scope semantics, and the convenience factory.
 */

import { describe, expect, it } from 'vitest';
import {
  createSeedRegistry,
  seedSections,
  seedSectionKeys,
} from '../seed/index.js';
import { filterSections } from '../registry/filter.js';
import type { SectionContext } from '../contracts/section.js';

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

describe('seedSections (Borjie mining domain)', () => {
  it('covers all eight mining-domain entity types', () => {
    const expected = [
      'pml-licences',
      'royalty-drafts',
      'active-shifts',
      'ore-parcels',
      'nemc-filings',
      'geology-logs',
      'compliance-deadlines',
      'cooperative-membership',
    ].sort();
    expect([...seedSectionKeys].sort()).toEqual(expected);
  });

  it('emits stable, unique keys', () => {
    const keys = seedSections.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('each section has a sort_order, label, and icon', () => {
    for (const s of seedSections) {
      expect(typeof s.sort_order).toBe('number');
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.icon.length).toBeGreaterThan(0);
    }
  });

  it('owner-customer with zero data sees zero tabs', () => {
    const visible = filterSections(seedSections, ctx());
    expect(visible).toEqual([]);
  });

  it('owner-customer with two mining entity types sees exactly those two tabs', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        entityCounts: { 'pml-licences': 2, 'active-shifts': 1 },
      }),
    );
    expect(visible.map((s) => s.key)).toEqual([
      'pml-licences',
      'active-shifts',
    ]);
  });

  it('royalty-drafts appears during the open filing window even without drafts', () => {
    const visible = filterSections(
      seedSections,
      ctx({ featureFlags: ['royalty-window-open'] }),
    );
    expect(visible.map((s) => s.key)).toContain('royalty-drafts');
  });

  it('nemc-filings appears during the open filing window even without filings', () => {
    const visible = filterSections(
      seedSections,
      ctx({ featureFlags: ['nemc-window-open'] }),
    );
    expect(visible.map((s) => s.key)).toContain('nemc-filings');
  });

  it('compliance-deadlines uses the virtual 30-day entity_type', () => {
    const visibleEmpty = filterSections(
      seedSections,
      ctx({ entityCounts: { 'compliance-deadlines': 99 } }),
    );
    expect(visibleEmpty.map((s) => s.key)).not.toContain('compliance-deadlines');

    const visibleSoon = filterSections(
      seedSections,
      ctx({ entityCounts: { 'compliance-deadlines-30d': 3 } }),
    );
    expect(visibleSoon.map((s) => s.key)).toContain('compliance-deadlines');
  });

  it('cooperative-membership is gated by feature flag only and never appears for internal-admin', () => {
    const ownerFlagOff = filterSections(
      seedSections,
      ctx({ scope: 'owner-customer' }),
    );
    expect(ownerFlagOff.map((s) => s.key)).not.toContain('cooperative-membership');

    const ownerFlagOn = filterSections(
      seedSections,
      ctx({ scope: 'owner-customer', featureFlags: ['cooperative-member'] }),
    );
    expect(ownerFlagOn.map((s) => s.key)).toContain('cooperative-membership');

    const adminFlagOn = filterSections(
      seedSections,
      ctx({
        scope: 'internal-admin',
        roles: ['platform_ops'],
        featureFlags: ['cooperative-member'],
      }),
    );
    expect(adminFlagOn.map((s) => s.key)).not.toContain('cooperative-membership');
  });

  it('geology-logs requires both entity presence AND a drill-capable role for owner-customer', () => {
    const withoutRole = filterSections(
      seedSections,
      ctx({
        roles: ['labourer'],
        entityCounts: { 'geology-logs': 5 },
      }),
    );
    expect(withoutRole.map((s) => s.key)).not.toContain('geology-logs');

    const withRole = filterSections(
      seedSections,
      ctx({
        roles: ['geologist'],
        entityCounts: { 'geology-logs': 5 },
      }),
    );
    expect(withRole.map((s) => s.key)).toContain('geology-logs');
  });

  it('internal-admin with platform_ops sees every customer section even when empty', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        scope: 'internal-admin',
        roles: ['platform_ops'],
      }),
    );
    // Seven customer-side sections visible for platform triage;
    // cooperative-membership is owner-only by design.
    expect(visible.map((s) => s.key).sort()).toEqual(
      [
        'pml-licences',
        'royalty-drafts',
        'active-shifts',
        'ore-parcels',
        'nemc-filings',
        'geology-logs',
        'compliance-deadlines',
      ].sort(),
    );
  });

  it('createSeedRegistry returns a SectionRegistry with all eight sections', () => {
    const reg = createSeedRegistry();
    expect(reg.all.map((s) => s.key).sort()).toEqual(
      [...seedSectionKeys].sort(),
    );
  });

  it('createSeedRegistry produces immutable instances (re-registering throws)', () => {
    const reg = createSeedRegistry();
    expect(() => reg.register(seedSections[0]!)).toThrow(
      /duplicate section key/,
    );
  });

  it('sort_order is unique across the seed (deterministic tab ordering)', () => {
    const orders = seedSections.map((s) => s.sort_order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('each seed component_loader returns a default-exported component', async () => {
    for (const s of seedSections) {
      const mod = await s.component_loader();
      expect(typeof mod.default).toBe('function');
    }
  });
});
