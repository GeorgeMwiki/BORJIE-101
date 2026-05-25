/**
 * Capability gating tests — stage × role × jurisdiction produces
 * unlocked / hidden / previewable sets.
 */

import { describe, it, expect } from 'vitest';
import {
  gatedCapabilities,
  CAPABILITY_FLAG_KEYS,
} from '../gating/index.js';
import { CAPABILITY_IDS, type StageRole } from '../types.js';

describe('gatedCapabilities — admin sees everything their stage unlocks', () => {
  it('admin at seedling sees lease + payments, hides procurement + fleet', () => {
    const r = gatedCapabilities({ stage: 'seedling', role: 'admin' });
    expect(r.unlocked).toContain('lease-lifecycle');
    expect(r.unlocked).toContain('payment-basics');
    expect(r.unlocked).not.toContain('fleet-management');
    expect(r.hidden).toContain('fleet-management');
  });

  it('admin at sapling unlocks procurement + inventory', () => {
    const r = gatedCapabilities({ stage: 'sapling', role: 'admin' });
    expect(r.unlocked).toContain('procurement-coordination');
    expect(r.unlocked).toContain('inventory-management');
    expect(r.unlocked).toContain('vendor-management');
  });

  it('admin at ecosystem unlocks everything', () => {
    const r = gatedCapabilities({ stage: 'ecosystem', role: 'admin' });
    for (const cap of CAPABILITY_IDS) {
      expect(r.unlocked).toContain(cap);
    }
    expect(r.hidden).toHaveLength(0);
    expect(r.previewable).toHaveLength(0);
  });
});

describe('gatedCapabilities — role is a hard cap', () => {
  it('tenant at sapling does NOT see procurement (role override)', () => {
    const r = gatedCapabilities({ stage: 'sapling', role: 'tenant' });
    expect(r.unlocked).not.toContain('procurement-coordination');
    expect(r.unlocked).not.toContain('inventory-management');
    expect(r.unlocked).not.toContain('vendor-management');
  });

  it('tenant at ecosystem still only sees tenant-scope caps', () => {
    const r = gatedCapabilities({ stage: 'ecosystem', role: 'tenant' });
    expect(r.unlocked).toEqual(
      expect.arrayContaining(['lease-lifecycle', 'payment-basics', 'communications']),
    );
    expect(r.unlocked).not.toContain('treasury');
    expect(r.unlocked).not.toContain('fleet-management');
  });

  it('prospect at any stage only sees first-property', () => {
    for (const stage of ['pre-launch', 'sapling', 'ecosystem'] as const) {
      const r = gatedCapabilities({ stage, role: 'prospect' });
      expect(r.unlocked).not.toContain('lease-lifecycle');
      expect(r.unlocked).not.toContain('treasury');
    }
  });

  it('service-provider sees only their tooling at sapling+', () => {
    const r = gatedCapabilities({ stage: 'tree', role: 'service-provider' });
    expect(r.unlocked).toContain('vendor-management');
    expect(r.unlocked).toContain('procurement-coordination');
    expect(r.unlocked).not.toContain('treasury');
    expect(r.unlocked).not.toContain('fleet-management');
  });

  it('owner sees portfolio caps; not the ops caps', () => {
    const r = gatedCapabilities({ stage: 'ecosystem', role: 'owner' });
    expect(r.unlocked).toContain('advanced-reporting');
    expect(r.unlocked).toContain('treasury');
    expect(r.unlocked).toContain('ir-aor-reports');
    expect(r.unlocked).not.toContain('maintenance-taxonomy');
    expect(r.unlocked).not.toContain('inventory-management');
  });
});

describe('gatedCapabilities — previewable is computed correctly', () => {
  it('seedling admin previewable contains procurement-related caps', () => {
    const r = gatedCapabilities({ stage: 'seedling', role: 'admin' });
    // procurement should be HIDDEN at seedling (not previewable).
    expect(r.hidden).toContain('procurement-coordination');
    // maintenance-taxonomy is neither unlocked nor explicitly hidden at seedling
    expect(r.previewable).toContain('maintenance-taxonomy');
  });

  it('previewable is empty at ecosystem (everything unlocked)', () => {
    const r = gatedCapabilities({ stage: 'ecosystem', role: 'admin' });
    expect(r.previewable).toHaveLength(0);
  });
});

describe('gatedCapabilities — jurisdiction deny-list', () => {
  it('unknown jurisdiction is a noop (default behaviour)', () => {
    const a = gatedCapabilities({ stage: 'tree', role: 'admin' });
    const b = gatedCapabilities({
      stage: 'tree',
      role: 'admin',
      jurisdiction: 'NONEXISTENT',
    });
    expect(a.unlocked).toEqual(b.unlocked);
  });
});

describe('CAPABILITY_FLAG_KEYS — every capability has a flag key', () => {
  for (const cap of CAPABILITY_IDS) {
    it(`${cap} has a flag key`, () => {
      expect(CAPABILITY_FLAG_KEYS[cap]).toBeTruthy();
      expect(CAPABILITY_FLAG_KEYS[cap]).toMatch(/^cap\./);
    });
  }
});

describe('gatedCapabilities — recommendedFlagKeys matches unlocked', () => {
  it('every unlocked capability has its flag key in recommended', () => {
    const r = gatedCapabilities({ stage: 'tree', role: 'admin' });
    for (const cap of r.unlocked) {
      expect(r.recommendedFlagKeys).toContain(CAPABILITY_FLAG_KEYS[cap]);
    }
    expect(r.recommendedFlagKeys.length).toBe(r.unlocked.length);
  });
});

describe('gatedCapabilities — per-role exhaustive coverage', () => {
  const allRoles: StageRole[] = [
    'admin',
    'property-manager',
    'estate-manager',
    'owner',
    'tenant',
    'prospect',
    'service-provider',
  ];
  for (const role of allRoles) {
    it(`role ${role} at sapling stage returns a non-empty result`, () => {
      const r = gatedCapabilities({ stage: 'sapling', role });
      // Every role + stage combo should be deterministic.
      const allLength =
        r.unlocked.length + r.hidden.length + r.previewable.length;
      expect(allLength).toBeGreaterThan(0);
    });
  }
});
