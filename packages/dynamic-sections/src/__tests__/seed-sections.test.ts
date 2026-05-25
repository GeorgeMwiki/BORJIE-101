/**
 * Seed-registry shape tests — verify the J1 seed covers the spec's
 * nine entity types, scopes are correct, and the convenience
 * `createSeedRegistry` factory works.
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

describe('seedSections', () => {
  it('covers all nine J1 entity types', () => {
    const expected = [
      'employees',
      'customers',
      'properties',
      'leads',
      'deals',
      'kra-filings',
      'campaigns',
      'recommendations',
      'internal-staff',
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

  it('owner-customer with zero entities sees zero tabs', () => {
    const visible = filterSections(seedSections, ctx());
    expect(visible).toEqual([]);
  });

  it('owner-customer with two entity types sees exactly those two tabs', () => {
    const visible = filterSections(
      seedSections,
      ctx({ entityCounts: { customers: 3, properties: 1 } }),
    );
    expect(visible.map((s) => s.key)).toEqual(['customers', 'properties']);
  });

  it('internal-admin with zero entities + platform_ops role sees the customer-section override (all customer sections visible)', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        scope: 'internal-admin',
        roles: ['platform_ops'],
      }),
    );
    // Eight customer sections + internal-staff requires `has-entities`.
    expect(visible.map((s) => s.key)).toEqual([
      'employees',
      'customers',
      'properties',
      'leads',
      'deals',
      'kra-filings',
      'campaigns',
      'recommendations',
    ]);
  });

  it('internal-admin with the internal-staff entity + platform_ops role sees the staff tab', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        scope: 'internal-admin',
        roles: ['platform_ops'],
        entityCounts: { 'internal-staff': 4 },
      }),
    );
    expect(visible.map((s) => s.key)).toContain('internal-staff');
  });

  it('owner-customer never sees the internal-staff tab even with entities', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        scope: 'owner-customer',
        roles: ['platform_ops'],
        entityCounts: { 'internal-staff': 4 },
      }),
    );
    expect(visible.map((s) => s.key)).not.toContain('internal-staff');
  });

  it('internal-staff requires platform role, not just data presence', () => {
    const visible = filterSections(
      seedSections,
      ctx({
        scope: 'internal-admin',
        roles: ['md'],
        entityCounts: { 'internal-staff': 4 },
      }),
    );
    expect(visible.map((s) => s.key)).not.toContain('internal-staff');
  });

  it('createSeedRegistry returns a SectionRegistry with all 9 sections', () => {
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
