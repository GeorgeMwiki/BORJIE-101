/**
 * decideAutonomy — unit coverage for the continuous autonomy controller.
 *
 * The controller fuses four axes (consequence × reversibility,
 * calibrated confidence, mandate ceiling, situation flags) into one of
 * three escalating decisions. These tests pin:
 *
 *   (a) the consequence × reversibility surface,
 *   (b) the per-tier calibrated-confidence floors,
 *   (c) the mandate ceiling can only escalate,
 *   (d) every situation flag escalates monotonically,
 *   (e) `severe` (money/licence/deletion) can NEVER reach auto,
 *   (f) reasons are always populated + gatedBy attribution,
 *   (g) the result is immutable + inputs are never mutated,
 *   (h) the `moreCautious` ordering primitive.
 */

import { describe, it, expect } from 'vitest';
import {
  decideAutonomy,
  moreCautious,
  isAtLeastAsCautious,
  DEFAULT_AUTO_CONFIDENCE_FLOORS,
} from '../decide-autonomy.js';
import type {
  ConsequenceTier,
  DelegationMandate,
  Reversibility,
} from '../types.js';

// A maximally-permissive baseline: operator mandate + perfect calibrated
// confidence + reversible + no situation flags. Used so individual axes
// can be varied in isolation.
const baseInput = {
  calibratedConfidence: 1,
  consequenceTier: 'trivial' as ConsequenceTier,
  reversibility: 'reversible' as Reversibility,
  mandate: 'operator' as DelegationMandate,
} as const;

describe('decideAutonomy — consequence × reversibility surface (a)', () => {
  it('auto for a trivial reversible action at full confidence', () => {
    const out = decideAutonomy(baseInput);
    expect(out.decision).toBe('auto');
    expect(out.gatedBy).toBeNull();
  });

  it('gates a low-consequence irreversible action despite full confidence', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'low',
      reversibility: 'irreversible',
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('consequence');
  });

  it('high-consequence irreversible → four_eyes even at full confidence', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'high',
      reversibility: 'irreversible',
    });
    expect(out.decision).toBe('four_eyes');
    expect(out.gatedBy).toBe('consequence');
  });

  it('frees the reversible body of a high-consequence flow (2-D, not flat)', () => {
    // high + reversible runs auto; only the irreversible corner gates.
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'high',
      reversibility: 'reversible',
    });
    expect(out.decision).toBe('auto');
  });

  it('write-staging keeps a moderate action auto (staged is reversible)', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'moderate',
      reversibility: 'staged',
    });
    expect(out.decision).toBe('auto');
  });
});

describe('decideAutonomy — calibrated-confidence floors (b)', () => {
  it('below the moderate floor → gate, attributed to confidence', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'moderate',
      reversibility: 'reversible',
      calibratedConfidence: DEFAULT_AUTO_CONFIDENCE_FLOORS.moderate - 0.01,
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('confidence');
  });

  it('exactly at the floor is auto-eligible (inclusive)', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'high',
      reversibility: 'reversible',
      calibratedConfidence: DEFAULT_AUTO_CONFIDENCE_FLOORS.high,
    });
    expect(out.decision).toBe('auto');
  });

  it('honours an operator-tuned floor override', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'low',
      reversibility: 'reversible',
      calibratedConfidence: 0.6,
      autoConfidenceFloors: { low: 0.9 },
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('confidence');
  });

  it('non-finite / out-of-range confidence fails cautious (treated as 0)', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'low',
      reversibility: 'reversible',
      calibratedConfidence: Number.NaN,
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('confidence');
  });
});

describe('decideAutonomy — mandate ceiling can only escalate (c)', () => {
  const ceilings: ReadonlyArray<[DelegationMandate, string]> = [
    ['observer', 'four_eyes'],
    ['approver', 'gate'],
    ['consultant', 'gate'],
    ['collaborator', 'auto'],
    ['operator', 'auto'],
  ];

  for (const [mandate, ceiling] of ceilings) {
    it(`mandate '${mandate}' caps an otherwise-auto action at '${ceiling}'`, () => {
      const out = decideAutonomy({ ...baseInput, mandate });
      expect(out.decision).toBe(ceiling);
      if (ceiling !== 'auto') {
        expect(out.gatedBy).toBe('mandate');
      } else {
        expect(out.gatedBy).toBeNull();
      }
    });
  }

  it('mandate never RELAXES a consequence-forced gate', () => {
    // operator mandate (auto ceiling) cannot downgrade a consequence gate.
    const out = decideAutonomy({
      ...baseInput,
      mandate: 'operator',
      consequenceTier: 'low',
      reversibility: 'irreversible',
    });
    expect(out.decision).toBe('gate');
  });
});

