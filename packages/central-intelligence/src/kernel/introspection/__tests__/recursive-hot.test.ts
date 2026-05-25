/**
 * Tests for the recursive higher-order thought (HOT) module.
 *
 * Covers:
 *   - happy path: two-rung default produces order-1 + order-2 with notes
 *   - depth respected when explicit (1, 3)
 *   - depth cap at MAX_HOT_DEPTH
 *   - depth < 1 floored to 1
 *   - non-finite depth defaults
 *   - malformed input (empty snapshot, missing context)
 *   - judge port applied at every rung
 *   - convergence stops recursion early
 *   - deterministic shape across runs
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HOT_DEPTH,
  MAX_HOT_DEPTH,
  generateRecursiveHot,
  type HotRung,
} from '../recursive-hot.js';
import type {
  IntrospectionJudge,
  PerThoughtSelfModel,
} from '../per-thought-self-model.js';

describe('generateRecursiveHot — happy path', () => {
  it('default depth yields exactly two rungs', () => {
    const result = generateRecursiveHot({
      snapshot: {
        text: 'According to s.4, the rent is TZS 100.',
        taskHint: 'answer rent',
      },
      context: { citationCount: 1, toolCallsIssued: true },
    });
    expect(result.rungs).toHaveLength(DEFAULT_HOT_DEPTH);
    expect(result.rungs[0]?.order).toBe(1);
    expect(result.rungs[1]?.order).toBe(2);
    expect(result.cappedByMax).toBe(false);
  });

  it('order-1 reflectionNotes are empty (no rung below)', () => {
    const result = generateRecursiveHot({
      snapshot: { text: 'I will send a reminder.' },
    });
    expect(result.rungs[0]?.reflectionNotes).toEqual([]);
  });
});

describe('generateRecursiveHot — depth handling', () => {
  it('depth=1 returns only the first-order self-model', () => {
    const result = generateRecursiveHot({
      snapshot: { text: 'x' },
      depth: 1,
    });
    expect(result.rungs).toHaveLength(1);
    expect(result.rungs[0]?.order).toBe(1);
  });

  it('depth=3 yields up to three rungs (or stops at convergence)', () => {
    const result = generateRecursiveHot({
      snapshot: {
        text:
          'Maybe the tenant owes something, perhaps, I think. I am not sure.',
      },
      depth: 3,
    });
    expect(result.rungs.length).toBeGreaterThanOrEqual(1);
    expect(result.rungs.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < result.rungs.length; i += 1) {
      expect(result.rungs[i]?.order).toBe(i + 1);
    }
  });

  it('depth > MAX_HOT_DEPTH is clamped and flagged', () => {
    const result = generateRecursiveHot({
      snapshot: {
        text:
          'A wandering essay with hedges maybe and assertions definitely.',
      },
      depth: 999,
    });
    expect(result.rungs.length).toBeLessThanOrEqual(MAX_HOT_DEPTH);
    expect(result.cappedByMax).toBe(true);
  });

  it('depth < 1 is floored to 1', () => {
    const result = generateRecursiveHot({
      snapshot: { text: 'x' },
      depth: 0,
    });
    expect(result.rungs).toHaveLength(1);
  });

  it('non-finite depth falls back to the default', () => {
    const result = generateRecursiveHot({
      snapshot: { text: 'x' },
      depth: Number.NaN,
    });
    expect(result.rungs.length).toBeLessThanOrEqual(DEFAULT_HOT_DEPTH);
  });
});

describe('generateRecursiveHot — malformed input', () => {
  it('empty snapshot still produces a first-order rung', () => {
    const result = generateRecursiveHot({
      snapshot: { text: '' },
    });
    expect(result.rungs.length).toBeGreaterThanOrEqual(1);
    expect(result.rungs[0]?.selfModel.posture).toBe('clarifying');
  });

  it('missing context does not throw', () => {
    expect(() =>
      generateRecursiveHot({
        snapshot: { text: 'According to s.4, x.' },
      }),
    ).not.toThrow();
  });

  it('caller-supplied primary self-model is honoured', () => {
    const primary: PerThoughtSelfModel = {
      task: 'pre-built',
      posture: 'reasoning',
      confidence: 0.5,
      uncertaintyAxes: ['axis-a'],
      commitments: [],
      openQuestions: [],
    };
    const result = generateRecursiveHot({
      snapshot: { text: 'irrelevant' },
      primarySelfModel: primary,
    });
    expect(result.rungs[0]?.selfModel.task).toBe('pre-built');
  });
});

describe('generateRecursiveHot — judge port', () => {
  it('judge is invoked for every rung', () => {
    let calls = 0;
    const judge: IntrospectionJudge = () => {
      calls += 1;
      return { confidence: 0.61 };
    };
    const result = generateRecursiveHot({
      snapshot: { text: 'According to s.4, x.' },
      depth: 3,
      judge,
    });
    expect(calls).toBeGreaterThanOrEqual(result.rungs.length);
  });

  it('judge throwing on one rung does not crash recursion', () => {
    const judge: IntrospectionJudge = () => {
      throw new Error('boom');
    };
    expect(() =>
      generateRecursiveHot({
        snapshot: { text: 'x' },
        depth: 3,
        judge,
      }),
    ).not.toThrow();
  });
});

describe('generateRecursiveHot — convergence', () => {
  it('stops early when reflection adds no new signal', () => {
    const stable: PerThoughtSelfModel = {
      task: 't',
      posture: 'answering',
      confidence: 0.5,
      uncertaintyAxes: [],
      commitments: [],
      openQuestions: [],
    };
    const stableJudge: IntrospectionJudge = () => ({
      posture: 'answering',
      confidence: 0.5,
      uncertaintyAxes: [],
    });
    const result = generateRecursiveHot({
      snapshot: { text: 'According to s.4, x.' },
      primarySelfModel: stable,
      depth: 4,
      judge: stableJudge,
    });
    expect(result.convergedEarly).toBe(true);
    expect(result.rungs.length).toBeLessThan(4);
  });

  it('reflection notes surface confidence drift across rungs', () => {
    const result = generateRecursiveHot({
      snapshot: {
        text:
          'Definitely, certainly, always, never. The tenant absolutely owes.',
      },
      context: { citationCount: 0, toolCallsIssued: false },
      depth: 2,
    });
    const secondRung = result.rungs[1];
    expect(secondRung).toBeDefined();
    if (secondRung) {
      const allNotes = secondRung.reflectionNotes.join(' ');
      const hasMeaningfulChange =
        allNotes.length > 0 ||
        secondRung.selfModel.uncertaintyAxes.length > 0;
      expect(hasMeaningfulChange).toBe(true);
    }
  });

  it('reflection notes are sorted', () => {
    const result = generateRecursiveHot({
      snapshot: {
        text:
          'Maybe definitely. Always perhaps. I think absolutely never.',
      },
      depth: 2,
    });
    const notes = result.rungs[1]?.reflectionNotes ?? [];
    const sorted = [...notes].sort((a, b) => a.localeCompare(b));
    expect(notes).toEqual(sorted);
  });
});

describe('generateRecursiveHot — determinism', () => {
  it('returns equal output for equal input across runs', () => {
    const args = {
      snapshot: {
        text: 'According to s.4, the rent is TZS 100. I will send a reminder.',
      },
      context: { citationCount: 1, toolCallsIssued: true },
      depth: 3,
    };
    const a = generateRecursiveHot(args);
    const b = generateRecursiveHot(args);
    expect(a).toEqual(b);
  });

  it('rung ordering is monotonic 1..N', () => {
    const result = generateRecursiveHot({
      snapshot: { text: 'According to s.4, x.' },
      depth: 4,
    });
    const orders = result.rungs.map((r: HotRung) => r.order);
    for (let i = 0; i < orders.length; i += 1) {
      expect(orders[i]).toBe(i + 1);
    }
  });
});
