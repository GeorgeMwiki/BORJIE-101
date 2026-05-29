/**
 * grounding tests — CE-7 evidence-required invariant.
 */

import { describe, it, expect } from 'vitest';
import {
  attachEvidenceToPlan,
  summariseEvidenceCoverage,
  validateEvidenceChain,
} from '../grounding.js';
import { applyRiskTierPolicy, type PlanDag } from '../plan-dag.js';

const PLAN: PlanDag = applyRiskTierPolicy({
  planId: 'p1',
  intent: 't',
  steps: [
    {
      id: 'a',
      toolId: 'mining.ui.navigate',
      input: { route: '/' },
      riskTier: 'low',
      evidenceIds: ['e1'],
      labelEn: 'a',
      labelSw: 'a',
    },
    {
      id: 'b',
      toolId: 'mining.ui.share_view',
      input: { entityType: 'draft', entityId: '1' },
      riskTier: 'medium',
      evidenceIds: [],
      labelEn: 'b',
      labelSw: 'b',
    },
  ],
  edges: [{ from: 'a', to: 'b' }],
});

describe('validateEvidenceChain', () => {
  it('rejects empty chains', () => {
    const problems = validateEvidenceChain([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.code).toBe('empty_chain');
  });

  it('accepts a well-formed chain', () => {
    const claims = [
      { evidenceId: 'e1', sourceKind: 'corpus_chunk' as const },
      { evidenceId: 'e2', sourceKind: 'lmbm' as const, score: 0.9 },
    ];
    expect(validateEvidenceChain(claims)).toEqual([]);
  });

  it('flags malformed claims (missing required fields)', () => {
    const problems = validateEvidenceChain([{ sourceKind: 'corpus_chunk' }]);
    expect(problems[0]?.code).toBe('malformed_claim');
  });

  it('flags duplicate evidence ids', () => {
    const problems = validateEvidenceChain([
      { evidenceId: 'e1', sourceKind: 'corpus_chunk' as const },
      { evidenceId: 'e1', sourceKind: 'lmbm' as const },
    ]);
    expect(problems[0]?.code).toBe('duplicate_evidence_id');
  });

  it('flags unknown source kinds via schema', () => {
    const problems = validateEvidenceChain([
      { evidenceId: 'e1', sourceKind: 'unknown' },
    ]);
    expect(problems[0]?.code).toBe('malformed_claim');
  });
});

describe('attachEvidenceToPlan', () => {
  it('leaves step a (already cited) unchanged, fills step b', () => {
    const updated = attachEvidenceToPlan(PLAN, ['shared-1', 'shared-2']);
    const a = updated.steps.find((s) => s.id === 'a')!;
    const b = updated.steps.find((s) => s.id === 'b')!;
    expect(a.evidenceIds).toEqual(['e1']);
    expect(b.evidenceIds).toEqual(['shared-1', 'shared-2']);
  });

  it('returns the original plan when no evidence is supplied', () => {
    expect(attachEvidenceToPlan(PLAN, [])).toBe(PLAN);
  });

  it('produces a NEW plan (immutability)', () => {
    const updated = attachEvidenceToPlan(PLAN, ['x']);
    expect(updated).not.toBe(PLAN);
    expect(updated.steps).not.toBe(PLAN.steps);
  });
});

describe('summariseEvidenceCoverage', () => {
  it('counts cited vs uncited steps', () => {
    const summary = summariseEvidenceCoverage(PLAN);
    expect(summary.totalSteps).toBe(2);
    expect(summary.citedSteps).toBe(1);
    expect(summary.uncitedStepIds).toEqual(['b']);
  });

  it('reports zero uncited after attach', () => {
    const filled = attachEvidenceToPlan(PLAN, ['e0']);
    const summary = summariseEvidenceCoverage(filled);
    expect(summary.uncitedStepIds).toEqual([]);
  });
});
