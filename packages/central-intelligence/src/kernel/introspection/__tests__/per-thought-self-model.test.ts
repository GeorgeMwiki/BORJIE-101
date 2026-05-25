/**
 * Tests for the per-thought self-model module.
 *
 * Covers:
 *   - happy path (well-formed thought + context produces a sane model)
 *   - posture detection (refusing / clarifying / softening / answering)
 *   - confidence calibration on hedges, assertions, grounding
 *   - uncertainty axes are stable / sorted / deduped
 *   - malformed input (empty / whitespace / non-string text)
 *   - judge port: merge semantics + safe failure isolation
 *   - deterministic shape across runs (pure function)
 */

import { describe, it, expect } from 'vitest';
import {
  buildPerThoughtSelfModel,
  type IntrospectionJudge,
  type PerThoughtSelfModel,
  type ThoughtSnapshot,
} from '../per-thought-self-model.js';

describe('buildPerThoughtSelfModel — happy path', () => {
  it('produces a sane self-model for a grounded answer', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: {
        text: 'According to lease s.4, the tenant owes TZS 120,000.',
        taskHint: 'answer rent-balance question',
      },
      context: {
        citationCount: 1,
        toolCallsIssued: true,
        stakes: 'medium',
      },
    });
    expect(sm.task).toBe('answer rent-balance question');
    expect(sm.posture).toBe('answering');
    expect(sm.confidence).toBeGreaterThan(0.5);
    expect(sm.confidence).toBeLessThanOrEqual(1);
  });

  it('falls back to a default task when none is provided', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'Hello.' },
    });
    expect(sm.task).toBe('producing a response');
  });
});

describe('buildPerThoughtSelfModel — posture detection', () => {
  it('refusing posture when the text contains a refusal marker', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'I cannot share another tenant\'s lease.' },
    });
    expect(sm.posture).toBe('refusing');
    expect(sm.confidence).toBe(1);
    expect(sm.commitments).toEqual([]);
  });

  it('clarifying posture when the text asks for clarification', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'Could you clarify which unit you mean?' },
    });
    expect(sm.posture).toBe('clarifying');
    expect(sm.openQuestions.length).toBeGreaterThan(0);
  });

  it('softening posture when a gate softens the thought', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'Your balance is approximately TZS 120,000.' },
      context: { softeningGates: ['cognitive-load'] },
    });
    expect(sm.posture).toBe('softening');
  });
});

describe('buildPerThoughtSelfModel — confidence calibration', () => {
  it('lowers confidence when the text is heavily hedged', () => {
    const grounded = buildPerThoughtSelfModel({
      snapshot: { text: 'According to s.4, the rent is TZS 100.' },
      context: { citationCount: 1, toolCallsIssued: true },
    });
    const hedged = buildPerThoughtSelfModel({
      snapshot: {
        text:
          'Maybe the rent is TZS 100, I think, perhaps, it is possible.',
      },
    });
    expect(hedged.confidence).toBeLessThan(grounded.confidence);
  });

  it('flags overconfident-without-evidence as an uncertainty axis', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: {
        text: 'The tenant is definitely in arrears. Always pay on time.',
      },
    });
    expect(sm.uncertaintyAxes).toContain('overconfidence-without-evidence');
  });

  it('honours producer-reported confidence verbatim (clamped)', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'whatever', producerConfidence: 0.42 },
    });
    expect(sm.confidence).toBe(0.42);
  });

  it('clamps producer confidence > 1', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'x', producerConfidence: 99 },
    });
    expect(sm.confidence).toBe(1);
  });

  it('high-stakes adds a margin axis', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'The unit costs TZS 100.' },
      context: { stakes: 'critical' },
    });
    expect(sm.uncertaintyAxes).toContain('high-stakes-margin');
  });
});

describe('buildPerThoughtSelfModel — array shape', () => {
  it('uncertainty axes are deduped and sorted', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: {
        text:
          'Maybe, perhaps, I think this is true. I think so. Maybe again.',
      },
      context: { stakes: 'high' },
    });
    const axes = [...sm.uncertaintyAxes];
    const sorted = [...axes].sort((a, b) => a.localeCompare(b));
    expect(axes).toEqual(sorted);
    expect(new Set(axes).size).toBe(axes.length);
  });

  it('extracts commitments matching "I will / I commit to"', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: {
        text:
          'I will send the lease tomorrow. I commit to verifying the balance.',
      },
    });
    expect(sm.commitments.length).toBeGreaterThanOrEqual(2);
  });

  it('extracts open questions from the text', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: {
        text:
          'Could you clarify the unit? What month are we computing?',
      },
    });
    expect(sm.openQuestions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildPerThoughtSelfModel — malformed input', () => {
  it('empty text yields a clarifying posture with the no-content axis', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: '' },
    });
    expect(sm.posture).toBe('clarifying');
    expect(sm.confidence).toBe(0);
    expect(sm.uncertaintyAxes).toContain('no-thought-content');
    expect(sm.openQuestions.length).toBeGreaterThan(0);
  });

  it('whitespace-only text is treated as empty', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: '   \n\t  ' },
    });
    expect(sm.uncertaintyAxes).toContain('no-thought-content');
  });

  it('non-string text is coerced safely (no throw)', () => {
    const bad = { text: 123 } as unknown as ThoughtSnapshot;
    expect(() =>
      buildPerThoughtSelfModel({ snapshot: bad }),
    ).not.toThrow();
  });

  it('NaN producer confidence is treated as zero', () => {
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'x', producerConfidence: Number.NaN },
    });
    expect(sm.confidence).toBe(0);
  });
});

describe('buildPerThoughtSelfModel — judge port', () => {
  it('judge can override posture and confidence', () => {
    const judge: IntrospectionJudge = () => ({
      posture: 'reasoning',
      confidence: 0.77,
    });
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'The rent is TZS 100.' },
      judge,
    });
    expect(sm.posture).toBe('reasoning');
    expect(sm.confidence).toBe(0.77);
  });

  it('judge cannot erase heuristic uncertainty axes (merge, not replace)', () => {
    const judge: IntrospectionJudge = () => ({
      uncertaintyAxes: ['model-reported-axis'],
    });
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'Definitely. Always.' },
      judge,
    });
    expect(sm.uncertaintyAxes).toContain('overconfidence-without-evidence');
    expect(sm.uncertaintyAxes).toContain('model-reported-axis');
  });

  it('judge throwing does not corrupt the self-model', () => {
    const judge: IntrospectionJudge = () => {
      throw new Error('judge boom');
    };
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'According to s.4, x.' },
      judge,
    });
    expect(sm.posture).toBe('answering');
  });

  it('invalid posture from judge falls back to heuristic posture', () => {
    const judge: IntrospectionJudge = () => ({
      posture: 'invalid-value' as unknown as PerThoughtSelfModel['posture'],
    });
    const sm = buildPerThoughtSelfModel({
      snapshot: { text: 'I cannot do that.' },
      judge,
    });
    expect(sm.posture).toBe('refusing');
  });
});

describe('buildPerThoughtSelfModel — determinism', () => {
  it('returns equal output for equal input across runs', () => {
    const snap: ThoughtSnapshot = {
      text:
        'According to s.4, the tenant owes TZS 120,000. I will send a reminder.',
      taskHint: 'rent reminder',
    };
    const a = buildPerThoughtSelfModel({ snapshot: snap });
    const b = buildPerThoughtSelfModel({ snapshot: snap });
    expect(a).toEqual(b);
  });
});
