import { describe, expect, it, vi } from 'vitest';
import {
  runCognitiveLoop,
  type ComposeAnythingDispatcherPort,
} from '../runtime/cognitive-loop.js';
import type { CognitiveTurnInput, ClockPort } from '../types.js';

function baseTurn(overrides: Partial<CognitiveTurnInput> = {}): CognitiveTurnInput {
  return {
    turn_id: 't_1',
    tenant_id: 'tenant_1',
    user_id: 'user_1',
    session_id: 'session_1',
    utterance: 'Generate a board pack report',
    is_new_user: false,
    active_authority_tier_max: 1,
    ...overrides,
  };
}

const fixedClock: ClockPort = {
  now: () => new Date('2026-05-26T12:00:00Z'),
};

describe('runCognitiveLoop end-to-end', () => {
  it('routes new user + broad intent to asked_for_clarification', async () => {
    const dispatcher: ComposeAnythingDispatcherPort = {
      dispatch: vi.fn(),
    };
    const out = await runCognitiveLoop(
      {
        turn: baseTurn({ utterance: 'help', is_new_user: true }),
        candidate_evidence: [],
        required_evidence_kinds: [],
        owner_override_just_do_it: false,
        questions_asked_this_turn: 0,
      },
      { dispatcher, clock: fixedClock },
    );
    expect(out.path).toBe('asked_for_clarification');
    expect(out.confidence).toBe('low');
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(out.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('routes missing critical data to asked_for_data', async () => {
    const dispatcher: ComposeAnythingDispatcherPort = { dispatch: vi.fn() };
    const out = await runCognitiveLoop(
      {
        turn: baseTurn({ utterance: 'Generate a report' }),
        candidate_evidence: [],
        required_evidence_kinds: ['data_join', 'ingest'],
        owner_override_just_do_it: false,
        questions_asked_this_turn: 0,
      },
      { dispatcher, clock: fixedClock },
    );
    expect(out.path).toBe('asked_for_data');
    expect(out.requested_data?.length).toBeGreaterThan(0);
  });

  it('dispatches + validates + calibrates when sufficient', async () => {
    const dispatcher: ComposeAnythingDispatcherPort = {
      dispatch: vi.fn(async () => ({
        artifact_ref: { kind: 'doc' as const, id: 'doc_1' },
        text: 'The royalty is 7% [cit_a]. I recommend reviewing the policy.',
        citations: [
          {
            citationId: 'cit_a',
            source: 'tumemadini',
            title: 'Mining Act §12',
          },
        ],
        cost_usd_cents: 25,
        source_quality_mean: 0.9,
        agreement_rate: 0.9,
        corpus_consistency: 0.9,
        days_since_evidence: 10,
      })),
    };
    const out = await runCognitiveLoop(
      {
        turn: baseTurn({ utterance: 'Make a compliance report' }),
        candidate_evidence: [
          { kind: 'corpus', ref_id: 'c1', relevance: 0.9, quality: 0.85 },
          { kind: 'data_join', ref_id: 'd1', relevance: 0.85, quality: 0.8 },
        ],
        required_evidence_kinds: ['corpus', 'data_join'],
        owner_override_just_do_it: false,
        questions_asked_this_turn: 0,
      },
      { dispatcher, clock: fixedClock },
    );
    expect(out.path).toBe('composed_output');
    expect(out.confidence === 'high' || out.confidence === 'medium').toBe(true);
    expect(out.artifact_ref?.kind).toBe('doc');
    expect(out.citations.length).toBe(1);
  });

  it('refuses when the candidate output has uncited claims past the reject threshold', async () => {
    const dispatcher: ComposeAnythingDispatcherPort = {
      dispatch: vi.fn(async () => ({
        artifact_ref: { kind: 'doc' as const, id: 'doc_bad' },
        text:
          'Royalties hit 7%. Production was 12,000 oz. Profit was USD 4.5m in Q1 2025.',
        citations: [],
        cost_usd_cents: 15,
        source_quality_mean: 0.6,
        agreement_rate: 0.6,
        corpus_consistency: 0.6,
        days_since_evidence: 20,
      })),
    };
    const out = await runCognitiveLoop(
      {
        turn: baseTurn({ utterance: 'Make me a report' }),
        candidate_evidence: [
          { kind: 'corpus', ref_id: 'c1', relevance: 0.8, quality: 0.7 },
        ],
        required_evidence_kinds: ['corpus'],
        owner_override_just_do_it: false,
        questions_asked_this_turn: 0,
      },
      { dispatcher, clock: fixedClock },
    );
    expect(out.path).toBe('refused_low_confidence');
    expect(out.confidence).toBe('refused');
  });
});
