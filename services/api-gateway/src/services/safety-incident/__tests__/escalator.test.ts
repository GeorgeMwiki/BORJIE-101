/**
 * Safety-incident severity escalator — chain L-C (issue #193).
 */

import { describe, it, expect } from 'vitest';
import {
  escalateIncident,
  canInvestigate,
  canEscalateToRegulator,
} from '../escalator';

describe('escalateIncident', () => {
  it('low severity: manager only, no owner pulse, no regulator', () => {
    const r = escalateIncident({ severity: 'low', kind: 'safety' });
    expect(r.notifyManager).toBe(true);
    expect(r.notifyOwner).toBe(false);
    expect(r.notifyAdminCompliance).toBe(false);
    expect(r.draftRegulatorFiling).toBe(false);
    expect(r.emitCockpitPulse).toBe(false);
    expect(r.priority).toBe('normal');
  });

  it('medium severity: still manager-only', () => {
    const r = escalateIncident({ severity: 'medium', kind: 'safety' });
    expect(r.notifyOwner).toBe(false);
    expect(r.priority).toBe('normal');
  });

  it('high severity: owner + manager + cockpit, no regulator yet', () => {
    const r = escalateIncident({ severity: 'high', kind: 'equipment_failure' });
    expect(r.notifyManager).toBe(true);
    expect(r.notifyOwner).toBe(true);
    expect(r.emitCockpitPulse).toBe(true);
    expect(r.notifyAdminCompliance).toBe(false);
    expect(r.draftRegulatorFiling).toBe(false);
    expect(r.priority).toBe('urgent');
  });

  it('critical severity: full fan-out including regulator', () => {
    const r = escalateIncident({ severity: 'critical', kind: 'environmental' });
    expect(r.notifyManager).toBe(true);
    expect(r.notifyOwner).toBe(true);
    expect(r.notifyAdminCompliance).toBe(true);
    expect(r.draftRegulatorFiling).toBe(true);
    expect(r.emitCockpitPulse).toBe(true);
    expect(r.priority).toBe('critical');
  });

  it('fatality kind upgrades severity even if reported as low', () => {
    const r = escalateIncident({ severity: 'low', kind: 'fatality' });
    expect(r.notifyAdminCompliance).toBe(true);
    expect(r.draftRegulatorFiling).toBe(true);
    expect(r.priority).toBe('critical');
  });

  it('fatality severity routes to highest tier regardless of kind', () => {
    const r = escalateIncident({ severity: 'fatality', kind: 'safety' });
    expect(r.draftRegulatorFiling).toBe(true);
    expect(r.priority).toBe('critical');
  });

  it('returns bilingual sw + en summary', () => {
    const r = escalateIncident({ severity: 'critical', kind: 'safety' });
    expect(r.summary.sw).toContain('HATARI KUBWA');
    expect(r.summary.en).toContain('CRITICAL');
  });

  it('summary for low severity is the bilingual neutral phrase', () => {
    const r = escalateIncident({ severity: 'low', kind: 'safety' });
    expect(r.summary.sw).toContain('Tukio');
    expect(r.summary.en).toContain('incident');
  });
});

describe('canInvestigate', () => {
  it.each([
    ['OWNER', true],
    ['TENANT_ADMIN', true],
    ['PROPERTY_MANAGER', true],
    ['MAINTENANCE_STAFF', true],
    ['SUPER_ADMIN', true],
    ['RESIDENT', false],
    [undefined, false],
  ])('role=%s -> %s', (role, expected) => {
    expect(canInvestigate(role as string | undefined)).toBe(expected);
  });
});

describe('canEscalateToRegulator', () => {
  it.each([
    ['OWNER', true],
    ['TENANT_ADMIN', true],
    ['SUPER_ADMIN', true],
    ['PROPERTY_MANAGER', false],
    ['MAINTENANCE_STAFF', false],
    ['RESIDENT', false],
    [undefined, false],
  ])('role=%s -> %s', (role, expected) => {
    expect(canEscalateToRegulator(role as string | undefined)).toBe(expected);
  });
});
