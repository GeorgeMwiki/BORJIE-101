import { describe, expect, it } from 'vitest';
import { decideImprove } from '../decisions/improve-decision.js';
import type { FitnessReport, RecipeMetrics, FailingSignal } from '../types.js';

function emptyMetrics(): RecipeMetrics {
  return {
    tabRecipeId: 'r',
    tabRecipeVersion: 1,
    windowStartIso: '',
    windowEndIso: '',
    renderCount: 100,
    submitCount: 30,
    completionRate: 0.3,
    errorRate: 0.2,
    maxFieldAbandonmentRate: 0.3,
    fields: [],
  };
}

function failing(): ReadonlyArray<FailingSignal> {
  return [
    {
      kind: 'low_completion',
      value: 0.3,
      threshold: 0.5,
      humanReadable: 'Completion 30%.',
    },
  ];
}

function report(
  decision: FitnessReport['decision'],
  signals: ReadonlyArray<FailingSignal> = [],
): FitnessReport {
  return {
    tabRecipeId: 'r',
    tabRecipeVersion: 1,
    score: 0.4,
    decision,
    failingSignals: signals,
    passingSignals: [],
    metrics: emptyMetrics(),
  };
}

describe('decideImprove', () => {
  it('noop when not an improve candidate', async () => {
    const out = await decideImprove({
      tenantId: 't1',
      shortReport: report('neutral'),
      pendingProbe: { async hasPendingProposalFor() { return false; } },
      lockProbe: { async isLocked() { return false; } },
    });
    expect(out.action).toBe('noop');
  });

  it('noop when recipe is locked', async () => {
    const out = await decideImprove({
      tenantId: 't1',
      shortReport: report('improve_candidate', failing()),
      pendingProbe: { async hasPendingProposalFor() { return false; } },
      lockProbe: { async isLocked() { return true; } },
    });
    expect(out.action).toBe('noop');
    expect(out.reason).toMatch(/locked/);
  });

  it('noop when a pending proposal already exists', async () => {
    const out = await decideImprove({
      tenantId: 't1',
      shortReport: report('improve_candidate', failing()),
      pendingProbe: { async hasPendingProposalFor() { return true; } },
      lockProbe: { async isLocked() { return false; } },
    });
    expect(out.action).toBe('noop');
    expect(out.reason).toMatch(/pending/);
  });

  it('proposes improvement when all guards clear', async () => {
    const out = await decideImprove({
      tenantId: 't1',
      shortReport: report('improve_candidate', failing()),
      pendingProbe: { async hasPendingProposalFor() { return false; } },
      lockProbe: { async isLocked() { return false; } },
    });
    expect(out.action).toBe('propose_improvement');
    expect(out.failingSignals.length).toBeGreaterThan(0);
  });
});
