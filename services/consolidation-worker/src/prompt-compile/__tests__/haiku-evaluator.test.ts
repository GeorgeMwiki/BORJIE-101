/**
 * haiku-evaluator — unit tests.
 *
 * Coverage:
 *   1. real-client clean JSON parses correctly
 *   2. real-client JSON-in-prose still parses
 *   3. real-client invalid JSON → heuristic fallback
 *   4. real-client API throw → center fallback w/ error reason
 *   5. heuristic bounded to [0.4, 0.6]
 *   6. heuristic score scales with token overlap
 *   7. score is clamped to [0, 1] on out-of-range model output
 *   8. empty response → heuristic fallback
 *   9. system prompt insists on strict JSON
 *   10. user prompt carries expected output + capability + golden id
 *   11. default model is the haiku 4.5 build
 *   12. parseEvaluatorResponse returns null for non-JSON
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createHaikuEvaluator,
  buildEvaluatorUserPrompt,
  parseEvaluatorResponse,
  heuristicScore,
  EVALUATOR_SYSTEM_PROMPT,
  DEFAULT_EVALUATOR_MODEL,
  HEURISTIC_CENTER,
  HEURISTIC_HALF_RANGE,
  type ClaudeMessagesClient,
  type GoldenCase,
} from '../haiku-evaluator.js';

function fakeClient(body: string): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: body }],
      })),
    },
  };
}

function throwingClient(msg: string): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => {
        throw new Error(msg);
      }),
    },
  };
}

const CASE: GoldenCase = {
  id: 'prorated-charge-1',
  input: 'tenant moves in mid-month',
  expectedOutput: 'TZS 320,000',
  capability: 'prorated-charge',
};

describe('createHaikuEvaluator', () => {
  it('parses a clean JSON response', async () => {
    const client = fakeClient(
      JSON.stringify({ score: 0.83, reasoning: 'close match' }),
    );
    const evalr = createHaikuEvaluator({ anthropicClient: client });
    const out = await evalr.score({
      candidatePrompt: 'You compute prorated rent.',
      goldenCase: CASE,
      expectedOutput: CASE.expectedOutput,
    });
    expect(out.score).toBeCloseTo(0.83);
    expect(out.reasoning).toBe('close match');
  });

  it('parses JSON wrapped in chatty prose', async () => {
    const client = fakeClient(
      'Sure thing — {"score": 0.42, "reasoning": "partial"} — done.',
    );
    const evalr = createHaikuEvaluator({ anthropicClient: client });
    const out = await evalr.score({
      candidatePrompt: 'X.',
      goldenCase: CASE,
      expectedOutput: CASE.expectedOutput,
    });
    expect(out.score).toBeCloseTo(0.42);
    expect(out.reasoning).toBe('partial');
  });

  it('falls back to heuristic on unparseable response', async () => {
    const client = fakeClient('utter nonsense');
    const evalr = createHaikuEvaluator({ anthropicClient: client });
    const out = await evalr.score({
      candidatePrompt: 'prorated charge candidate',
      goldenCase: CASE,
      expectedOutput: CASE.expectedOutput,
    });
    expect(out.score).toBeGreaterThanOrEqual(
      HEURISTIC_CENTER - HEURISTIC_HALF_RANGE,
    );
    expect(out.score).toBeLessThanOrEqual(
      HEURISTIC_CENTER + HEURISTIC_HALF_RANGE,
    );
  });

  it('falls back to center on API throw with reason carrying error', async () => {
    const evalr = createHaikuEvaluator({
      anthropicClient: throwingClient('rate-limit'),
    });
    const out = await evalr.score({
      candidatePrompt: 'X.',
      goldenCase: CASE,
      expectedOutput: CASE.expectedOutput,
    });
    expect(out.score).toBe(HEURISTIC_CENTER);
    expect(out.reasoning).toContain('rate-limit');
  });

  it('heuristic stays bounded inside [0.4, 0.6] regardless of inputs', () => {
    const inputs: ReadonlyArray<{ cand: string; expected: string }> = [
      { cand: '', expected: '' },
      { cand: 'x'.repeat(1000), expected: 'y' },
      { cand: 'identical', expected: 'identical' },
      { cand: 'prorated charge prorated', expected: 'TZS 320,000' },
      { cand: 'tz 320 000 prorated charge', expected: 'TZS 320,000' },
    ];
    for (const { cand, expected } of inputs) {
      const out = heuristicScore({
        candidatePrompt: cand,
        goldenCase: { ...CASE, expectedOutput: expected },
        expectedOutput: expected,
      });
      expect(out.score).toBeGreaterThanOrEqual(
        HEURISTIC_CENTER - HEURISTIC_HALF_RANGE,
      );
      expect(out.score).toBeLessThanOrEqual(
        HEURISTIC_CENTER + HEURISTIC_HALF_RANGE,
      );
    }
  });

  it('heuristic score increases with token overlap', () => {
    const low = heuristicScore({
      candidatePrompt: 'zzz zzz zzz',
      goldenCase: CASE,
      expectedOutput: 'alpha beta gamma delta',
    });
    const high = heuristicScore({
      candidatePrompt: 'alpha beta gamma delta',
      goldenCase: CASE,
      expectedOutput: 'alpha beta gamma delta',
    });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('clamps out-of-range model score to [0, 1]', async () => {
    const client1 = fakeClient(JSON.stringify({ score: 7.5, reasoning: 'r' }));
    const evalr1 = createHaikuEvaluator({ anthropicClient: client1 });
    const out1 = await evalr1.score({
      candidatePrompt: 'X.',
      goldenCase: CASE,
      expectedOutput: 'Y',
    });
    expect(out1.score).toBe(1);

    const client2 = fakeClient(JSON.stringify({ score: -2, reasoning: 'r' }));
    const evalr2 = createHaikuEvaluator({ anthropicClient: client2 });
    const out2 = await evalr2.score({
      candidatePrompt: 'X.',
      goldenCase: CASE,
      expectedOutput: 'Y',
    });
    expect(out2.score).toBe(0);
  });

  it('empty model body falls back to heuristic', async () => {
    const client = fakeClient('');
    const evalr = createHaikuEvaluator({ anthropicClient: client });
    const out = await evalr.score({
      candidatePrompt: 'X.',
      goldenCase: CASE,
      expectedOutput: 'Y',
    });
    expect(out.reasoning).toMatch(/heuristic/);
  });

  it('system prompt insists on strict JSON output shape', () => {
    expect(EVALUATOR_SYSTEM_PROMPT).toMatch(/STRICT JSON/i);
    expect(EVALUATOR_SYSTEM_PROMPT).toMatch(/score/i);
    expect(EVALUATOR_SYSTEM_PROMPT).toMatch(/reasoning/i);
  });

  it('user prompt carries expected output + capability + golden id', () => {
    const u = buildEvaluatorUserPrompt({
      candidatePrompt: 'Candidate prompt body.',
      goldenCase: CASE,
      expectedOutput: 'TZS 320,000',
    });
    expect(u).toContain('TZS 320,000');
    expect(u).toContain('prorated-charge');
    expect(u).toContain('prorated-charge-1');
    expect(u).toContain('Candidate prompt body');
  });

  it('uses haiku 4.5 model by default', () => {
    expect(DEFAULT_EVALUATOR_MODEL).toMatch(/haiku-4-5/);
  });

  it('parseEvaluatorResponse returns null on non-JSON', () => {
    expect(parseEvaluatorResponse('hello world')).toBeNull();
    expect(parseEvaluatorResponse('')).toBeNull();
    expect(
      parseEvaluatorResponse('{ "score": "not a number", "reasoning": "x" }'),
    ).toBeNull();
  });
});
