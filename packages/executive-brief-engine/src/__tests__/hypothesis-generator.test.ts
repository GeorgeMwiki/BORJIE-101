import { describe, expect, it } from 'vitest';
import {
  generateHypotheses,
  parseHypothesisJson,
  HYPOTHESIS_PROMPT_VERSION,
} from '../hypothesis-generator.js';
import type { HaikuLlmPort } from '../hypothesis-generator.js';
import type { SensorSignal } from '../sensors.js';

const NOW = new Date('2026-05-22T06:00:00.000Z');

function signal(overrides: Partial<SensorSignal> = {}): SensorSignal {
  return {
    sensor: 'arrears',
    metric: 'overdue_count',
    value: 12,
    timestamp: NOW,
    evidenceRefs: [{ kind: 'entity', id: 'ent_lease_1' }],
    ...overrides,
  };
}

function llm(returnText: string, cost = 1000): HaikuLlmPort {
  return {
    async call() {
      return { text: returnText, costMicros: cost };
    },
  };
}

describe('parseHypothesisJson', () => {
  it('parses a clean JSON array', () => {
    const raw = JSON.stringify([
      {
        kind: 'risk',
        title: 'Foo',
        description: 'Bar.',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'ent_1' }],
      },
    ]);
    const out = parseHypothesisJson(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('risk');
  });

  it('strips code fences', () => {
    const raw = '```json\n' + JSON.stringify([
      {
        kind: 'gap',
        title: 'X',
        description: 'Y',
        severity: 'MEDIUM',
        evidenceRefs: [],
      },
    ]) + '\n```';
    const out = parseHypothesisJson(raw);
    expect(out).toHaveLength(1);
  });

  it('handles leading prose by finding the first [', () => {
    const raw = 'Here are my hypotheses:\n' + JSON.stringify([
      {
        kind: 'opportunity',
        title: 'X',
        description: 'Y',
        severity: 'LOW',
        evidenceRefs: [],
      },
    ]);
    const out = parseHypothesisJson(raw);
    expect(out).toHaveLength(1);
  });

  it('returns empty array when JSON is malformed beyond recovery', () => {
    const out = parseHypothesisJson('not json');
    expect(out).toEqual([]);
  });

  it('recovers valid entries from a partially malformed array', () => {
    const raw = JSON.stringify([
      { not_valid: true },
      {
        kind: 'gap',
        title: 'OK',
        description: 'Y',
        severity: 'HIGH',
        evidenceRefs: [],
      },
    ]);
    const out = parseHypothesisJson(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('OK');
  });
});

describe('generateHypotheses', () => {
  it('returns degraded result on empty signals', async () => {
    const r = await generateHypotheses({
      signals: [],
      locale: 'en',
      llm: llm('[]'),
    });
    expect(r.degraded).toBe(true);
    expect(r.hypotheses).toEqual([]);
    expect(r.promptVersion).toBe(HYPOTHESIS_PROMPT_VERSION);
  });

  it('returns hypotheses parsed from LLM output', async () => {
    const text = JSON.stringify([
      {
        kind: 'risk',
        title: 'Arrears trending up',
        description: 'overdue count is 12 vs 5 baseline.',
        severity: 'HIGH',
        evidenceRefs: [{ kind: 'entity', id: 'ent_lease_1' }],
      },
    ]);
    const r = await generateHypotheses({
      signals: [signal()],
      locale: 'en',
      llm: llm(text, 1234),
    });
    expect(r.hypotheses).toHaveLength(1);
    expect(r.costMicros).toBe(1234);
    expect(r.degraded).toBe(false);
  });

  it('returns degraded on LLM failure', async () => {
    const r = await generateHypotheses({
      signals: [signal()],
      locale: 'en',
      llm: {
        async call() {
          throw new Error('llm exploded');
        },
      },
    });
    expect(r.degraded).toBe(true);
    expect(r.hypotheses).toEqual([]);
  });

  it('truncates signals to maxSignals', async () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      signal({ metric: `m_${i}`, value: i }),
    );
    let calledWith: string | undefined;
    const r = await generateHypotheses({
      signals: many,
      locale: 'en',
      llm: {
        async call({ user }) {
          calledWith = user;
          return { text: '[]', costMicros: 0 };
        },
      },
      maxSignals: 5,
    });
    expect(r.degraded).toBe(false);
    const parsed = JSON.parse(calledWith ?? '{}') as { signal_count: number };
    expect(parsed.signal_count).toBe(5);
  });
});
