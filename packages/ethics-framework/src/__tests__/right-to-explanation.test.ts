import { beforeEach, describe, expect, it } from 'vitest';
import { createRightToExplanationService } from '../right-to-explanation/index.js';
import { createInMemoryStore } from '../in-memory-store.js';
import type { RightToExplanationService } from '../right-to-explanation/index.js';
import type { EthicsStore } from '../types.js';

describe('RightToExplanationService — GDPR Art 22 + EU AI Act', () => {
  let store: EthicsStore;
  let svc: RightToExplanationService;

  beforeEach(() => {
    store = createInMemoryStore();
    svc = createRightToExplanationService({ store });
  });

  it('records automated decision with all required metadata', async () => {
    const r = await svc.recordAutomatedDecision({
      decisionId: 'd-1',
      subjectId: 'tenant-1',
      decision: 'deny-application',
      model: 'rental-scoring/1.0',
      inputs: { income: 1000, credit_score: 580, eviction_history: 'true' },
      outputs: { decision: 'deny', score: 0.32 },
      confidence: 0.84,
      alternatives: [
        { decision: 'approve', confidence: 0.12 },
        { decision: 'manual-review', confidence: 0.04 },
      ],
      jurisdiction: 'EU',
    });
    expect(r.decisionId).toBe('d-1');
    expect(r.alternatives.length).toBe(2);
    expect(r.decidedAt).toMatch(/T/);
  });

  it('rejects confidence outside [0,1]', async () => {
    await expect(
      svc.recordAutomatedDecision({
        decisionId: 'd-2',
        subjectId: 'tenant-2',
        decision: 'deny',
        model: 'x',
        inputs: {},
        outputs: {},
        confidence: 1.2,
        alternatives: [],
        jurisdiction: 'EU',
      }),
    ).rejects.toThrow('confidence');
  });

  it('requestExplanation returns summary + top factors + counterfactual', async () => {
    await svc.recordAutomatedDecision({
      decisionId: 'd-3',
      subjectId: 'tenant-3',
      decision: 'deny-application',
      model: 'rental-scoring/1.0',
      inputs: { income: 1000, credit_score: 580 },
      outputs: { decision: 'deny' },
      confidence: 0.84,
      alternatives: [{ decision: 'approve', confidence: 0.12 }],
      jurisdiction: 'EU',
    });
    const exp = await svc.requestExplanation({
      subjectId: 'tenant-3',
      decisionId: 'd-3',
    });
    expect(exp.summary).toContain('rental-scoring/1.0');
    expect(exp.topFactors.length).toBeGreaterThan(0);
    expect(exp.counterfactual.wouldYield).toBe('approve');
    expect(typeof exp.counterfactual.description).toBe('string');
  });

  it('counterfactual changes the highest-weight numeric feature', async () => {
    await svc.recordAutomatedDecision({
      decisionId: 'd-4',
      subjectId: 'tenant-4',
      decision: 'deny',
      model: 'm',
      inputs: { credit_score: 580, income: 1000 },
      outputs: {},
      confidence: 0.7,
      alternatives: [{ decision: 'approve', confidence: 0.2 }],
      jurisdiction: 'EU',
    });
    const exp = await svc.requestExplanation({
      subjectId: 'tenant-4',
      decisionId: 'd-4',
    });
    expect(Object.keys(exp.counterfactual.changes)).toContain('income');
  });

  it('rejects explanation request from non-owner subject', async () => {
    await svc.recordAutomatedDecision({
      decisionId: 'd-5',
      subjectId: 'tenant-5',
      decision: 'deny',
      model: 'm',
      inputs: {},
      outputs: {},
      confidence: 0.5,
      alternatives: [],
      jurisdiction: 'EU',
    });
    await expect(
      svc.requestExplanation({ subjectId: 'someone-else', decisionId: 'd-5' }),
    ).rejects.toThrow('subject does not match');
  });

  it('throws if decision not found', async () => {
    await expect(
      svc.requestExplanation({ subjectId: 'x', decisionId: 'missing' }),
    ).rejects.toThrow("'missing' not found");
  });

  it('optOutOfAutomation flips isOptedOut to true', async () => {
    expect(
      await svc.isOptedOut({ subjectId: 'tenant-6', scope: 'automated-decision-making' }),
    ).toBe(false);
    await svc.optOutOfAutomation({
      subjectId: 'tenant-6',
      scope: 'automated-decision-making',
    });
    expect(
      await svc.isOptedOut({ subjectId: 'tenant-6', scope: 'automated-decision-making' }),
    ).toBe(true);
  });

  it('explanation references included humanContact', async () => {
    await svc.recordAutomatedDecision({
      decisionId: 'd-7',
      subjectId: 'tenant-7',
      decision: 'deny',
      model: 'm',
      inputs: { x: 1 },
      outputs: {},
      confidence: 0.6,
      alternatives: [{ decision: 'approve', confidence: 0.4 }],
      jurisdiction: 'EU',
    });
    const exp = await svc.requestExplanation({
      subjectId: 'tenant-7',
      decisionId: 'd-7',
    });
    expect(exp.humanContact).toContain('@');
  });
});
