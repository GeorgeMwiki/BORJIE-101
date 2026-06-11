/**
 * loop-registry — register / list / listDue / retire / population-cap tests.
 */

import { describe, it, expect } from 'vitest';
import {
  createLoopRegistry,
  DEFAULT_LOOP_POPULATION_CAP,
} from '../loop-registry.js';
import { defineLoopSpec, type LoopSpec } from '../loop-spec.js';

const tickLoop = (
  id: string,
  over: Partial<Parameters<typeof defineLoopSpec>[0]> = {},
): LoopSpec =>
  defineLoopSpec({
    id,
    title: id,
    trigger: { kind: 'tick', everyMs: 1000 },
    actPort: 'host.act',
    learnPort: 'host.learn',
    createdAtMs: 0,
    ...over,
  });

describe('createLoopRegistry — register / get / list', () => {
  it('registers + retrieves a loop', () => {
    const reg = createLoopRegistry();
    const out = reg.register(tickLoop('a'));
    expect(out).toEqual({ ok: true, evicted: null });
    expect(reg.get('a')?.id).toBe('a');
    expect(reg.size()).toBe(1);
    expect(reg.list().map((l) => l.id)).toEqual(['a']);
  });

  it('tolerates duplicate ids (last-wins, population unchanged)', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('a', { title: 'first' }));
    const out = reg.register(tickLoop('a', { title: 'second' }));
    expect(out).toEqual({ ok: true, evicted: null });
    expect(reg.get('a')?.title).toBe('second');
    expect(reg.size()).toBe(1);
  });

  it('retire removes a loop + returns it; unknown id → undefined', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('a'));
    expect(reg.retire('a')?.id).toBe('a');
    expect(reg.get('a')).toBeUndefined();
    expect(reg.size()).toBe(0);
    expect(reg.retire('nope')).toBeUndefined();
  });

  it('exposes the default population cap', () => {
    expect(DEFAULT_LOOP_POPULATION_CAP).toBe(256);
  });
});

describe('listDue (tick cadence eligibility)', () => {
  it('returns only tick loops whose cadence has elapsed since creation', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('soon', { createdAtMs: 0, trigger: { kind: 'tick', everyMs: 1000 } }));
    reg.register(tickLoop('later', { createdAtMs: 0, trigger: { kind: 'tick', everyMs: 10_000 } }));
    // At t=1000 only 'soon' (everyMs 1000) is due.
    expect(reg.listDue(1000).map((l) => l.id)).toEqual(['soon']);
    // At t=10_000 both are due.
    expect(new Set(reg.listDue(10_000).map((l) => l.id))).toEqual(
      new Set(['soon', 'later']),
    );
  });

  it('never returns event loops as due on a bare tick', () => {
    const reg = createLoopRegistry();
    reg.register(
      tickLoop('evt', { trigger: { kind: 'event', eventType: 'x' } }),
    );
    expect(reg.listDue(1_000_000)).toEqual([]);
  });

  it('a future createdAtMs is not yet due', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('future', { createdAtMs: 5000, trigger: { kind: 'tick', everyMs: 1000 } }));
    expect(reg.listDue(3000)).toEqual([]);
    expect(reg.listDue(6000).map((l) => l.id)).toEqual(['future']);
  });
});

describe('updateEfficacy', () => {
  it('replaces efficacy with a clamped score on a NEW frozen spec', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('a'));
    const updated = reg.updateEfficacy('a', 0.42);
    expect(updated?.efficacy).toBe(0.42);
    expect(Object.isFrozen(updated)).toBe(true);
    expect(reg.get('a')?.efficacy).toBe(0.42);
  });

  it('clamps out-of-range + non-finite efficacy', () => {
    const reg = createLoopRegistry();
    reg.register(tickLoop('a'));
    expect(reg.updateEfficacy('a', 5)?.efficacy).toBe(1);
    expect(reg.updateEfficacy('a', -3)?.efficacy).toBe(0);
    expect(reg.updateEfficacy('a', Number.NaN)?.efficacy).toBe(0);
  });

  it('returns undefined for an unknown id', () => {
    const reg = createLoopRegistry();
    expect(reg.updateEfficacy('nope', 0.5)).toBeUndefined();
  });
});

describe('population cap — synaptic-pruning eviction by efficacy', () => {
  it('rejects a new loop when at cap and it does not out-score the weakest', () => {
    const reg = createLoopRegistry({ populationCap: 2 });
    reg.register(tickLoop('hi', { efficacy: 0.9 }));
    reg.register(tickLoop('mid', { efficacy: 0.5 }));
    // Newcomer with efficacy 0.3 < weakest (0.5) → rejected.
    const out = reg.register(tickLoop('lo', { efficacy: 0.3 }));
    expect(out).toEqual({ ok: false, reason: 'population_cap_reached' });
    expect(reg.size()).toBe(2);
    expect(reg.get('lo')).toBeUndefined();
  });

  it('evicts the lowest-efficacy resident when the newcomer out-scores it', () => {
    const reg = createLoopRegistry({ populationCap: 2 });
    reg.register(tickLoop('hi', { efficacy: 0.9 }));
    reg.register(tickLoop('weak', { efficacy: 0.2 }));
    const out = reg.register(tickLoop('strong', { efficacy: 0.6 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.evicted?.id).toBe('weak');
    expect(reg.get('weak')).toBeUndefined();
    expect(reg.get('strong')?.id).toBe('strong');
    expect(reg.size()).toBe(2);
  });

  it('treats unscored (null efficacy) residents as the lowest value', () => {
    const reg = createLoopRegistry({ populationCap: 2 });
    reg.register(tickLoop('scored', { efficacy: 0.4 }));
    reg.register(tickLoop('unscored')); // efficacy null → ranks lowest (-1)
    // A scored newcomer (0.1) out-scores the unscored resident (-1) → evicts it.
    const out = reg.register(tickLoop('newScored', { efficacy: 0.1 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.evicted?.id).toBe('unscored');
  });

  it('re-registering a known id at the cap never trips the cap', () => {
    const reg = createLoopRegistry({ populationCap: 2 });
    reg.register(tickLoop('a', { efficacy: 0.5 }));
    reg.register(tickLoop('b', { efficacy: 0.5 }));
    const out = reg.register(tickLoop('a', { efficacy: 0.99, title: 'upgraded' }));
    expect(out).toEqual({ ok: true, evicted: null });
    expect(reg.get('a')?.title).toBe('upgraded');
    expect(reg.size()).toBe(2);
  });
});
