/**
 * Persona-drift alert tests.
 */

import { describe, it, expect } from 'vitest';
import {
  assessPersonaDrift,
  emitPersonaDriftIfBreached,
  DEFAULT_PER_DIM_THRESHOLD,
  DEFAULT_AGGREGATE_THRESHOLD,
} from '../alert.js';
import { BORJIE_REFERENCE_PERSONA } from '../vectors.js';
import type { PersonaDriftEvent, PersonaDriftSink } from '../../kernel-types.js';

function createSpySink(): PersonaDriftSink & { events: PersonaDriftEvent[] } {
  const events: PersonaDriftEvent[] = [];
  return {
    events,
    async record(event) {
      events.push(event);
    },
  };
}

describe('thresholds', () => {
  it('aggregate threshold is half the per-dim threshold', () => {
    expect(DEFAULT_AGGREGATE_THRESHOLD).toBe(DEFAULT_PER_DIM_THRESHOLD / 2);
  });
});

describe('assessPersonaDrift', () => {
  it('reports no breach when sample matches reference', () => {
    const verdict = assessPersonaDrift({ sample: BORJIE_REFERENCE_PERSONA });
    expect(verdict.breached).toBe(false);
    expect(verdict.aggregateDrift).toBe(0);
    expect(verdict.worstDimDrift).toBe(0);
    expect(verdict.reasons).toEqual([]);
  });

  it('reports breach when a single dim drifts past threshold', () => {
    const sample = { ...BORJIE_REFERENCE_PERSONA, no_em_dash: 0 };
    const verdict = assessPersonaDrift({ sample });
    expect(verdict.breached).toBe(true);
    expect(verdict.worstDim).toBe('no_em_dash');
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it('severity escalates with worst-dim magnitude', () => {
    const small = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.6 }; // ~0.18 drift
    const medium = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.45 }; // ~0.33 drift
    const high = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.2 };   // ~0.58 drift
    expect(assessPersonaDrift({ sample: small }).severity).toBe('low');
    expect(assessPersonaDrift({ sample: medium }).severity).toBe('medium');
    expect(assessPersonaDrift({ sample: high }).severity).toBe('high');
  });

  it('respects a custom per-dim threshold', () => {
    const sample = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.7 };
    const lenient = assessPersonaDrift({ sample, perDimThreshold: 0.5 });
    const strict = assessPersonaDrift({ sample, perDimThreshold: 0.05 });
    expect(lenient.breached).toBe(false);
    expect(strict.breached).toBe(true);
  });
});

describe('emitPersonaDriftIfBreached', () => {
  it('does NOT record when not breached', async () => {
    const sink = createSpySink();
    const verdict = await emitPersonaDriftIfBreached({
      sample: BORJIE_REFERENCE_PERSONA,
      thoughtId: 't1',
      personaId: 'tenant-resident',
      capturedAt: new Date().toISOString(),
      sink,
    });
    expect(verdict.breached).toBe(false);
    expect(sink.events).toHaveLength(0);
  });

  it('records a tone-class event when breached', async () => {
    const sink = createSpySink();
    const sample = { ...BORJIE_REFERENCE_PERSONA, no_em_dash: 0, warmth: 0.1 };
    await emitPersonaDriftIfBreached({
      sample,
      thoughtId: 't1',
      personaId: 'tenant-resident',
      capturedAt: '2026-05-14T09:00:00.000Z',
      sink,
    });
    expect(sink.events).toHaveLength(1);
    const ev = sink.events[0]!;
    expect(ev.violationType).toBe('tone');
    expect(ev.thoughtId).toBe('t1');
    expect(ev.personaId).toBe('tenant-resident');
    expect(ev.excerpt).toMatch(/drifted/);
  });
});
