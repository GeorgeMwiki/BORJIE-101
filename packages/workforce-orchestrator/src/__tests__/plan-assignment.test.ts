import { describe, expect, it } from 'vitest';
import {
  PlanAssignmentInputSchema,
  planAssignment,
} from '../plan-assignment.js';

// A fixed "now" so the schedule is deterministic. Mon 2026-06-08 09:00 UTC.
const NOW_ISO = '2026-06-08T09:00:00.000Z';

describe('PlanAssignmentInputSchema', () => {
  it('rejects empty title', () => {
    expect(() =>
      PlanAssignmentInputSchema.parse({ title: '', description: 'x' }),
    ).toThrow();
  });

  it('defaults priority and riskHint', () => {
    const parsed = PlanAssignmentInputSchema.parse({
      title: 'inspect pit',
      description: 'routine inspection',
    });
    expect(parsed.priority).toBe('medium');
    expect(parsed.riskHint).toBe('LOW');
  });

  it('rejects a non-ISO dueAt', () => {
    expect(() =>
      PlanAssignmentInputSchema.parse({
        title: 't',
        description: 'd',
        dueAt: 'not-a-date',
      }),
    ).toThrow();
  });
});

describe('planAssignment', () => {
  it('keeps a LOW routine task at LOW with no HITL gate', () => {
    const plan = planAssignment({
      title: 'sweep the haul road',
      description: 'routine housekeeping',
      nowIso: NOW_ISO,
    });
    expect(plan.riskTier).toBe('LOW');
    expect(plan.hitlRequired).toBe(false);
    expect(plan.rationale.en).toContain('LOW');
    expect(plan.rationale.sw).toContain('LOW');
  });

  it('escalates to SOVEREIGN on regulator keywords and forces HITL', () => {
    const plan = planAssignment({
      title: 'respond to regulator audit',
      description: 'prepare the compliance breach response',
      riskHint: 'LOW',
      nowIso: NOW_ISO,
    });
    expect(plan.riskTier).toBe('SOVEREIGN');
    expect(plan.hitlRequired).toBe(true);
    // SOVEREIGN/HIGH cadence is daily check-ins.
    expect(plan.cadenceKinds).toEqual(['daily']);
    expect(plan.followups.length).toBeGreaterThan(0);
    expect(plan.followups.every((f) => f.cadenceKind === 'daily')).toBe(true);
  });

  it('escalates HIGH on a termination keyword (never downgrades the hint)', () => {
    const plan = planAssignment({
      title: 'terminate contractor agreement',
      description: 'end the vendor relationship',
      nowIso: NOW_ISO,
    });
    expect(plan.riskTier).toBe('HIGH');
    expect(plan.hitlRequired).toBe(true);
  });

  it('respects an explicit cadence override', () => {
    const plan = planAssignment({
      title: 'file the monthly report',
      description: 'standard report',
      cadenceKinds: ['end_of_week'],
      nowIso: NOW_ISO,
    });
    expect(plan.cadenceKinds).toEqual(['end_of_week']);
    expect(plan.followups).toHaveLength(1);
    expect(plan.followups[0]?.cadenceKind).toBe('end_of_week');
  });

  it('produces ISO follow-up timestamps strictly in the future', () => {
    const plan = planAssignment({
      title: 'urgent pump repair',
      description: 'pump down at site B',
      priority: 'urgent',
      nowIso: NOW_ISO,
    });
    const nowMs = new Date(NOW_ISO).getTime();
    for (const f of plan.followups) {
      expect(new Date(f.scheduledAt).getTime()).toBeGreaterThan(nowMs);
    }
  });

  it('never mutates its input object', () => {
    const input = {
      title: 'x',
      description: 'y',
      cadenceKinds: ['daily' as const],
    };
    const snapshot = JSON.stringify(input);
    planAssignment(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
