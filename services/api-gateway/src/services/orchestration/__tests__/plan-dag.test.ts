/**
 * plan-dag tests — CE-2.
 *
 * Covers validatePlanEdges, topologicalOrder, applyRiskTierPolicy.
 */

import { describe, it, expect } from 'vitest';
import {
  applyRiskTierPolicy,
  planDagSchema,
  topologicalOrder,
  validatePlanEdges,
  type PlanDag,
} from '../plan-dag.js';

function buildPlan(overrides: Partial<PlanDag> = {}): PlanDag {
  return {
    planId: 'p1',
    intent: 'test plan',
    steps: [
      {
        id: 'a',
        toolId: 'mining.ui.navigate',
        input: { route: '/' },
        riskTier: 'low',
        evidenceIds: [],
        labelEn: 'Step A',
        labelSw: 'Hatua A',
      },
      {
        id: 'b',
        toolId: 'mining.ui.share_view',
        input: { entityType: 'draft', entityId: '1' },
        riskTier: 'medium',
        evidenceIds: [],
        labelEn: 'Step B',
        labelSw: 'Hatua B',
      },
    ],
    edges: [{ from: 'a', to: 'b' }],
    ...overrides,
  };
}

describe('planDagSchema', () => {
  it('accepts a well-formed plan', () => {
    const parsed = planDagSchema.safeParse(buildPlan());
    expect(parsed.success).toBe(true);
  });

  it('rejects plans with zero steps', () => {
    const parsed = planDagSchema.safeParse({
      ...buildPlan(),
      steps: [],
      edges: [],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects plans with more than 30 steps', () => {
    const steps = Array.from({ length: 31 }, (_, i) => ({
      id: `s${i}`,
      toolId: 'mining.ui.navigate',
      input: { route: '/' },
      riskTier: 'low' as const,
      evidenceIds: [],
      labelEn: 'x',
      labelSw: 'x',
    }));
    const parsed = planDagSchema.safeParse({
      planId: 'p',
      intent: 'p',
      steps,
      edges: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('validatePlanEdges', () => {
  it('flags missing endpoints', () => {
    const plan = buildPlan({ edges: [{ from: 'a', to: 'zzz' }] });
    const problems = validatePlanEdges(plan);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('zzz'))).toBe(true);
  });

  it('flags self-loops', () => {
    const plan = buildPlan({ edges: [{ from: 'a', to: 'a' }] });
    const problems = validatePlanEdges(plan);
    expect(problems.some((p) => p.includes('self-loop'))).toBe(true);
  });

  it('flags cycles', () => {
    const plan = buildPlan({
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    const problems = validatePlanEdges(plan);
    expect(problems.some((p) => p.includes('cycle'))).toBe(true);
  });

  it('accepts an acyclic plan', () => {
    expect(validatePlanEdges(buildPlan())).toEqual([]);
  });
});

describe('topologicalOrder', () => {
  it('orders dependents after their dependencies', () => {
    const plan = buildPlan();
    const ordered = topologicalOrder(plan);
    expect(ordered.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('throws on invalid plans', () => {
    const plan = buildPlan({
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(() => topologicalOrder(plan)).toThrow(/cycle/);
  });

  it('is stable across equivalent independent steps', () => {
    const plan = buildPlan({
      steps: [
        {
          id: 'z',
          toolId: 'mining.ui.navigate',
          input: { route: '/' },
          riskTier: 'low',
          evidenceIds: [],
          labelEn: 'z',
          labelSw: 'z',
        },
        {
          id: 'a',
          toolId: 'mining.ui.navigate',
          input: { route: '/' },
          riskTier: 'low',
          evidenceIds: [],
          labelEn: 'a',
          labelSw: 'a',
        },
        {
          id: 'm',
          toolId: 'mining.ui.navigate',
          input: { route: '/' },
          riskTier: 'low',
          evidenceIds: [],
          labelEn: 'm',
          labelSw: 'm',
        },
      ],
      edges: [],
    });
    const a = topologicalOrder(plan).map((s) => s.id);
    const b = topologicalOrder(plan).map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toEqual(['a', 'm', 'z']);
  });
});

describe('applyRiskTierPolicy', () => {
  it('leaves explicit checkpoints unchanged', () => {
    const plan = buildPlan({
      steps: [
        {
          id: 'a',
          toolId: 'mining.ui.navigate',
          input: { route: '/' },
          riskTier: 'high',
          evidenceIds: [],
          labelEn: 'a',
          labelSw: 'a',
          humanCheckpoint: 'confirm',
        },
      ],
      edges: [],
    });
    const updated = applyRiskTierPolicy(plan);
    expect(updated.steps[0]!.humanCheckpoint).toBe('confirm');
  });

  it('fills low-stakes steps with no checkpoint (autonomous)', () => {
    const plan = buildPlan({
      steps: [
        {
          id: 'a',
          toolId: 'mining.ui.navigate',
          input: { route: '/' },
          riskTier: 'low',
          evidenceIds: [],
          labelEn: 'a',
          labelSw: 'a',
        },
      ],
      edges: [],
    });
    const updated = applyRiskTierPolicy(plan);
    expect(updated.steps[0]!.humanCheckpoint).toBeUndefined();
  });

  it('fills medium-stakes steps with preview', () => {
    const plan = buildPlan({
      steps: [
        {
          id: 'a',
          toolId: 'mining.ui.share_view',
          input: { entityType: 'draft', entityId: '1' },
          riskTier: 'medium',
          evidenceIds: [],
          labelEn: 'a',
          labelSw: 'a',
        },
      ],
      edges: [],
    });
    const updated = applyRiskTierPolicy(plan);
    expect(updated.steps[0]!.humanCheckpoint).toBe('preview');
  });

  it('fills high-stakes steps with two-tap', () => {
    const plan = buildPlan({
      steps: [
        {
          id: 'a',
          toolId: 'kill_switch.open',
          input: {},
          riskTier: 'high',
          evidenceIds: [],
          labelEn: 'a',
          labelSw: 'a',
        },
      ],
      edges: [],
    });
    const updated = applyRiskTierPolicy(plan);
    expect(updated.steps[0]!.humanCheckpoint).toBe('two-tap');
  });

  it('returns a new plan (immutability)', () => {
    const plan = buildPlan();
    const updated = applyRiskTierPolicy(plan);
    expect(updated).not.toBe(plan);
    expect(updated.steps).not.toBe(plan.steps);
  });
});
