/**
 * counter-model-wiring — production wiring tests.
 *
 *   1. Returns null when the client is null (executor falls back to
 *      the legacy approval flow with no second-opinion overhead).
 *   2. Returns a working `CounterModel` when a client is supplied —
 *      the model's `review` calls the wrapped Anthropic client's
 *      `messages.create`.
 *   3. The modelId is overridable for tests / cost-tuning.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createProductionCounterModel,
  productionCounterModel,
} from '../counter-model-wiring';

describe('createProductionCounterModel', () => {
  it('returns null when the Anthropic client is null', () => {
    const reviewer = createProductionCounterModel(null);
    expect(reviewer).toBeNull();
  });

  it('returns a CounterModel that calls the supplied client', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ verdict: 'safe', reason: 'ok', confidence: 1 }),
        },
      ],
    }));
    const reviewer = createProductionCounterModel({
      messages: { create: create as unknown as never },
    });
    expect(reviewer).not.toBeNull();
    const outcome = await reviewer!.review({
      toolName: 't',
      payload: { x: 1 },
    });
    expect(outcome.verdict).toBe('safe');
    expect(create).toHaveBeenCalledOnce();
  });

  it('honours modelId / maxTokens overrides', async () => {
    const create = vi.fn(async () => ({
      content: [
        { type: 'text', text: JSON.stringify({ verdict: 'safe', reason: 'ok' }) },
      ],
    }));
    const reviewer = productionCounterModel(
      { messages: { create: create as unknown as never } },
      { modelId: 'claude-haiku-test', maxTokens: 64 },
    );
    await reviewer!.review({ toolName: 't', payload: {} });
    const [callArgs] = create.mock.calls[0] as [
      { model: string; max_tokens: number },
    ];
    expect(callArgs.model).toBe('claude-haiku-test');
    expect(callArgs.max_tokens).toBe(64);
  });
});
