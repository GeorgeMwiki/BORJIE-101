/**
 * Unit + integration tests for hedged-requests/.
 *
 * Coverage:
 *   - primary returns fast -> primary wins, secondary never fired
 *   - primary slow -> secondary fires after hedge window, secondary wins
 *   - primary fails -> secondary used
 *   - both fail -> HEDGED_BOTH_FAILED
 *   - hedgeAfterMs < 0 -> INVALID_REQUEST
 *   - wasHedged flag accurate
 */

import { describe, expect, it } from 'vitest';
import { hedgedInvoke } from './hedged-invoke.js';
import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';

function delayedClient(
  provider: ProviderName,
  delayMs: number,
  text: string,
  shouldFail = false
): BrainLLMClient {
  return {
    provider,
    invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => {
      await new Promise((r) => setTimeout(r, delayMs));
      if (shouldFail) throw new Error(`${provider} simulated failure`);
      return {
        id: 'msg',
        model: req.model,
        provider,
        content: [{ type: 'text', text }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: delayMs,
      };
    },
  };
}

const baseReq: BrainLLMRequest = {
  model: 'anthropic/claude-haiku-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }] }],
};

describe('hedgedInvoke', () => {
  it('primary returns before hedge window -> primary wins, no hedge fired', async () => {
    const primary = delayedClient('anthropic', 5, 'fast-primary');
    const secondary = delayedClient('openai', 100, 'should-not-fire');
    // Use a low hedgeAfterMs but primary still faster.
    const res = await hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: 30 });
    expect(res.winner).toBe('primary');
    expect(res.wasHedged).toBe(false);
    expect((res.response.content[0] as { text: string }).text).toBe('fast-primary');
  });

  it('primary is slow -> secondary fires and may win', async () => {
    const primary = delayedClient('anthropic', 100, 'slow-primary');
    const secondary = delayedClient('openai', 10, 'fast-secondary');
    const res = await hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: 20 });
    expect(res.wasHedged).toBe(true);
    expect(res.winner).toBe('secondary');
    expect((res.response.content[0] as { text: string }).text).toBe('fast-secondary');
  });

  it('primary fails -> falls back to secondary response', async () => {
    const primary = delayedClient('anthropic', 5, 'fails', true);
    const secondary = delayedClient('openai', 30, 'fallback-ok');
    const res = await hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: 20 });
    expect(res.winner).toBe('secondary');
    expect(res.response.provider).toBe('openai');
  });

  it('both fail -> HEDGED_BOTH_FAILED', async () => {
    const primary = delayedClient('anthropic', 5, '', true);
    const secondary = delayedClient('openai', 5, '', true);
    await expect(
      hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: 10 })
    ).rejects.toMatchObject({ code: 'HEDGED_BOTH_FAILED' });
  });

  it('rejects negative hedgeAfterMs', async () => {
    const primary = delayedClient('anthropic', 1, 'a');
    const secondary = delayedClient('openai', 1, 'b');
    await expect(
      hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: -1 })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('no double-bill: winner is the only billed response in result', async () => {
    const primary = delayedClient('anthropic', 5, 'primary');
    const secondary = delayedClient('openai', 100, 'never');
    const res = await hedgedInvoke(baseReq, { primary, secondary, hedgeAfterMs: 50 });
    // wasHedged false (50ms > 5ms primary return) means secondary never fired.
    expect(res.wasHedged).toBe(false);
    expect(res.primaryLatencyMs).toBeDefined();
    expect(res.secondaryLatencyMs).toBeUndefined();
  });
});
