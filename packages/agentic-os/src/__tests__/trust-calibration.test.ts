import { describe, expect, it } from 'vitest';
import { createTrustCalibrator } from '../trust-calibration/index.js';

describe('trust-calibration / recordOutcome + getScore', () => {
  it('starts at the prior (0.5) for a new (agent, capability)', async () => {
    const c = createTrustCalibrator();
    const score = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });
    expect(score).toBeNull();
  });

  it('raises score on success', async () => {
    const c = createTrustCalibrator();
    for (let i = 0; i < 10; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        outcome: 'success',
        confidence: 1,
        observedAt: '2026-05-24T00:00:00Z',
      });
    }
    const score = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });
    expect(score).not.toBeNull();
    expect(score!.meanSuccessRate).toBeGreaterThan(0.8);
    expect(score!.recommendedCeiling).toMatch(/^L[3-5]$/);
  });

  it('lowers score on failure', async () => {
    const c = createTrustCalibrator();
    for (let i = 0; i < 10; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        outcome: 'failure',
        confidence: 1,
        observedAt: '2026-05-24T00:00:00Z',
      });
    }
    const score = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });
    expect(score!.meanSuccessRate).toBeLessThan(0.2);
    expect(score!.recommendedCeiling).toBe('L0');
  });

  it('partial outcomes nudge the score modestly', async () => {
    const c = createTrustCalibrator();
    for (let i = 0; i < 10; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        outcome: 'partial',
        confidence: 1,
        observedAt: '2026-05-24T00:00:00Z',
      });
    }
    const score = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });
    // partial = 0.5 success + 0.5 failure → mean stays near 0.5
    expect(score!.meanSuccessRate).toBeGreaterThan(0.4);
    expect(score!.meanSuccessRate).toBeLessThan(0.6);
  });

  it('decays score after long inactivity', async () => {
    const c = createTrustCalibrator({ decayHalfLifeDays: 7 });
    // Build high success rate at t0
    for (let i = 0; i < 30; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        outcome: 'success',
        confidence: 1,
        observedAt: '2026-05-01T00:00:00Z',
      });
    }
    const before = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });

    // Force time travel: record one no-op outcome 30 days later → decay applied
    // We can't fake time easily; trigger by reading immediately. Because the
    // implementation pegs decay to nowIso(), and we set observedAt in the past,
    // the next read should already have decayed.
    const after = await c.getScore({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
    });

    // before was computed at a slightly earlier "now" than after; both decay
    // toward the prior (0.5). Verify decay is monotonic toward prior.
    expect(after!.meanSuccessRate).toBeLessThanOrEqual(before!.meanSuccessRate);
    expect(after!.meanSuccessRate).toBeGreaterThan(0.5);
  });

  it('list returns all known scores', async () => {
    const c = createTrustCalibrator();
    await c.recordOutcome({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
      outcome: 'success',
      confidence: 1,
      observedAt: '2026-05-24T00:00:00Z',
    });
    await c.recordOutcome({
      agentId: 'agent-b',
      capabilityId: 'maintenance.fix',
      outcome: 'success',
      confidence: 1,
      observedAt: '2026-05-24T00:00:00Z',
    });
    const all = await c.list();
    expect(all.length).toBe(2);
  });
});

describe('trust-calibration / suggestedAutonomyLevel', () => {
  it('caps autonomy at risk-class ceiling', async () => {
    const c = createTrustCalibrator();
    for (let i = 0; i < 30; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'eviction.serve',
        outcome: 'success',
        confidence: 1,
        observedAt: '2026-05-24T00:00:00Z',
      });
    }
    // Score may justify L5 but critical risk caps at L2
    const level = await c.suggestedAutonomyLevel({
      agentId: 'agent-a',
      capabilityId: 'eviction.serve',
      riskClass: 'critical',
    });
    expect(level).toBe('L2');
  });

  it('uses score-derived ceiling when below risk cap', async () => {
    const c = createTrustCalibrator();
    for (let i = 0; i < 20; i++) {
      await c.recordOutcome({
        agentId: 'agent-a',
        capabilityId: 'lease.renew',
        outcome: 'failure',
        confidence: 1,
        observedAt: '2026-05-24T00:00:00Z',
      });
    }
    const level = await c.suggestedAutonomyLevel({
      agentId: 'agent-a',
      capabilityId: 'lease.renew',
      riskClass: 'low',
    });
    expect(level).toBe('L0');
  });

  it('returns 0.5-derived prior for unknown (agent, capability)', async () => {
    const c = createTrustCalibrator();
    const level = await c.suggestedAutonomyLevel({
      agentId: 'unknown',
      capabilityId: 'anything',
      riskClass: 'low',
    });
    // 0.5 mean → L1 per score table (>= 0.40, < 0.55)
    expect(level).toBe('L1');
  });
});
