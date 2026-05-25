/**
 * Theory-of-mind stateful accumulator tests.
 *
 * The per-turn `inferMindState` already has edge-case coverage in
 * `__tests__/theory-of-mind-edges.test.ts`. This file targets the
 * new affective accumulator (frustration / comprehension / anxiety /
 * trust / urgency) + the directive-with-profile renderer.
 */

import { describe, it, expect } from 'vitest';
import {
  inferMindState,
  AFFECTIVE_DEFAULT,
  createAffectiveAccumulator,
  renderMindStateDirectiveWithProfile,
} from '../theory-of-mind.js';

const BASE = Date.now();
const ISO = (offset: number): string => new Date(BASE + offset).toISOString();
const AT = (offset: number): number => BASE + offset;

describe('AFFECTIVE_DEFAULT', () => {
  it('seeds frustration low and trust mid-high', () => {
    expect(AFFECTIVE_DEFAULT.frustration).toBe(0.0);
    expect(AFFECTIVE_DEFAULT.trust).toBeGreaterThan(0.5);
    expect(AFFECTIVE_DEFAULT.comprehension).toBeGreaterThan(0.5);
  });

  it('seeds all dims in [0,1]', () => {
    for (const v of Object.values(AFFECTIVE_DEFAULT)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('createAffectiveAccumulator', () => {
  it('starts empty', () => {
    const acc = createAffectiveAccumulator();
    expect(acc.size()).toBe(0);
    expect(acc.read('t1', 'u1')).toBeNull();
  });

  it('first observation seeds the profile from default', () => {
    const acc = createAffectiveAccumulator();
    const profile = acc.observe('t1', 'u1', {
      mindState: inferMindState('hello'),
      capturedAt: ISO(1),
    });
    expect(profile.turns).toBe(1);
    // Default frustration is 0; should remain near 0 after a neutral turn.
    expect(profile.state.frustration).toBeLessThanOrEqual(0.05);
  });

  it('accumulates frustration across negative turns', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious about this'),
      capturedAt: ISO(1),
    });
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('this is so frustrating!!!'),
      capturedAt: ISO(2),
    });
    expect(p2.state.frustration).toBeGreaterThan(0.2);
  });

  it('positive turns lower frustration and raise trust', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('thanks, perfect'),
      capturedAt: ISO(2),
    });
    expect(p2.state.frustration).toBeLessThan(baseline.frustration);
    expect(p2.state.trust).toBeGreaterThan(baseline.trust);
  });

  it('expert framing raises comprehension', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('what is the cap rate by block'),
      capturedAt: ISO(1),
    });
    expect(p.state.comprehension).toBeGreaterThan(AFFECTIVE_DEFAULT.comprehension);
  });

  it('high-urgency raises both urgency and anxiety', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('do this now!!! emergency'),
      capturedAt: ISO(1),
    });
    expect(p.state.urgency).toBeGreaterThan(AFFECTIVE_DEFAULT.urgency);
    expect(p.state.anxiety).toBeGreaterThan(AFFECTIVE_DEFAULT.anxiety);
  });

  it('prior outcome=success raises trust, lowers frustration', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(2),
      priorOutcome: 'success',
    });
    expect(p2.state.trust).toBeGreaterThan(baseline.trust);
    expect(p2.state.frustration).toBeLessThan(baseline.frustration);
  });

  it('prior outcome=failure raises frustration, lowers trust', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(1),
    });
    const baseline = acc.read('t1', 'u1')!.state;
    const p2 = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(2),
      priorOutcome: 'failure',
    });
    expect(p2.state.frustration).toBeGreaterThan(baseline.frustration);
    expect(p2.state.trust).toBeLessThan(baseline.trust);
  });

  it('long latency raises anxiety, drops comprehension', () => {
    const acc = createAffectiveAccumulator();
    const p = acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(1),
      priorTurnLatencyMs: 6 * 60 * 1000, // 6 min
    });
    expect(p.state.anxiety).toBeGreaterThan(AFFECTIVE_DEFAULT.anxiety);
    expect(p.state.comprehension).toBeLessThan(AFFECTIVE_DEFAULT.comprehension);
  });

  it('keeps separate state per (tenant,user)', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'alice', {
      mindState: inferMindState('I am furious'),
      capturedAt: ISO(1),
    });
    acc.observe('t1', 'bob', {
      mindState: inferMindState('thanks!'),
      capturedAt: ISO(1),
    });
    expect(acc.read('t1', 'alice')!.state.frustration).toBeGreaterThan(0.1);
    expect(acc.read('t1', 'bob')!.state.frustration).toBeLessThan(0.1);
  });

  it('TTL-evicts entries older than 24h', () => {
    const acc = createAffectiveAccumulator();
    acc.observe('t1', 'u1', {
      mindState: inferMindState('ok'),
      capturedAt: ISO(0),
    });
    const oneDayLater = AT(0) + 25 * 60 * 60 * 1000;
    expect(acc.read('t1', 'u1', oneDayLater)).toBeNull();
  });

  it('values stay clamped to [0,1] even on repeated negative turns', () => {
    const acc = createAffectiveAccumulator();
    let p = acc.read('t1', 'u1');
    for (let i = 0; i < 30; i += 1) {
      p = acc.observe('t1', 'u1', {
        mindState: inferMindState('I am furious!!!'),
        capturedAt: ISO(i + 1),
        priorOutcome: 'failure',
      });
    }
    for (const v of Object.values(p!.state)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('renderMindStateDirectiveWithProfile', () => {
  it('falls back to base directive when no profile / few turns', () => {
    const ms = inferMindState('what is the rent');
    const directive = renderMindStateDirectiveWithProfile(ms, null);
    expect(directive).toBeTruthy();
    expect(directive).not.toMatch(/escalating frustration/);
  });

  it('adds escalating-frustration hint when state.frustration ≥ 0.5', () => {
    const ms = inferMindState('what is the rent');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.6, comprehension: 0.7, anxiety: 0.3, trust: 0.6, urgency: 0.4 },
      turns: 4,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/escalating frustration/);
  });

  it('adds comprehension-eroded hint when comprehension ≤ 0.4', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.3, anxiety: 0.3, trust: 0.6, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Comprehension has eroded/);
  });

  it('adds anxiety reassurance when anxiety ≥ 0.6', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.7, trust: 0.6, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Anxiety is high/);
  });

  it('adds cite-every-claim hint when trust ≤ 0.4', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.3, trust: 0.3, urgency: 0.4 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Trust is low/);
    expect(directive).toMatch(/cite every claim/);
  });

  it('adds sustained-urgency hint when urgency ≥ 0.7', () => {
    const ms = inferMindState('ok');
    const directive = renderMindStateDirectiveWithProfile(ms, {
      state: { frustration: 0.1, comprehension: 0.7, anxiety: 0.3, trust: 0.6, urgency: 0.8 },
      turns: 3,
      updatedAt: ISO(1),
    });
    expect(directive).toMatch(/Sustained urgency/);
  });
});
