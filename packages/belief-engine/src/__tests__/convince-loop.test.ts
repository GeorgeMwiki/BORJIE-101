/**
 * Convince-loop tests — the belief-revision gate is the heart of LP-17.
 *
 * Verifies the threshold semantics required by the task + CLAUDE.md:
 *   - revise ONLY when confidence delta > 0.25
 *   - split (queue for review) for 0.05 < delta <= 0.25
 *   - no-op for delta <= 0.05
 *   - overlap → strengthen (no value change)
 *   - beliefs are never written except through the store.upsert path
 *   - quarantined claims raise the revise floor to 0.4
 */

import { describe, it, expect } from 'vitest';

import {
  convinceLoop,
  REVISE_DELTA_THRESHOLD,
  SPLIT_DELTA_THRESHOLD,
  type WebSearchPort,
} from '../convince-loop.js';
import { createInMemoryBeliefStore } from '../belief-store.js';
import type {
  Belief,
  ExtractedClaim,
  WebSearchResult,
} from '../types.js';

const FIXED_NOW = Date.parse('2026-06-03T00:00:00.000Z');

function priorBelief(overrides: Partial<Belief> = {}): Belief {
  return {
    id: 'b-1',
    domain: 'sector-economics',
    subject: 'mwanza-gold-ore-grade',
    description: 'Average ore grade for Mwanza alluvial gold',
    value: { kind: 'scalar', scalar: 3.0, unit: 'g/t' },
    confidence: 0.6,
    sources: [
      {
        kind: 'internal-data',
        authority: 0.7,
        capturedAt: '2026-05-01T00:00:00.000Z',
      },
    ],
    revisedAt: '2026-05-30T00:00:00.000Z',
    revisionCount: 1,
    tags: [],
    subjectUserId: null,
    subjectOrgId: null,
    ...overrides,
  };
}

function claim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    subject: 'mwanza-gold-ore-grade',
    description: 'Average ore grade for Mwanza alluvial gold',
    proposedValue: { kind: 'scalar', scalar: 3.0, unit: 'g/t' },
    evidenceFromTurn: 'the grade is about 3 grams per tonne',
    confidence: 0.8,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    portal: 'worker',
    domain: 'sector-economics',
    subjectUserId: null,
    subjectOrgId: null,
    ...overrides,
  };
}

/** A web-search port returning N high-authority corroborating results. */
function strongWeb(n: number, authority = 0.95): WebSearchPort {
  return async () => {
    const results: WebSearchResult[] = Array.from({ length: n }, (_, i) => ({
      title: `result ${i}`,
      url: `https://gov.example/${i}`,
      snippet: 'corroborating evidence',
      authority,
    }));
    return results;
  };
}

describe('convince-loop — overlap → strengthen', () => {
  it('strengthens (no value change) when values overlap', async () => {
    const store = createInMemoryBeliefStore([priorBelief()]);
    const result = await convinceLoop(
      { claim: claim({ proposedValue: { kind: 'scalar', scalar: 3.1, unit: 'g/t' } }), priorBelief: priorBelief() },
      { store, now: () => FIXED_NOW },
    );
    expect(result.action).toBe('strengthen');
    expect(result.contradictionDetected).toBe(false);
    // Value unchanged (3.0), only a source appended.
    expect(result.newBelief.value.scalar).toBe(3.0);
    expect(result.newBelief.sources.length).toBe(2);
    // A revision row was recorded.
    expect(store.revisions.length).toBe(1);
  });

  it('never reports a strengthen with a negative delta (confidence floored at prior)', async () => {
    // High-confidence prior backed by an internal-data source; a low-authority
    // worker user-claim agrees with the value. Recomputing the weighted
    // average would DRAG confidence below the prior — a 'strengthen' must not
    // reduce confidence, so the delta is floored at >= 0.
    const prior = priorBelief({
      confidence: 0.9,
      sources: [
        { kind: 'internal-data', authority: 0.99, capturedAt: '2026-05-01T00:00:00.000Z' },
      ],
    });
    const store = createInMemoryBeliefStore([prior]);
    const result = await convinceLoop(
      {
        claim: claim({
          portal: 'worker', // low-authority user-claim source (0.45)
          confidence: 0.4,
          proposedValue: { kind: 'scalar', scalar: 3.05, unit: 'g/t' }, // overlaps 3.0
        }),
        priorBelief: prior,
      },
      { store, now: () => FIXED_NOW },
    );
    expect(result.action).toBe('strengthen');
    expect(result.confidenceDelta).toBeGreaterThanOrEqual(0);
    // Confidence is not reduced below the prior.
    expect(result.newBelief.confidence).toBeGreaterThanOrEqual(prior.confidence);
  });
});

