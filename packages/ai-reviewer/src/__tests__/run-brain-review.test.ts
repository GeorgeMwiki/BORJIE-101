import { describe, it, expect } from 'vitest';
import { runBrainReview, REVIEWER_SYSTEM_PROMPT } from '../brain/index.js';
import { parcelEditPolicy } from '../policies/parcel-edit-policy.js';
import { makeReq } from './fixtures.js';
import {
  fakeBrain,
  fakeBrainReturningRaw,
  fakeBrainThrowing,
} from './test-doubles.js';

describe('runBrainReview', () => {
  it('returns an approve verdict the brain emitted', async () => {
    const brain = fakeBrain({
      verdict: 'approve',
      confidence: 0.91,
      reasons: [],
      suggestedFixes: [],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('approve');
    expect(decision.confidence).toBeCloseTo(0.91);
    expect(decision.correlationId).toBe('corr_test');
    expect(brain.calls[0]?.systemPrompt).toBe(REVIEWER_SYSTEM_PROMPT);
    expect(brain.calls[0]?.question).toContain('tenant_test');
  });

  it('returns a reject_with_changes verdict with reasons + fixes', async () => {
    const brain = fakeBrain({
      verdict: 'reject_with_changes',
      confidence: 0.7,
      reasons: [
        {
          code: 'parcel.name.confusing',
          message: 'Proposed name overlaps with sibling parcel.',
          severity: 'error',
          field: 'newName',
        },
      ],
      suggestedFixes: [{ description: 'Append a suffix to disambiguate.' }],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('reject_with_changes');
    expect(decision.reasons[0]?.code).toBe('parcel.name.confusing');
    expect(decision.suggestedFixes[0]?.description).toContain('suffix');
  });

  it('returns reject_final verdict', async () => {
    const brain = fakeBrain({
      verdict: 'reject_final',
      confidence: 0.99,
      reasons: [
        { code: 'parcel.locked', message: 'Parcel is under legal hold.', severity: 'critical' },
      ],
      suggestedFixes: [],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('reject_final');
  });

  it('returns escalate verdict', async () => {
    const brain = fakeBrain({
      verdict: 'escalate',
      confidence: 0.3,
      reasons: [],
      suggestedFixes: [],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('escalate');
  });

  it('degrades to escalate when brain throws', async () => {
    const brain = fakeBrainThrowing(new Error('upstream timeout'));
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('escalate');
    expect(decision.reasons[0]?.code).toBe('brain.invocation_failed');
    expect(decision.reasons[0]?.message).toContain('upstream timeout');
  });

  it('degrades to escalate when brain output fails schema validation', async () => {
    const brain = fakeBrainReturningRaw({
      verdict: 'NOT_A_REAL_VERDICT',
      confidence: 0.9,
      reasons: [],
      suggestedFixes: [],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('escalate');
    expect(decision.reasons[0]?.code).toBe('brain.structured_output_invalid');
  });

  it('degrades to escalate when brain returns confidence > 1', async () => {
    const brain = fakeBrainReturningRaw({
      verdict: 'approve',
      confidence: 2.5,
      reasons: [],
      suggestedFixes: [],
    });
    const decision = await runBrainReview({
      request: makeReq('parcel_edit', { parcelId: 'p1' }),
      policy: parcelEditPolicy,
      brain,
    });
    expect(decision.verdict).toBe('escalate');
  });
});
