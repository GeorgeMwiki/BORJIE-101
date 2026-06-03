/**
 * reviseBelief tests — the guarded entry point. Verifies the "create when no
 * prior" path + the "dispatch to convince-loop when a prior exists" path, and
 * that beliefs are only ever written via the store (never directly).
 */

import { describe, it, expect } from 'vitest';

import { reviseBelief } from '../revise-belief.js';
import { createInMemoryBeliefStore } from '../belief-store.js';
import type { ExtractedClaim } from '../types.js';

const FIXED_NOW = Date.parse('2026-06-03T00:00:00.000Z');

function claim(overrides: Partial<ExtractedClaim> = {}): ExtractedClaim {
  return {
    subject: 'geita-royalty-rate',
    description: 'Statutory royalty rate for gold in Geita',
    proposedValue: { kind: 'scalar', scalar: 0.06 },
    evidenceFromTurn: 'royalty is 6 percent',
    confidence: 0.7,
    conversationId: 'c-1',
    turnId: 't-1',
    portal: 'manager',
    domain: 'regulatory',
    subjectUserId: null,
    subjectOrgId: null,
    ...overrides,
  };
}

describe('reviseBelief', () => {
  it('creates a new belief when none exists', async () => {
    const store = createInMemoryBeliefStore();
    const result = await reviseBelief(claim(), {
      store,
      now: () => FIXED_NOW,
      idFactory: () => 'new-belief-1',
    });
    expect(result.priorBelief).toBeNull();
    expect(result.newBelief.id).toBe('new-belief-1');
    expect(result.newBelief.value.scalar).toBe(0.06);
    expect(result.action).toBe('strengthen');
    // The create is logged as an initial revision.
    expect(store.revisions.length).toBe(1);
    // Confidence is capped by the claim's own confidence.
    expect(result.newBelief.confidence).toBeLessThanOrEqual(0.7);
  });

  it('dispatches to the convince-loop when a prior exists', async () => {
    const store = createInMemoryBeliefStore();
    // Seed via reviseBelief (create path).
    await reviseBelief(claim(), {
      store,
      now: () => FIXED_NOW,
      idFactory: () => 'b-1',
    });
    // Same subject + overlapping value → strengthen.
    const result = await reviseBelief(
      claim({ proposedValue: { kind: 'scalar', scalar: 0.061 } }),
      { store, now: () => FIXED_NOW, idFactory: () => 'should-not-be-used' },
    );
    expect(result.priorBelief).not.toBeNull();
    expect(result.action).toBe('strengthen');
    expect(result.newBelief.id).toBe('b-1'); // same belief, not a new one
  });

  it('scopes the lookup by (subjectUserId, subjectOrgId)', async () => {
    const store = createInMemoryBeliefStore();
    await reviseBelief(claim({ subjectUserId: 'owner-A' }), {
      store,
      now: () => FIXED_NOW,
      idFactory: () => 'belief-A',
    });
    // A different owner with the same subject must NOT collide — it creates
    // its own scoped belief.
    const result = await reviseBelief(claim({ subjectUserId: 'owner-B' }), {
      store,
      now: () => FIXED_NOW,
      idFactory: () => 'belief-B',
    });
    expect(result.priorBelief).toBeNull();
    expect(result.newBelief.id).toBe('belief-B');
    expect(store.snapshot().length).toBe(2);
  });
});
