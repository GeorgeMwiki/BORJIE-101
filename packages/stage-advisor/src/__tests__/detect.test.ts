/**
 * Stage detection tests — thresholds, secondary signals, hysteresis.
 */

import { describe, it, expect } from 'vitest';
import {
  detectStage,
  stageFromUnits,
  updateStageState,
  DEFAULT_SMOOTHING_DAYS,
} from '../detect/index.js';
import type { OrgMetrics, PersistedStageState } from '../types.js';

function baseMetrics(over?: Partial<OrgMetrics>): OrgMetrics {
  return {
    tenantId: 'tn-test',
    unitsManaged: 0,
    activeUsers: 1,
    monthlyRevenue: 0,
    currency: 'KES',
    ageMonths: 1,
    regionCount: 1,
    tenantChurnRate: 0,
    observedAt: '2026-05-24T00:00:00Z',
    ...over,
  };
}

describe('stageFromUnits — band classification', () => {
  it('0 units → pre-launch', () => {
    expect(stageFromUnits(0)).toBe('pre-launch');
  });
  it('1 unit → seedling', () => {
    expect(stageFromUnits(1)).toBe('seedling');
  });
  it('9 units → seedling', () => {
    expect(stageFromUnits(9)).toBe('seedling');
  });
  it('10 units → sprout', () => {
    expect(stageFromUnits(10)).toBe('sprout');
  });
  it('49 units → sprout', () => {
    expect(stageFromUnits(49)).toBe('sprout');
  });
  it('50 units → sapling', () => {
    expect(stageFromUnits(50)).toBe('sapling');
  });
  it('199 units → sapling', () => {
    expect(stageFromUnits(199)).toBe('sapling');
  });
  it('200 units → tree', () => {
    expect(stageFromUnits(200)).toBe('tree');
  });
  it('999 units → tree', () => {
    expect(stageFromUnits(999)).toBe('tree');
  });
  it('1000 units → forest', () => {
    expect(stageFromUnits(1000)).toBe('forest');
  });
  it('4999 units → forest', () => {
    expect(stageFromUnits(4999)).toBe('forest');
  });
  it('5000 units → ecosystem', () => {
    expect(stageFromUnits(5000)).toBe('ecosystem');
  });
  it('99999 units → ecosystem', () => {
    expect(stageFromUnits(99999)).toBe('ecosystem');
  });
  it('negative units clamp to pre-launch', () => {
    expect(stageFromUnits(-10)).toBe('pre-launch');
  });
  it('fractional units floor (3.9 → 3 → seedling)', () => {
    expect(stageFromUnits(3.9)).toBe('seedling');
  });
});

describe('detectStage — first-time classification', () => {
  it('returns the raw stage with no smoothing when there is no previous state', () => {
    const res = detectStage({ metrics: baseMetrics({ unitsManaged: 75 }) });
    expect(res.stage).toBe('sapling');
    expect(res.rawStage).toBe('sapling');
    expect(res.smoothingActive).toBe(false);
    expect(res.evidence.length).toBeGreaterThan(0);
  });
});

describe('detectStage — confidence scoring', () => {
  it('higher confidence with secondary signals satisfied', () => {
    const low = detectStage({ metrics: baseMetrics({ unitsManaged: 100 }) });
    const high = detectStage({
      metrics: baseMetrics({
        unitsManaged: 100,
        activeUsers: 30,
        ageMonths: 48,
        regionCount: 2,
        monthlyRevenue: 500_000,
        tenantChurnRate: 0.02,
      }),
    });
    expect(high.confidence).toBeGreaterThan(low.confidence);
    expect(high.confidence).toBeLessThanOrEqual(1);
  });

  it('confidence caps at 1.0 even with all signals maxed', () => {
    const res = detectStage({
      metrics: baseMetrics({
        unitsManaged: 100,
        activeUsers: 1000,
        ageMonths: 240,
        regionCount: 50,
        monthlyRevenue: 1_000_000_000,
        tenantChurnRate: 0.01,
      }),
    });
    expect(res.confidence).toBeLessThanOrEqual(1);
  });
});

