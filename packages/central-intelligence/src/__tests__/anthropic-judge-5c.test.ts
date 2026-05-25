/**
 * Anthropic judge 5-C rubric tests — Phase D / D12.7.
 *
 * Confirms the judge:
 *   - asks the model for the 5-C rubric in its system prompt;
 *   - parses the rubric when present;
 *   - clamps each axis to [0,1];
 *   - identifies the weakest axis;
 *   - degrades to legacy single-score shape when the rubric is absent.
 */

import { describe, it, expect } from 'vitest';
import { createAnthropicJudge } from '../kernel/sensors/anthropic-judge.js';
import type { AnthropicMessagesClient } from '../kernel/sensors/anthropic-sensor.js';

function clientReturning(text: string): AnthropicMessagesClient {
  return {
    messages: {
      async create(args: { model: string }) {
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: args.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text }],
        };
      },
    },
  } as unknown as AnthropicMessagesClient;
}

describe('anthropic-judge — 5-C rubric extension', () => {
  it('parses a full 5-C rubric and identifies the weakest axis', async () => {
    const body = JSON.stringify({
      score: 0.78,
      reasonText: 'mostly good',
      suggestedFix: 'cite the late-fee clause',
      rubric: {
        completeness: 0.9,
        correctness: 0.95,
        citations: 0.4,
        consistency: 0.8,
        candor: 0.85,
      },
    });
    const judge = createAnthropicJudge(clientReturning(body));
    const verdict = await judge('Late fee is 5% per lease.');
    expect(verdict.score).toBeCloseTo(0.78, 2);
    expect(verdict.rubric).toBeDefined();
    expect(verdict.rubric?.citations).toBeCloseTo(0.4, 2);
    expect(verdict.weakestAxis).toBe('citations');
  });

  it('clamps out-of-range rubric values to [0,1]', async () => {
    const body = JSON.stringify({
      score: 0.5,
      reasonText: '',
      suggestedFix: '',
      rubric: {
        completeness: 1.5, // > 1
        correctness: -0.2, // < 0
        citations: 0.5,
        consistency: 0.5,
        candor: 0.5,
      },
    });
    const judge = createAnthropicJudge(clientReturning(body));
    const verdict = await judge('draft');
    expect(verdict.rubric?.completeness).toBe(1);
    expect(verdict.rubric?.correctness).toBe(0);
  });

  it('drops the rubric when one axis is non-numeric', async () => {
    const body = JSON.stringify({
      score: 0.5,
      reasonText: '',
      suggestedFix: '',
      rubric: {
        completeness: 0.9,
        correctness: 0.9,
        citations: 'high', // bad shape
        consistency: 0.9,
        candor: 0.9,
      },
    });
    const judge = createAnthropicJudge(clientReturning(body));
    const verdict = await judge('draft');
    expect(verdict.rubric).toBeUndefined();
    expect(verdict.weakestAxis).toBeUndefined();
    expect(verdict.score).toBeCloseTo(0.5, 2);
  });

  it('falls back to legacy shape (no rubric) when the model omits the field', async () => {
    const body = JSON.stringify({
      score: 0.9,
      reasonText: 'looks good',
      suggestedFix: '',
    });
    const judge = createAnthropicJudge(clientReturning(body));
    const verdict = await judge('draft');
    expect(verdict.score).toBeCloseTo(0.9, 2);
    expect(verdict.rubric).toBeUndefined();
  });

  it('identifies completeness as the weakest axis when it is the lowest', async () => {
    const body = JSON.stringify({
      score: 0.6,
      reasonText: '',
      suggestedFix: '',
      rubric: {
        completeness: 0.3,
        correctness: 0.95,
        citations: 0.8,
        consistency: 0.9,
        candor: 0.9,
      },
    });
    const judge = createAnthropicJudge(clientReturning(body));
    const verdict = await judge('draft');
    expect(verdict.weakestAxis).toBe('completeness');
  });
});
