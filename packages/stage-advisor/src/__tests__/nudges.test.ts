/**
 * Nudge generator tests — idempotency, urgency rank, threshold-adjacency.
 */

import { describe, it, expect } from 'vitest';
import {
  generateStageNudges,
  urgencyRank,
  DEFAULT_LOOKBACK_DAYS,
} from '../nudges/index.js';
import { defaultOrgState } from '../index.js';
import { detectStage } from '../detect/index.js';
import type {
  DetectStageResult,
  OrgMetrics,
  OrgState,
  NudgeDeliveryRecord,
} from '../types.js';

function metricsFor(over?: Partial<OrgMetrics>): OrgMetrics {
  return {
    tenantId: 'tn-test',
    unitsManaged: 5,
    activeUsers: 2,
    monthlyRevenue: 100_000,
    currency: 'KES',
    ageMonths: 6,
    regionCount: 1,
    tenantChurnRate: 0.05,
    observedAt: '2026-05-24T00:00:00Z',
    ...over,
  };
}

function detectionFor(over?: Partial<DetectStageResult>): DetectStageResult {
  return {
    stage: 'seedling',
    rawStage: 'seedling',
    confidence: 0.85,
    evidence: ['Primary signal: 5 units.'],
    smoothingActive: false,
    ...over,
  };
}

describe('generateStageNudges — basic emission', () => {
  it('emits a playbook nudge when tasks are incomplete', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: [],
    });
    const playbookN = out.find((n) => n.id.includes('playbook'));
    expect(playbookN).toBeTruthy();
    expect(playbookN!.dismissable).toBe(true);
  });

  it('emits a stage-entered nudge at high urgency when smoothing inactive and playbook empty-ish', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: [],
    });
    const stageN = out.find((n) => n.id.includes('stage-entered'));
    expect(stageN).toBeTruthy();
    expect(stageN!.urgency).toBe('high');
  });

  it('emits an approach-next nudge when within 10% of threshold', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor({ unitsManaged: 9 }),
      detection: detectionFor({ stage: 'seedling', rawStage: 'seedling' }),
      lastDeliveredAt: [],
    });
    const approachN = out.find((n) => n.id.includes('approach-next'));
    expect(approachN).toBeTruthy();
    expect(approachN!.urgency).toBe('low');
  });

  it('does NOT emit approach-next when nowhere near threshold', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor({ unitsManaged: 2 }),
      detection: detectionFor({ stage: 'seedling', rawStage: 'seedling' }),
      lastDeliveredAt: [],
    });
    const approachN = out.find((n) => n.id.includes('approach-next'));
    expect(approachN).toBeUndefined();
  });

  it('emits churn-warning when rate > 12%', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor({ tenantChurnRate: 0.18 }),
      detection: detectionFor(),
      lastDeliveredAt: [],
    });
    const churnN = out.find((n) => n.id.includes('churn-warning'));
    expect(churnN).toBeTruthy();
    expect(churnN!.urgency).toBe('high');
  });

  it('no approach-next at ecosystem (no next stage)', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor({ unitsManaged: 9000 }),
      detection: detectionFor({ stage: 'ecosystem', rawStage: 'ecosystem' }),
      lastDeliveredAt: [],
    });
    const approachN = out.find((n) => n.id.includes('approach-next'));
    expect(approachN).toBeUndefined();
  });
});

describe('generateStageNudges — idempotency', () => {
  it('skips nudges delivered within the lookback window', () => {
    const recent: NudgeDeliveryRecord[] = [
      {
        nudgeId: 'stage-nudge:tn-test:stage-entered:seedling',
        deliveredAt: '2026-05-20T00:00:00Z', // 4 days before observedAt
      },
    ];
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: recent,
      nowIso: '2026-05-24T00:00:00Z',
      lookbackDays: 14,
    });
    const stageN = out.find((n) => n.id.includes('stage-entered'));
    expect(stageN).toBeUndefined();
  });

  it('re-emits nudges delivered outside the lookback window', () => {
    const old: NudgeDeliveryRecord[] = [
      {
        nudgeId: 'stage-nudge:tn-test:stage-entered:seedling',
        deliveredAt: '2026-04-01T00:00:00Z', // > 30 days before
      },
    ];
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: old,
      nowIso: '2026-05-24T00:00:00Z',
      lookbackDays: 14,
    });
    const stageN = out.find((n) => n.id.includes('stage-entered'));
    expect(stageN).toBeTruthy();
  });

  it('default lookback is 14 days', () => {
    expect(DEFAULT_LOOKBACK_DAYS).toBe(14);
  });
});

describe('urgencyRank — ordering', () => {
  it('critical > high > medium > low > info', () => {
    expect(urgencyRank('critical')).toBeGreaterThan(urgencyRank('high'));
    expect(urgencyRank('high')).toBeGreaterThan(urgencyRank('medium'));
    expect(urgencyRank('medium')).toBeGreaterThan(urgencyRank('low'));
    expect(urgencyRank('low')).toBeGreaterThan(urgencyRank('info'));
  });
});

describe('generateStageNudges — integration with detection', () => {
  it('matches detect output for sapling stage', () => {
    const metrics = metricsFor({ unitsManaged: 100, ageMonths: 24 });
    const detection = detectStage({ metrics });
    expect(detection.stage).toBe('sapling');
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics,
      detection,
      lastDeliveredAt: [],
    });
    expect(out.length).toBeGreaterThan(0);
    // Every nudge should reference the sapling stage.
    for (const n of out) {
      expect(n.stage).toBe('sapling');
    }
  });
});

describe('generateStageNudges — every nudge field is populated', () => {
  it('id, title, message, suggestedActionPrompt, evidence all present', () => {
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: [],
    });
    for (const n of out) {
      expect(n.id).toMatch(/^stage-nudge:/);
      expect(n.title.length).toBeGreaterThan(0);
      expect(n.message.length).toBeGreaterThan(0);
      expect(n.suggestedActionPrompt.length).toBeGreaterThan(0);
      expect(n.evidence.length).toBeGreaterThan(0);
      expect(typeof n.dismissable).toBe('boolean');
      expect(n.generatedAt).toBe('2026-05-24T00:00:00Z');
    }
  });
});

describe('generateStageNudges — variable lookback override', () => {
  it('honors a smaller lookback window', () => {
    const recent: NudgeDeliveryRecord[] = [
      {
        nudgeId: 'stage-nudge:tn-test:stage-entered:seedling',
        deliveredAt: '2026-05-22T00:00:00Z', // 2 days ago
      },
    ];
    const out = generateStageNudges({
      orgState: defaultOrgState('tn-test'),
      metrics: metricsFor(),
      detection: detectionFor(),
      lastDeliveredAt: recent,
      nowIso: '2026-05-24T00:00:00Z',
      lookbackDays: 1, // 2 > 1 → re-emit allowed
    });
    const stageN = out.find((n) => n.id.includes('stage-entered'));
    expect(stageN).toBeTruthy();
  });
});
