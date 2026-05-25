/**
 * Tests for providers/budget-guard.
 *
 * Coverage: pre-flight assertWithinBudget, recordUsage with token counts,
 * ledger record-failure does NOT bubble up, missing tenant id throws,
 * priceEstimator default zero, custom provider label, defaultModel pass-through.
 */

import { describe, it, expect, vi } from 'vitest';
import { withBudgetGuard } from '../budget-guard.js';
import type {
  AnthropicClient,
  AnthropicMessageRequest,
  AnthropicMessageResponse,
  AnthropicSdkLike,
} from '../anthropic-client.js';
import type { CostLedger } from '../../cost-ledger.js';

function makeResponse(): AnthropicMessageResponse {
  return {
    id: 'msg-1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'hello' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function makeInner(
  overrides: { create?: AnthropicSdkLike['messages']['create'] } = {},
): AnthropicClient {
  const create =
    overrides.create ??
    (async (_req: AnthropicMessageRequest) => makeResponse());
  return {
    defaultModel: 'claude-sonnet-4-6',
    sdk: { messages: { create } },
  };
}

function makeLedger(
  overrides: Partial<CostLedger> = {},
): CostLedger & {
  assertWithinBudget: ReturnType<typeof vi.fn>;
  recordUsage: ReturnType<typeof vi.fn>;
} {
  const assertWithinBudget = vi.fn(async () => undefined);
  const recordUsage = vi.fn(async () => ({} as never));
  return {
    assertWithinBudget,
    recordUsage,
    currentMonthSpend: vi.fn(async () => 0),
    isOverBudget: vi.fn(async () => false),
    setBudget: vi.fn(async () => undefined),
    ...(overrides as Partial<CostLedger>),
  } as unknown as CostLedger & {
    assertWithinBudget: ReturnType<typeof vi.fn>;
    recordUsage: ReturnType<typeof vi.fn>;
  };
}

const request: AnthropicMessageRequest = {
  model: 'claude-sonnet-4-6',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'hi' }],
};

describe('withBudgetGuard', () => {
  it('preserves the inner defaultModel', () => {
    const guarded = withBudgetGuard(makeInner(), {
      ledger: makeLedger(),
      context: () => ({ tenantId: 't1' }),
    });
    expect(guarded.defaultModel).toBe('claude-sonnet-4-6');
  });

  it('asserts budget before forwarding to the SDK', async () => {
    const callOrder: string[] = [];
    const ledger = makeLedger({
      assertWithinBudget: vi.fn(async () => {
        callOrder.push('assert');
      }),
    });
    const innerCreate = vi.fn(async () => {
      callOrder.push('create');
      return makeResponse();
    });
    const guarded = withBudgetGuard(makeInner({ create: innerCreate }), {
      ledger,
      context: () => ({ tenantId: 't1' }),
    });
    await guarded.sdk.messages.create(request);
    expect(callOrder).toEqual(['assert', 'create']);
    expect(ledger.assertWithinBudget).toHaveBeenCalledWith('t1');
  });

  it('records usage with token counts after a successful call', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1', operation: 'op-x', correlationId: 'c-1' }),
    });
    await guarded.sdk.messages.create(request);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        inputTokens: 100,
        outputTokens: 50,
        costUsdMicro: 0,
        operation: 'op-x',
        correlationId: 'c-1',
      }),
    );
  });

  it('uses the custom provider label when supplied', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1' }),
      provider: 'anthropic-vertex',
    });
    await guarded.sdk.messages.create(request);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic-vertex' }),
    );
  });

  it('runs the priceEstimator and rounds to non-negative integer microdollars', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1' }),
      priceEstimator: ({ inputTokens, outputTokens }) =>
        inputTokens * 1 + outputTokens * 2 + 0.4, // 100 + 100 + 0.4 → round to 200
    });
    await guarded.sdk.messages.create(request);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsdMicro: 200 }),
    );
  });

  it('clamps a negative price to 0', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1' }),
      priceEstimator: () => -5,
    });
    await guarded.sdk.messages.create(request);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ costUsdMicro: 0 }),
    );
  });

  it('throws when context() returns no tenantId', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: '' }),
    });
    await expect(guarded.sdk.messages.create(request)).rejects.toThrow(
      /no tenantId/,
    );
  });

  it('does NOT swallow assertWithinBudget errors', async () => {
    const ledger = makeLedger({
      assertWithinBudget: vi.fn(async () => {
        throw new Error('over budget');
      }),
    });
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1' }),
    });
    await expect(guarded.sdk.messages.create(request)).rejects.toThrow(
      'over budget',
    );
  });

  it('does NOT bubble up recordUsage failures (logged + swallowed)', async () => {
    const ledger = makeLedger({
      recordUsage: vi.fn(async () => {
        throw new Error('write failed');
      }),
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const guarded = withBudgetGuard(makeInner(), {
      ledger,
      context: () => ({ tenantId: 't1' }),
    });
    const response = await guarded.sdk.messages.create(request);
    expect(response).toEqual(makeResponse());
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('handles a response with no usage block (treats tokens as 0)', async () => {
    const ledger = makeLedger();
    const guarded = withBudgetGuard(
      makeInner({
        create: async () => ({
          ...makeResponse(),
          usage: undefined as unknown as AnthropicMessageResponse['usage'],
        }),
      }),
      { ledger, context: () => ({ tenantId: 't1' }) },
    );
    await guarded.sdk.messages.create(request);
    expect(ledger.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
    );
  });

  it('returns the raw inner response untouched', async () => {
    const expected = makeResponse();
    const guarded = withBudgetGuard(
      makeInner({ create: async () => expected }),
      {
        ledger: makeLedger(),
        context: () => ({ tenantId: 't1' }),
      },
    );
    const response = await guarded.sdk.messages.create(request);
    expect(response).toBe(expected);
  });
});
