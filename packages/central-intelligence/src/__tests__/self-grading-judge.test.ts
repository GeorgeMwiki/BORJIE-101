/**
 * Self-grading judge tests — Phase D / D12.6.
 */

import { describe, it, expect } from 'vitest';
import {
  createSelfGradingJudge,
  __test as selfGradingTest,
} from '../kernel/sensors/self-grading-judge.js';
import type { AnthropicMessagesClient } from '../kernel/sensors/anthropic-sensor.js';

function stubClient(responseText: string): AnthropicMessagesClient {
  return {
    messages: {
      async create(_args) {
        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: _args.model,
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
          content: [{ type: 'text', text: responseText }],
        };
      },
    },
  } as unknown as AnthropicMessagesClient;
}

function throwingClient(): AnthropicMessagesClient {
  return {
    messages: {
      async create() {
        throw new Error('upstream unavailable');
      },
    },
  } as unknown as AnthropicMessagesClient;
}

describe('self-grading judge', () => {
  it('returns kill verdict + score 0 + suggested rewrite for empty drafts', async () => {
    const grade = createSelfGradingJudge(stubClient('{}'));
    const r = await grade('   ');
    expect(r.verdict).toBe('kill');
    expect(r.score).toBe(0);
    expect(r.suggestedRewrite.length).toBeGreaterThan(0);
  });

  it('parses a ship verdict end-to-end', async () => {
    const body = JSON.stringify({
      verdict: 'ship',
      score: 0.91,
      rationale: 'all numbers are cited',
      suggestedRewrite: '',
    });
    const grade = createSelfGradingJudge(stubClient(body));
    const r = await grade('Rent is due on the 5th per lease clause 2.1.');
    expect(r.verdict).toBe('ship');
    expect(r.score).toBeCloseTo(0.91, 2);
    expect(r.suggestedRewrite).toBe('');
  });

  it('parses a ship-with-reservations verdict', async () => {
    const body = JSON.stringify({
      verdict: 'ship-with-reservations',
      score: 0.7,
      rationale: 'one number lacked an explicit citation',
      suggestedRewrite: 'Cite the lease clause for the late fee.',
    });
    const grade = createSelfGradingJudge(stubClient(body));
    const r = await grade('Late fee is 5%.');
    expect(r.verdict).toBe('ship-with-reservations');
    expect(r.suggestedRewrite).toContain('Cite');
  });

  it('parses a kill verdict and exposes the rewrite hint', async () => {
    const body = JSON.stringify({
      verdict: 'kill',
      score: 0.3,
      rationale: 'I fabricated a tenant phone number',
      suggestedRewrite: 'Remove the fabricated phone number; surface the unknown.',
    });
    const grade = createSelfGradingJudge(stubClient(body));
    const r = await grade('Call the tenant on 0712...');
    expect(r.verdict).toBe('kill');
    expect(r.score).toBeLessThan(0.5);
    expect(r.suggestedRewrite.length).toBeGreaterThan(0);
  });

  it('defaults to ship + score 1 on upstream errors', async () => {
    const grade = createSelfGradingJudge(throwingClient());
    const r = await grade('some draft');
    expect(r.verdict).toBe('ship');
    expect(r.score).toBe(1);
  });

  it('defaults to ship when verdict string is unknown', async () => {
    const body = JSON.stringify({
      verdict: 'whatever',
      score: 0.7,
      rationale: 'r',
      suggestedRewrite: '',
    });
    const grade = createSelfGradingJudge(stubClient(body));
    const r = await grade('draft');
    expect(r.verdict).toBe('ship');
  });

  it('parser is exported and tolerates malformed JSON', () => {
    const r = selfGradingTest.parseSelfGrade('not json at all');
    expect(r.verdict).toBe('ship');
    expect(r.score).toBe(1);
  });

  it('system prompt frames the model as the author of the draft', () => {
    expect(selfGradingTest.SELF_GRADING_SYSTEM_PROMPT).toContain('YOUR OWN');
    expect(selfGradingTest.SELF_GRADING_SYSTEM_PROMPT).toContain('regulator');
  });

  it('passes the configured modelId through to the client', async () => {
    const seen: { model?: string } = {};
    const client = {
      messages: {
        async create(args: { model: string; max_tokens: number; system: string; messages: ReadonlyArray<unknown> }) {
          seen.model = args.model;
          return {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: args.model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
            content: [{ type: 'text', text: '{"verdict":"ship","score":1,"rationale":"ok","suggestedRewrite":""}' }],
          };
        },
      },
    } as unknown as AnthropicMessagesClient;
    const grade = createSelfGradingJudge(client, { modelId: 'claude-sonnet-4-5' });
    await grade('draft');
    expect(seen.model).toBe('claude-sonnet-4-5');
  });

});
