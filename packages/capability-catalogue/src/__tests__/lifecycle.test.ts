import { describe, it, expect } from 'vitest';

import {
  decideLifecycle,
  DEFAULT_THRESHOLDS,
  type Capability,
  type Measurement,
  type Lifecycle,
} from '../index.js';

function cap(state: Lifecycle): Capability {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: 't',
    name: 'compose_x',
    version: '1.0.0',
    kind: 'tenant',
    owner: 'tenant:t',
    lifecycleState: state,
    dependencies: [],
    contract: {
      inputSchema: {},
      outputSchema: {},
      costClass: 'tier_1',
      latencyBudgetMs: 5000,
    },
    provenanceClass: 'tenant_authored',
    createdAt: new Date().toISOString(),
    auditHash: 'h',
    prevHash: null,
  };
}

function meas(partial: Partial<Measurement>): Measurement {
  return {
    id: 'm',
    tenantId: 't',
    capabilityId: '11111111-1111-1111-1111-111111111111',
    windowDays: 7,
    measuredAt: new Date().toISOString(),
    competenceRate: 0.9,
    calibrationError: 0.1,
    utilityRate: 0.7,
    nObservations: 50,
    auditHash: 'h',
    ...partial,
  };
}

describe('decideLifecycle', () => {
  it('promotes draft → shadow on first observation', () => {
    const v = decideLifecycle({
      capability: cap('draft'),
      window7d: meas({ nObservations: 5 }),
      window28d: null,
      dependenciesLive: true,
    });
    expect(v.nextState).toBe('shadow');
  });

  it('promotes shadow → live when all three axes clear thresholds', () => {
    const v = decideLifecycle({
      capability: cap('shadow'),
      window7d: meas({
        competenceRate: 0.95,
        calibrationError: 0.05,
        utilityRate: 0.8,
        nObservations: DEFAULT_THRESHOLDS.minObservations + 1,
      }),
      window28d: null,
      dependenciesLive: true,
    });
    expect(v.nextState).toBe('live');
  });

  it('blocks shadow promotion when a dependency is not live', () => {
    const v = decideLifecycle({
      capability: cap('shadow'),
      window7d: meas({
        competenceRate: 0.95,
        calibrationError: 0.05,
        utilityRate: 0.8,
        nObservations: 100,
      }),
      window28d: null,
      dependenciesLive: false,
    });
    expect(v.nextState).toBeNull();
  });

  it('demotes live → locked when any 7d axis collapses', () => {
    const v = decideLifecycle({
      capability: cap('live'),
      window7d: meas({
        competenceRate: 0.2,
        nObservations: 100,
      }),
      window28d: null,
      dependenciesLive: true,
    });
    expect(v.nextState).toBe('locked');
  });

  it('keeps live stable on healthy metrics', () => {
    const v = decideLifecycle({
      capability: cap('live'),
      window7d: meas({ nObservations: 100 }),
      window28d: meas({ nObservations: 200, utilityRate: 0.5 }),
      dependenciesLive: true,
    });
    expect(v.nextState).toBeNull();
  });

  it('deprecates live → deprecated on sustained zero utility', () => {
    const v = decideLifecycle({
      capability: cap('live'),
      window7d: meas({ nObservations: 100 }),
      window28d: meas({
        utilityRate: 0.05,
        nObservations: 200,
      }),
      dependenciesLive: true,
    });
    expect(v.nextState).toBe('deprecated');
  });

  it('does not move terminal deprecated', () => {
    const v = decideLifecycle({
      capability: cap('deprecated'),
      window7d: meas({ nObservations: 100 }),
      window28d: null,
      dependenciesLive: true,
    });
    expect(v.nextState).toBeNull();
  });
});
