import { describe, expect, it } from 'vitest';
import { deliberateReason } from '../reasoning/deliberate-reasoner.js';

describe('deliberateReason', () => {
  it('emits a plan with classify_intent + gather_evidence steps even on no evidence', async () => {
    const trace = await deliberateReason({
      utterance: 'Make me a report',
      candidate_evidence: [],
      required_evidence_kinds: ['corpus'],
      is_new_user: true,
      owner_override_just_do_it: false,
    });

    expect(trace.plan_steps.length).toBeGreaterThanOrEqual(2);
    expect(trace.plan_steps[0]?.action).toBe('classify_intent');
    expect(trace.plan_steps[1]?.action).toBe('gather_evidence');
  });

  it('routes new user + broad intent to needs_clarification', async () => {
    const trace = await deliberateReason({
      utterance: 'Make me a report',
      candidate_evidence: [],
      required_evidence_kinds: [],
      is_new_user: true,
      owner_override_just_do_it: false,
    });
    expect(trace.sufficiency).toBe('needs_clarification');
  });

  it('routes sufficient evidence to sufficient + adds invoke + validate + calibrate steps', async () => {
    const trace = await deliberateReason({
      utterance: 'Generate a board pack report',
      candidate_evidence: [
        { kind: 'corpus', ref_id: 'c1', relevance: 0.9, quality: 0.85 },
        { kind: 'data_join', ref_id: 'd1', relevance: 0.8, quality: 0.8 },
      ],
      required_evidence_kinds: ['corpus', 'data_join'],
      is_new_user: false,
      owner_override_just_do_it: false,
    });
    expect(trace.sufficiency).toBe('sufficient');
    const actions = trace.plan_steps.map((s) => s.action);
    expect(actions).toContain('invoke_capability');
    expect(actions).toContain('validate_output');
    expect(actions).toContain('calibrate_confidence');
  });

  it('cost estimate is non-negative + matches sum of step costs', async () => {
    const trace = await deliberateReason({
      utterance: 'Make a chart from this excel',
      candidate_evidence: [
        { kind: 'ingest', ref_id: 'i1', relevance: 0.9, quality: 0.8 },
      ],
      required_evidence_kinds: ['ingest'],
      is_new_user: false,
      owner_override_just_do_it: false,
    });
    const sum = trace.plan_steps.reduce(
      (acc, s) => acc + s.expected_cost_cents,
      0,
    );
    expect(trace.cost_estimate_usd_cents).toBe(sum);
    expect(sum).toBeGreaterThan(0);
  });

  it('owner-override bypasses scoping', async () => {
    const trace = await deliberateReason({
      utterance: 'Make me a report',
      candidate_evidence: [],
      required_evidence_kinds: [],
      is_new_user: true,
      owner_override_just_do_it: true,
    });
    expect(trace.sufficiency).toBe('sufficient');
  });
});
