import { describe, it, expect } from 'vitest';
import {
  runSimulationPure,
  createPolicySimulator,
  type LeaseSimInput,
} from '../policy-simulator/index.js';

const lease: LeaseSimInput = {
  leaseId: 'l1',
  customerId: 'c1',
  currencyCode: 'KES',
  currentRentMinor: 100_000,
  remainingMonths: 12,
  baselineRenewalProb: 0.8,
  churnSensitivityToRent: 1.5,
};

describe('policy-simulator', () => {
  it('runSimulationPure with zero leases produces zeros', () => {
    const out = runSimulationPure({
      tenantId: 't1',
      change: { kind: 'rent_increase_pct', magnitude: 0.05, description: '+5%' },
      scope: {},
      leases: [],
      paths: 10,
      seed: 42,
    });
    expect(out.leasesAffected).toBe(0);
    expect(out.kpiDelta.totalNpvMinor).toBe(0);
    expect(out.churnDistribution.mean).toBe(0);
  });

  it('is deterministic with the same seed', () => {
    const req = {
      tenantId: 't1',
      change: { kind: 'rent_increase_pct' as const, magnitude: 0.1, description: '+10%' },
      scope: {},
      leases: [lease, { ...lease, leaseId: 'l2' }],
      paths: 200,
      seed: 7,
    };
    const a = runSimulationPure(req);
    const b = runSimulationPure(req);
    expect(a.kpiDelta.totalNpvMinor).toBe(b.kpiDelta.totalNpvMinor);
    expect(a.churnDistribution.mean).toBe(b.churnDistribution.mean);
  });

  it('increases churn rate as rent increases magnitude (all else equal)', () => {
    const mild = runSimulationPure({
      tenantId: 't1',
      change: { kind: 'rent_increase_pct', magnitude: 0.02, description: '+2%' },
      scope: {},
      leases: [lease],
      paths: 500,
      seed: 123,
    });
    const aggressive = runSimulationPure({
      tenantId: 't1',
      change: { kind: 'rent_increase_pct', magnitude: 0.3, description: '+30%' },
      scope: {},
      leases: [lease],
      paths: 500,
      seed: 123,
    });
    expect(aggressive.churnDistribution.mean).toBeGreaterThanOrEqual(
      mild.churnDistribution.mean,
    );
  });

  it('service delegates to loadLeases when leases are not supplied', async () => {
    const svc = createPolicySimulator({
      async loadLeases(tenantId) {
        expect(tenantId).toBe('t1');
        return [lease];
      },
    });
    const out = await svc.simulate({
      tenantId: 't1',
      change: { kind: 'rent_increase_pct', magnitude: 0.05, description: '+5%' },
      scope: {},
      paths: 50,
      seed: 1,
    });
    expect(out.leasesAffected).toBe(1);
  });
});