describe('detectStage — hysteresis prevents flapping', () => {
  const tenantId = 'tn-test';
  const baseState: PersistedStageState = {
    tenantId,
    currentStage: 'seedling',
    currentStageSince: '2026-04-01T00:00:00Z',
    candidateStage: null,
    candidateStageSince: null,
  };

  it('same-stage classification skips hysteresis', () => {
    const res = detectStage({
      metrics: baseMetrics({ unitsManaged: 5 }),
      previousState: baseState,
    });
    expect(res.stage).toBe('seedling');
    expect(res.smoothingActive).toBe(false);
  });

  it('brand-new candidate stage holds at previous stage', () => {
    const res = detectStage({
      metrics: baseMetrics({ unitsManaged: 12, observedAt: '2026-05-01T00:00:00Z' }),
      previousState: baseState,
    });
    expect(res.stage).toBe('seedling');
    expect(res.rawStage).toBe('sprout');
    expect(res.smoothingActive).toBe(true);
  });

  it('candidate sustained < smoothingDays still holds', () => {
    const prev: PersistedStageState = {
      ...baseState,
      candidateStage: 'sprout',
      candidateStageSince: '2026-05-01T00:00:00Z',
    };
    const res = detectStage({
      metrics: baseMetrics({
        unitsManaged: 12,
        observedAt: '2026-05-15T00:00:00Z', // only 14 days
      }),
      previousState: prev,
    });
    expect(res.stage).toBe('seedling');
    expect(res.smoothingActive).toBe(true);
  });

  it('candidate sustained ≥ smoothingDays graduates to raw', () => {
    const prev: PersistedStageState = {
      ...baseState,
      candidateStage: 'sprout',
      candidateStageSince: '2026-04-01T00:00:00Z',
    };
    const res = detectStage({
      metrics: baseMetrics({
        unitsManaged: 12,
        observedAt: '2026-05-15T00:00:00Z', // 44 days, > 30
      }),
      previousState: prev,
    });
    expect(res.stage).toBe('sprout');
    expect(res.smoothingActive).toBe(false);
  });

  it('different candidate observed resets the clock', () => {
    const prev: PersistedStageState = {
      ...baseState,
      candidateStage: 'sprout',
      candidateStageSince: '2026-04-01T00:00:00Z',
    };
    // Org momentarily jumped to sapling — different candidate.
    const res = detectStage({
      metrics: baseMetrics({
        unitsManaged: 60,
        observedAt: '2026-05-15T00:00:00Z',
      }),
      previousState: prev,
    });
    // Holds at seedling because the new candidate (sapling) has just started.
    expect(res.stage).toBe('seedling');
    expect(res.rawStage).toBe('sapling');
    expect(res.smoothingActive).toBe(true);
  });

  it('rapid crossings do not flap when smoothing is in play', () => {
    let state: PersistedStageState = { ...baseState };
    // Day 1: crosses into sprout
    let res = detectStage({
      metrics: baseMetrics({ unitsManaged: 12, observedAt: '2026-05-01T00:00:00Z' }),
      previousState: state,
    });
    expect(res.stage).toBe('seedling');
    state = updateStageState(state, res, '2026-05-01T00:00:00Z', 'tn-test');
    // Day 5: drops back to seedling
    res = detectStage({
      metrics: baseMetrics({ unitsManaged: 8, observedAt: '2026-05-05T00:00:00Z' }),
      previousState: state,
    });
    expect(res.stage).toBe('seedling');
    expect(res.rawStage).toBe('seedling');
    state = updateStageState(state, res, '2026-05-05T00:00:00Z', 'tn-test');
    // Day 10: crosses again
    res = detectStage({
      metrics: baseMetrics({ unitsManaged: 13, observedAt: '2026-05-10T00:00:00Z' }),
      previousState: state,
    });
    expect(res.stage).toBe('seedling');
    expect(res.smoothingActive).toBe(true);
  });

  it('smoothingDays can be overridden for tests', () => {
    const prev: PersistedStageState = {
      ...baseState,
      candidateStage: 'sprout',
      candidateStageSince: '2026-05-01T00:00:00Z',
    };
    const res = detectStage({
      metrics: baseMetrics({
        unitsManaged: 12,
        observedAt: '2026-05-08T00:00:00Z', // 7 days
      }),
      previousState: prev,
      smoothingDays: 5,
    });
    expect(res.stage).toBe('sprout');
  });
});

describe('updateStageState — state machine', () => {
  it('clears candidate when raw matches current', () => {
    const prev: PersistedStageState = {
      tenantId: 'tn',
      currentStage: 'sprout',
      currentStageSince: '2026-04-01T00:00:00Z',
      candidateStage: 'seedling',
      candidateStageSince: '2026-05-01T00:00:00Z',
    };
    const next = updateStageState(
      prev,
      {
        stage: 'sprout',
        rawStage: 'sprout',
        confidence: 0.8,
        evidence: [],
        smoothingActive: false,
      },
      '2026-05-15T00:00:00Z',
      'tn',
    );
    expect(next.candidateStage).toBeNull();
  });

  it('flips currentStage on graduation', () => {
    const prev: PersistedStageState = {
      tenantId: 'tn',
      currentStage: 'seedling',
      currentStageSince: '2026-04-01T00:00:00Z',
      candidateStage: 'sprout',
      candidateStageSince: '2026-04-15T00:00:00Z',
    };
    const next = updateStageState(
      prev,
      {
        stage: 'sprout',
        rawStage: 'sprout',
        confidence: 0.8,
        evidence: [],
        smoothingActive: false,
      },
      '2026-05-15T00:00:00Z',
      'tn',
    );
    expect(next.currentStage).toBe('sprout');
    expect(next.currentStageSince).toBe('2026-05-15T00:00:00Z');
    expect(next.candidateStage).toBeNull();
  });

  it('refreshes candidate when raw is a new candidate', () => {
    const prev: PersistedStageState = {
      tenantId: 'tn',
      currentStage: 'seedling',
      currentStageSince: '2026-04-01T00:00:00Z',
      candidateStage: 'sprout',
      candidateStageSince: '2026-04-15T00:00:00Z',
    };
    const next = updateStageState(
      prev,
      {
        stage: 'seedling',
        rawStage: 'sapling', // new candidate
        confidence: 0.7,
        evidence: [],
        smoothingActive: true,
      },
      '2026-05-15T00:00:00Z',
      'tn',
    );
    expect(next.candidateStage).toBe('sapling');
    expect(next.candidateStageSince).toBe('2026-05-15T00:00:00Z');
  });
});

describe('DEFAULT_SMOOTHING_DAYS — sane default', () => {
  it('is 30 days per spec', () => {
    expect(DEFAULT_SMOOTHING_DAYS).toBe(30);
  });
});
