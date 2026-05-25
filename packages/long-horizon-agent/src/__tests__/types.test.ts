import { describe, it, expect } from 'vitest';
import {
  agencyMissionSchema,
  missionStepSchema,
  missionCheckpointSchema,
  missionOutcomeSchema,
  missionDriftEventSchema,
  planMissionInputSchema,
  riskTierSchema,
  autonomyTierSchema,
  stepKindSchema,
  driftKindSchema,
  outcomeKindSchema,
} from '../types.js';
import {
  makeMission,
  makeStep,
  makeCheckpoint,
  makeOutcome,
  makeDrift,
} from './_fixtures.js';

describe('types — enum schemas', () => {
  it('riskTierSchema accepts canonical tiers and rejects unknown', () => {
    expect(() => riskTierSchema.parse('LOW')).not.toThrow();
    expect(() => riskTierSchema.parse('MEDIUM')).not.toThrow();
    expect(() => riskTierSchema.parse('HIGH')).not.toThrow();
    expect(() => riskTierSchema.parse('SOVEREIGN')).not.toThrow();
    expect(() => riskTierSchema.parse('extreme')).toThrow();
  });

  it('autonomyTierSchema accepts canonical tiers', () => {
    expect(() => autonomyTierSchema.parse('HITL_HIGH')).not.toThrow();
    expect(() => autonomyTierSchema.parse('HITL_MEDIUM')).not.toThrow();
    expect(() => autonomyTierSchema.parse('HITL_LOW')).not.toThrow();
    expect(() => autonomyTierSchema.parse('AUTONOMOUS')).not.toThrow();
    expect(() => autonomyTierSchema.parse('YOLO')).toThrow();
  });

  it('stepKindSchema accepts canonical kinds', () => {
    for (const k of ['plan', 'gather', 'execute', 'check', 'reflect']) {
      expect(() => stepKindSchema.parse(k)).not.toThrow();
    }
    expect(() => stepKindSchema.parse('think')).toThrow();
  });

  it('driftKindSchema accepts canonical kinds', () => {
    for (const k of [
      'goal_shift',
      'step_replan',
      'budget_overrun',
      'deadline_slip',
      'external_blocker',
    ]) {
      expect(() => driftKindSchema.parse(k)).not.toThrow();
    }
    expect(() => driftKindSchema.parse('plan_glitch')).toThrow();
  });

  it('outcomeKindSchema accepts canonical kinds', () => {
    for (const k of ['success', 'partial', 'failed', 'abandoned']) {
      expect(() => outcomeKindSchema.parse(k)).not.toThrow();
    }
    expect(() => outcomeKindSchema.parse('mixed')).toThrow();
  });
});

describe('types — record schemas round-trip', () => {
  it('agencyMissionSchema parses a canonical mission', () => {
    const m = makeMission();
    const parsed = agencyMissionSchema.parse(m);
    expect(parsed.id).toBe(m.id);
    expect(parsed.riskTier).toBe('MEDIUM');
  });

  it('missionStepSchema parses a canonical step', () => {
    const s = makeStep();
    const parsed = missionStepSchema.parse(s);
    expect(parsed.stepKind).toBe('plan');
    expect(parsed.attempts).toBe(0);
  });

  it('missionCheckpointSchema parses a checkpoint', () => {
    const c = makeCheckpoint();
    const parsed = missionCheckpointSchema.parse(c);
    expect(parsed.checkpointKind).toBe('daily');
    expect(parsed.needsHumanReview).toBe(false);
  });

  it('missionOutcomeSchema parses an outcome', () => {
    const o = makeOutcome();
    const parsed = missionOutcomeSchema.parse(o);
    expect(parsed.outcomeKind).toBe('success');
    expect(parsed.metricsJsonb.stepsCompleted).toBe(0);
  });

  it('missionDriftEventSchema parses a drift event', () => {
    const d = makeDrift();
    const parsed = missionDriftEventSchema.parse(d);
    expect(parsed.driftKind).toBe('step_replan');
  });
});

describe('types — planMissionInputSchema defaults', () => {
  it('applies sensible defaults for constraints', () => {
    const parsed = planMissionInputSchema.parse({
      tenantId: 'tenant-a',
      assignedByUserId: 'user-a',
      title: 'Test mission',
      goal: 'Just a test',
    });
    expect(parsed.constraints.riskTier).toBe('MEDIUM');
    expect(parsed.constraints.autonomyTier).toBe('HITL_HIGH');
    expect(parsed.constraints.expectedCompletionDate).toBeNull();
    expect(parsed.constraints.budgetMinorUnits).toBeNull();
    expect(parsed.constraints.assetRefs).toEqual([]);
    expect(parsed.context).toEqual({});
    expect(parsed.ownerPersonaId).toBeNull();
  });

  it('rejects missing required fields', () => {
    expect(() =>
      planMissionInputSchema.parse({
        tenantId: 'tenant-a',
        // missing assignedByUserId
        title: 'Test',
        goal: 'Goal',
      }),
    ).toThrow();
  });
});