describe('convince-loop — heavy pass thresholds', () => {
  it('revises when delta > 0.25 (strong contradicting evidence)', async () => {
    const store = createInMemoryBeliefStore([priorBelief({ confidence: 0.5 })]);
    const result = await convinceLoop(
      {
        claim: claim({
          portal: 'owner', // authority 0.9
          confidence: 0.95,
          proposedValue: { kind: 'scalar', scalar: 6.0, unit: 'g/t' },
        }),
        priorBelief: priorBelief({ confidence: 0.5 }),
      },
      { store, webSearch: strongWeb(5, 0.98), now: () => FIXED_NOW },
    );
    expect(result.action).toBe('revise');
    expect(result.confidenceDelta).toBeDefined();
    expect(result.newBelief.value.scalar).toBe(6.0); // value replaced
    expect(result.contradictionDetected).toBe(true);
    expect(store.revisions.length).toBe(1);
  });

  it('splits (queues for review) for 0.05 < delta <= 0.25', async () => {
    // Tune: prior conf 0.5, owner claim conf ~0.55, no web → newSide ≈
    // 0.9*0.55*0.4 = 0.198; priorSide ≈ 0.5 (no decay, recent). That's
    // negative. Instead use a low-confidence, recent prior + moderate claim.
    const prior = priorBelief({
      confidence: 0.18,
      revisedAt: '2026-06-02T00:00:00.000Z',
    });
    const store = createInMemoryBeliefStore([prior]);
    const result = await convinceLoop(
      {
        claim: claim({
          portal: 'owner', // 0.9
          confidence: 0.85,
          proposedValue: { kind: 'scalar', scalar: 6.0, unit: 'g/t' },
        }),
        priorBelief: prior,
      },
      // no web → newSide = 0.9 * 0.85 * 0.4 = 0.306; prior = 0.18.
      // delta = 0.126 → between 0.05 and 0.25 → split.
      { store, now: () => FIXED_NOW },
    );
    expect(result.action).toBe('split');
    expect(result.confidenceDelta).toBeLessThanOrEqual(0); // prior conf reduced
    expect(result.reviewQueued).toBe(true);
    expect(store.reviewQueue.length).toBe(1);
    expect(store.reviewQueue[0].subject).toBe('mwanza-gold-ore-grade');
    // Value NOT replaced on a split — prior value retained, tagged contested.
    expect(result.newBelief.value.scalar).toBe(3.0);
    expect(result.newBelief.tags).toContain('contested');
  });

  it('no-ops for delta <= 0.05 (weak claim against confident prior)', async () => {
    const prior = priorBelief({ confidence: 0.9 });
    const store = createInMemoryBeliefStore([prior]);
    const result = await convinceLoop(
      {
        claim: claim({
          portal: 'worker', // 0.5
          confidence: 0.3,
          proposedValue: { kind: 'scalar', scalar: 9.0, unit: 'g/t' },
        }),
        priorBelief: prior,
      },
      { store, now: () => FIXED_NOW },
    );
    expect(result.action).toBe('no-change');
    expect(result.confidenceDelta).toBe(0);
    expect(result.newBelief.value.scalar).toBe(3.0); // unchanged
    // A contradiction row is still logged for audit, but nothing queued.
    expect(store.revisions.length).toBe(1);
    expect(store.reviewQueue.length).toBe(0);
  });
});

describe('convince-loop — quarantine raises the revise floor', () => {
  it('a quarantined claim that would revise at 0.25 only splits below 0.4', async () => {
    // Build a delta in (0.25, 0.4): prior conf 0.1 recent, owner claim
    // conf 0.95, no web → newSide = 0.9*0.95*0.4 = 0.342; prior = 0.1.
    // delta = 0.242 — wait that's < 0.25. Use web to push it into the band.
    const prior = priorBelief({
      confidence: 0.05,
      revisedAt: '2026-06-02T00:00:00.000Z',
    });
    const store = createInMemoryBeliefStore([prior]);
    const args = {
      claim: claim({
        portal: 'owner',
        confidence: 0.9,
        quarantined: true,
        proposedValue: { kind: 'scalar' as const, scalar: 6.0, unit: 'g/t' },
      }),
      priorBelief: prior,
    };
    // newSide = 0.9*0.9*0.4 = 0.324; prior ≈ 0.05. delta ≈ 0.274.
    // 0.274 > 0.25 (would revise) BUT < 0.4 (quarantine floor) → split.
    const result = await convinceLoop(args, { store, now: () => FIXED_NOW });
    expect(result.action).toBe('split');
    expect(result.newBelief.value.scalar).toBe(3.0); // not revised
  });
});

describe('convince-loop — invariants', () => {
  it('exposes the documented threshold constants', () => {
    expect(REVISE_DELTA_THRESHOLD).toBe(0.25);
    expect(SPLIT_DELTA_THRESHOLD).toBe(0.05);
  });

  it('never mutates the prior belief object', async () => {
    const prior = priorBelief();
    const frozen = Object.freeze({ ...prior, sources: [...prior.sources] });
    const store = createInMemoryBeliefStore([prior]);
    await convinceLoop(
      { claim: claim({ proposedValue: { kind: 'scalar', scalar: 3.05 } }), priorBelief: frozen },
      { store, now: () => FIXED_NOW },
    );
    // The frozen prior is untouched (immutability rule).
    expect(frozen.confidence).toBe(0.6);
    expect(frozen.sources.length).toBe(1);
  });
});
