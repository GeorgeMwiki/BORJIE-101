/**
 * Starting-points tests.
 */

import { describe, it, expect } from 'vitest';
import { generateStartingPoints } from '../starting-points.js';

describe('generateStartingPoints', () => {
  it('puts lease-renewal in the top 2 when lease ends in <60 days', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: {
        today: '2026-04-01',
        leaseEndDate: '2026-05-15',
      },
    });
    const top2 = chips.slice(0, 2).map((c) => c.id);
    expect(top2).toContain('lease-renewal');
  });

  it('does NOT include lease-renewal when lease is not ending soon', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: {
        today: '2026-04-01',
        leaseEndDate: '2027-03-01',
      },
    });
    expect(chips.map((c) => c.id)).not.toContain('lease-renewal');
  });

  it('escalates maintenance when ticket > 7 days old', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: { today: '2026-04-01', oldestOpenMaintenanceAgeDays: 12 },
    });
    expect(chips.map((c) => c.id)).toContain('maintenance-escalate');
  });

  it('does NOT escalate maintenance when ticket = 5 days', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: { today: '2026-04-01', oldestOpenMaintenanceAgeDays: 5 },
    });
    expect(chips.map((c) => c.id)).not.toContain('maintenance-escalate');
  });

  it('adds winter-energy chip in winter for tenants', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: { today: '2026-01-15', season: 'winter' },
    });
    expect(chips.map((c) => c.id)).toContain('season-winter-energy');
  });

  it('adds wet-season damp chip during the rainy season', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'owner' },
      context: { today: '2026-03-15', season: 'wet' },
    });
    expect(chips.map((c) => c.id)).toContain('season-wet-damp');
  });

  it('owner without PM gets onboarding chip', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'owner' },
      context: {
        today: '2026-04-01',
        ownedPropertyCount: 1,
        hasPropertyManager: false,
      },
    });
    expect(chips.map((c) => c.id)).toContain('owner-onboard-pm');
  });

  it('owner who just logged a property gets sustainability-upgrade chip', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'owner' },
      context: {
        today: '2026-04-01',
        recentActivity: 'logged-new-property',
      },
    });
    expect(chips.map((c) => c.id)).toContain('owner-sustainability-upgrade');
  });

  it('PM gets arrears chip when arrears > 0', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'property-manager' },
      context: { today: '2026-04-01', arrearsCount: 8 },
    });
    expect(chips.map((c) => c.id)).toContain('pm-arrears');
  });

  it('tenant with late-notice gets the late-notice chip near the top', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: { today: '2026-04-01', recentActivity: 'received-late-notice' },
    });
    expect(chips[0]?.id).toBe('tenant-late-notice');
  });

  it('always returns at least 3 chips (role defaults top up)', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'admin' },
      context: { today: '2026-04-01' },
    });
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it('never returns more than 5 chips', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: {
        today: '2026-04-01',
        leaseEndDate: '2026-05-15',
        oldestOpenMaintenanceAgeDays: 12,
        season: 'winter',
        recentActivity: 'received-late-notice',
      },
    });
    expect(chips.length).toBeLessThanOrEqual(5);
  });

  it('de-dupes chip ids', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: { today: '2026-04-01' },
    });
    const ids = chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every chip carries a prompt and reason', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'prospect' },
      context: { today: '2026-04-01' },
    });
    for (const c of chips) {
      expect(c.prompt.length).toBeGreaterThan(5);
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });

  it('chips are sorted by descending priority', () => {
    const chips = generateStartingPoints({
      user: { id: 'u1', tenantId: 't1', role: 'tenant' },
      context: {
        today: '2026-04-01',
        leaseEndDate: '2026-05-15',
        oldestOpenMaintenanceAgeDays: 12,
        season: 'winter',
      },
    });
    for (let i = 1; i < chips.length; i++) {
      expect(chips[i - 1]!.priority).toBeGreaterThanOrEqual(chips[i]!.priority);
    }
  });

  it('role defaults differ across roles', () => {
    const tenantChips = generateStartingPoints({
      user: { id: 'u', tenantId: 't', role: 'tenant' },
      context: { today: '2026-04-01' },
    }).map((c) => c.id);
    const ownerChips = generateStartingPoints({
      user: { id: 'u', tenantId: 't', role: 'owner' },
      context: { today: '2026-04-01' },
    }).map((c) => c.id);
    expect(tenantChips).not.toEqual(ownerChips);
  });
});