describe('decideAutonomy — situation flags escalate monotonically (d)', () => {
  it('a single gate-class flag escalates auto → gate', () => {
    const out = decideAutonomy({
      ...baseInput,
      situationFlags: { novelCounterparty: true },
    });
    expect(out.decision).toBe('gate');
    expect(out.gatedBy).toBe('situation');
  });

  it('a four_eyes-class flag escalates auto → four_eyes', () => {
    const out = decideAutonomy({
      ...baseInput,
      situationFlags: { defectionProbeHit: true },
    });
    expect(out.decision).toBe('four_eyes');
    expect(out.gatedBy).toBe('situation');
  });

  it('drift toward sovereign forces four_eyes', () => {
    const out = decideAutonomy({
      ...baseInput,
      situationFlags: { driftTowardSovereign: true },
    });
    expect(out.decision).toBe('four_eyes');
  });

  it('fuses multiple flags to the most cautious', () => {
    const out = decideAutonomy({
      ...baseInput,
      situationFlags: {
        offHours: true,
        novelCounterparty: true,
        irreversibilityBudgetExhausted: true,
      },
    });
    expect(out.decision).toBe('four_eyes');
  });

  it('an empty flags object does not escalate', () => {
    const out = decideAutonomy({ ...baseInput, situationFlags: {} });
    expect(out.decision).toBe('auto');
  });

  it('situations never RELAX a higher consequence/mandate decision', () => {
    // four_eyes consequence + a mere gate-class flag stays four_eyes.
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'high',
      reversibility: 'irreversible',
      situationFlags: { offHours: true },
    });
    expect(out.decision).toBe('four_eyes');
  });
});

describe('decideAutonomy — severe class is never auto (e)', () => {
  const reversibilities: ReadonlyArray<Reversibility> = [
    'reversible',
    'staged',
    'costly',
    'irreversible',
  ];

  for (const rev of reversibilities) {
    it(`severe + ${rev} + full confidence + operator → four_eyes`, () => {
      const out = decideAutonomy({
        ...baseInput,
        consequenceTier: 'severe',
        reversibility: rev,
        calibratedConfidence: 1,
        mandate: 'operator',
      });
      expect(out.decision).toBe('four_eyes');
    });
  }

  it('severe confidence floor is +Infinity → never auto-eligible on confidence', () => {
    expect(DEFAULT_AUTO_CONFIDENCE_FLOORS.severe).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('decideAutonomy — reasons + immutability (f,g)', () => {
  it('always returns a non-empty, frozen reasons array', () => {
    const out = decideAutonomy(baseInput);
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.reasons)).toBe(true);
  });

  it('reasons mention the consequence surface and the final decision', () => {
    const out = decideAutonomy({
      ...baseInput,
      consequenceTier: 'moderate',
      reversibility: 'costly',
    });
    const joined = out.reasons.join('\n');
    expect(joined).toContain('consequence:');
    expect(joined).toContain('decision:');
  });

  it('does not mutate the input', () => {
    const input = {
      ...baseInput,
      situationFlags: { novelCounterparty: true },
    };
    const snapshot = JSON.stringify(input);
    decideAutonomy(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('moreCautious / isAtLeastAsCautious ordering (h)', () => {
  it('orders auto < gate < four_eyes', () => {
    expect(moreCautious('auto', 'gate')).toBe('gate');
    expect(moreCautious('gate', 'four_eyes')).toBe('four_eyes');
    expect(moreCautious('auto', 'four_eyes')).toBe('four_eyes');
    expect(moreCautious('auto', 'auto')).toBe('auto');
  });

  it('isAtLeastAsCautious is inclusive', () => {
    expect(isAtLeastAsCautious('gate', 'gate')).toBe(true);
    expect(isAtLeastAsCautious('four_eyes', 'gate')).toBe(true);
    expect(isAtLeastAsCautious('auto', 'gate')).toBe(false);
  });
});
