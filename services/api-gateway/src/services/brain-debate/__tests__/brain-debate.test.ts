/**
 * brain-debate — unit tests for high-stakes routing + debate orchestration.
 */
import { describe, expect, it, vi } from 'vitest';
import { isHighStakes, runDebate } from '../index.js';
import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
} from '@borjie/brain-llm-router';

function makeClient(replyText: string, errMsg?: string): BrainLLMClient {
  return {
    async invoke(_req: BrainLLMRequest): Promise<BrainLLMResponse> {
      if (errMsg) throw new Error(errMsg);
      return {
        id: 'r',
        model: 'm',
        role: 'assistant',
        content: [{ type: 'text', text: replyText }],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        raw: {},
      };
    },
  };
}

describe('isHighStakes', () => {
  it.each([
    'file with TRA',
    'submit royalty for January',
    'wire USD 5000 to supplier',
    'hire driller for new shaft',
    'sign the contract today',
    'wasilisha kwa NEMC',
    'lipa mrabaha wa Januari',
    'ajiri mfanyakazi mpya',
    'saini mkataba huu',
  ])('flags "%s" as high stakes', (msg) => {
    expect(isHighStakes(msg)).toBe(true);
  });

  it.each([
    'how does payroll work?',
    'what is the LBMA gold price today?',
    'good morning',
    '',
    null,
    undefined,
  ])('does not flag "%s"', (msg) => {
    expect(isHighStakes(msg as string | null | undefined)).toBe(false);
  });
});

describe('runDebate', () => {
  const baseInput = {
    messages: [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'submit royalty for Jan' }],
      },
    ],
    system: 'sys',
  };

  it('returns the sole survivor when 2 providers fail', async () => {
    const result = await runDebate(
      [
        { provider: 'anthropic', model: 'a', client: makeClient('hello world from anthropic') },
        { provider: 'openai', model: 'o', client: makeClient('', 'boom') },
        { provider: 'deepseek', model: 'd', client: makeClient('', 'boom') },
      ],
      baseInput,
    );
    expect(result.winner.provider).toBe('anthropic');
    expect(result.verified).toBe(false);
    expect(result.scores).toHaveLength(1);
  });

  it('throws when every contender fails', async () => {
    await expect(
      runDebate(
        [
          { provider: 'anthropic', model: 'a', client: makeClient('', 'boom1') },
          { provider: 'openai', model: 'o', client: makeClient('', 'boom2') },
        ],
        baseInput,
      ),
    ).rejects.toThrow(/every contender failed/);
  });

  it('uses judge JSON to pick the winner', async () => {
    const judgeVerdict = JSON.stringify({
      scores: [
        { provider: 'anthropic', score: 0.9, reason: 'cited TRA' },
        { provider: 'openai', score: 0.7, reason: 'vague' },
      ],
      winner: 'anthropic',
      winnerReason: 'cites TRA correctly',
    });
    let calls = 0;
    const judge = vi.fn(async (_req: BrainLLMRequest): Promise<BrainLLMResponse> => {
      calls += 1;
      if (calls === 1) {
        return {
          id: 'r',
          model: 'm',
          role: 'assistant',
          content: [{ type: 'text', text: 'anthropic answer with TRA citation' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          raw: {},
        };
      }
      return {
        id: 'r',
        model: 'm',
        role: 'assistant',
        content: [{ type: 'text', text: judgeVerdict }],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
        raw: {},
      };
    });
    const result = await runDebate(
      [
        { provider: 'anthropic', model: 'a', client: { invoke: judge } },
        { provider: 'openai', model: 'o', client: makeClient('openai answer, vague') },
      ],
      baseInput,
    );
    expect(result.winner.provider).toBe('anthropic');
    expect(result.scores).toHaveLength(2);
    expect(result.trace.winnerReason).toBe('cites TRA correctly');
    expect(result.verified).toBe(true);
  });

  it('falls back to fastest survivor when judge returns unparseable JSON', async () => {
    let invocations = 0;
    const slowAnthropic: BrainLLMClient = {
      async invoke() {
        invocations += 1;
        if (invocations === 1) {
          await new Promise((r) => setTimeout(r, 25));
          return {
            id: 'r',
            model: 'm',
            role: 'assistant',
            content: [{ type: 'text', text: 'slow' }],
            stopReason: 'end_turn',
            usage: { inputTokens: 0, outputTokens: 0 },
            raw: {},
          };
        }
        return {
          id: 'r',
          model: 'm',
          role: 'assistant',
          content: [{ type: 'text', text: 'not json at all' }],
          stopReason: 'end_turn',
          usage: { inputTokens: 0, outputTokens: 0 },
          raw: {},
        };
      },
    };
    const fastOpenai = makeClient('fast');
    const result = await runDebate(
      [
        { provider: 'anthropic', model: 'a', client: slowAnthropic },
        { provider: 'openai', model: 'o', client: fastOpenai },
      ],
      baseInput,
    );
    expect(result.winner.provider).toBe('openai');
    expect(result.trace.winnerReason).toContain('judge-unavailable');
    expect(result.verified).toBe(true);
  });
});
