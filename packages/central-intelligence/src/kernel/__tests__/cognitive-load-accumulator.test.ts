/**
 * Cognitive-load stateful accumulator tests.
 *
 * The per-turn `assessCognitiveLoad` already has edge-case coverage
 * in `__tests__/cognitive-load-edges.test.ts`. This file targets the
 * new stateful accumulator + the simplify-request + latency signals
 * + the directive-with-profile renderer.
 */

import { describe, it, expect } from 'vitest';
import {
  assessCognitiveLoad,
  createCognitiveLoadAccumulator,
  renderLoadDirectiveWithProfile,
} from '../cognitive-load.js';

const BASE = Date.now();
const ISO = (offset: number): string => new Date(BASE + offset).toISOString();
const AT = (offset: number): number => BASE + offset;

describe('assessCognitiveLoad — new signals', () => {
  it('escalates on explicit simplify request', () => {
    const out = assessCognitiveLoad({
      userMessage: 'can you rephrase in simpler terms?',
      recentTurnCount: 0,
    });
    expect(out.load).toBe('medium');
  });

  it('escalates on plain-English request', () => {
    const out = assessCognitiveLoad({
      userMessage: 'in plain english please',
      recentTurnCount: 0,
    });
    expect(out.load).toBe('medium');
  });

  it('escalates on prior-turn latency ≥ 8 s', () => {
    const out = assessCognitiveLoad({
      userMessage: 'ok',
      recentTurnCount: 0,
      priorTurnLatencyMs: 10_000,
    });
    expect(out.load).toBe('medium');
  });

  it('exposes a numeric score in [0,1]', () => {
    const out = assessCognitiveLoad({ userMessage: 'help', recentTurnCount: 0 });
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(1);
  });
});

describe('createCognitiveLoadAccumulator', () => {
  it('starts empty', () => {
    const acc = createCognitiveLoadAccumulator();
    expect(acc.size()).toBe(0);
    expect(acc.read('t1', 'u1')).toBeNull();
  });

  it('records a turn for a (tenant,user) key', () => {
    const acc = createCognitiveLoadAccumulator();
    const profile = acc.observe('t1', 'u1', {
      perTurnScore: 0.5,
      capturedAt: ISO(1_700_000_000_000),
    });
    expect(profile.turns).toBe(1);
    expect(profile.score).toBe(0.5);
    expect(acc.size()).toBe(1);
  });

  it('blends new observations with previous score', () => {
    const acc = createCognitiveLoadAccumulator();
    acc.observe('t1', 'u1', { perTurnScore: 0.8, capturedAt: ISO(1) });
    const p2 = acc.observe('t1', 'u1', { perTurnScore: 0.0, capturedAt: ISO(2) });
    // EMA 0.4 * 0 + 0.6 * 0.8 = 0.48
    expect(p2.score).toBeCloseTo(0.48, 2);
    expect(p2.turns).toBe(2);
  });

  it('keeps separate state per (tenant,user)', () => {
    const acc = createCognitiveLoadAccumulator();
    acc.observe('t1', 'u1', { perTurnScore: 0.9, capturedAt: ISO(0) });
    acc.observe('t1', 'u2', { perTurnScore: 0.1, capturedAt: ISO(0) });
    expect(acc.read('t1', 'u1')!.score).toBeCloseTo(0.9, 3);
    expect(acc.read('t1', 'u2')!.score).toBeCloseTo(0.1, 3);
    expect(acc.size()).toBe(2);
  });

  it('TTL-evicts stale entries on read', () => {
    const acc = createCognitiveLoadAccumulator();
    acc.observe('t1', 'u1', { perTurnScore: 0.5, capturedAt: ISO(0) });
    const oneDayLater = AT(0) + 25 * 60 * 60 * 1000;
    expect(acc.read('t1', 'u1', oneDayLater)).toBeNull();
    expect(acc.size()).toBe(0);
  });

  it('decay kicks in after 4 stable turns', () => {
    const acc = createCognitiveLoadAccumulator();
    acc.observe('t1', 'u1', { perTurnScore: 0.6, capturedAt: ISO(1) });
    let profile = acc.observe('t1', 'u1', { perTurnScore: 0.6, capturedAt: ISO(2) });
    profile = acc.observe('t1', 'u1', { perTurnScore: 0.6, capturedAt: ISO(3) });
    profile = acc.observe('t1', 'u1', { perTurnScore: 0.6, capturedAt: ISO(4) });
    profile = acc.observe('t1', 'u1', { perTurnScore: 0.6, capturedAt: ISO(5) });
    // After 4 stable turns, decay subtracts 0.08 from the blended score.
    expect(profile.stableStreak).toBeGreaterThanOrEqual(4);
    expect(profile.score).toBeLessThan(0.6);
  });

  it('reset clears state', () => {
    const acc = createCognitiveLoadAccumulator();
    acc.observe('t1', 'u1', { perTurnScore: 0.5, capturedAt: ISO(1) });
    acc.reset();
    expect(acc.size()).toBe(0);
  });
});

describe('renderLoadDirectiveWithProfile', () => {
  it('falls back to base directive when no profile', () => {
    const out = assessCognitiveLoad({ userMessage: 'short', recentTurnCount: 0 });
    const directive = renderLoadDirectiveWithProfile(out, null);
    expect(directive).toMatch(/at most 12 sentences/);
    expect(directive).not.toMatch(/escalating load/);
  });

  it('adds escalation hint when accumulated score is high', () => {
    const out = assessCognitiveLoad({
      userMessage: 'help help help',
      recentTurnCount: 0,
    });
    const directive = renderLoadDirectiveWithProfile(out, {
      score: 0.8,
      turns: 4,
      stableStreak: 0,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/escalating load/);
  });

  it('adds the moderate-load reminder when score sits ~0.4', () => {
    const out = assessCognitiveLoad({ userMessage: 'help', recentTurnCount: 0 });
    const directive = renderLoadDirectiveWithProfile(out, {
      score: 0.45,
      turns: 3,
      stableStreak: 1,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Sustained moderate load/);
  });

  it('relaxes when streak is calm', () => {
    const out = assessCognitiveLoad({ userMessage: 'help', recentTurnCount: 0 });
    const directive = renderLoadDirectiveWithProfile(out, {
      score: 0.1,
      turns: 10,
      stableStreak: 6,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Recent turns are calm/);
  });
});
