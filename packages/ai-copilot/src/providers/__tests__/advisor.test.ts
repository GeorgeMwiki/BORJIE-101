/**
 * Tests for providers/advisor — executor + advisor pattern.
 *
 * Coverage: shouldAdvisorConsult heuristics, executor-only success path,
 * hard-category triggers advisor, low-confidence triggers advisor,
 * empty-executor triggers advisor, advisor-failure graceful degrade,
 * executor-failure short-circuit, totals math.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AdvisorExecutor,
  ADVISOR_HARD_CATEGORIES,
  shouldAdvisorConsult,
} from '../advisor.js';
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProvider,
  AIProviderError,
} from '../ai-provider.js';
import { aiOk, aiErr, asModelId, type AIResult } from '../../types/core.types.js';
import type { CompiledPrompt } from '../../types/prompt.types.js';

function response(
  overrides: Partial<AICompletionResponse> = {},
): AICompletionResponse {
  return {
    content: 'executor draft',
    modelId: asModelId('claude-sonnet-4-6'),
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    processingTimeMs: 200,
    finishReason: 'stop',
    ...overrides,
  };
}

function makeProvider(
  responses: AIResult<AICompletionResponse, AIProviderError>[],
): AIProvider {
  let i = 0;
  return {
    providerId: 'mock',
    supportedModels: ['claude-sonnet-4-6', 'claude-opus-4-6'],
    supportsModel: () => true,
    getModelInfo: () => null,
    healthCheck: async () => true,
    complete: vi.fn(async () => {
      const next = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return next;
    }),
  };
}

const baseRequest: AICompletionRequest = {
  prompt: {
    promptId: 'p-1' as CompiledPrompt['promptId'],
    version: '1',
    systemPrompt: 'sys',
    userPrompt: 'user',
    modelConfig: {
      modelId: 'claude-sonnet-4-6',
      maxTokens: 256,
      temperature: 0,
    },
    guardrails: undefined as unknown as CompiledPrompt['guardrails'],
  },
};

describe('shouldAdvisorConsult', () => {
  it('returns false for empty context', () => {
    expect(shouldAdvisorConsult({})).toBe(false);
  });

  it('returns true for any hard category', () => {
    for (const cat of ADVISOR_HARD_CATEGORIES) {
      expect(shouldAdvisorConsult({ category: cat })).toBe(true);
    }
  });

  it('returns true when executorConfidence is below the default 0.7', () => {
    expect(shouldAdvisorConsult({ executorConfidence: 0.5 })).toBe(true);
  });

  it('returns false when executorConfidence is at threshold', () => {
    expect(shouldAdvisorConsult({ executorConfidence: 0.7 })).toBe(false);
  });

  it('honours an explicit advisorThreshold override', () => {
    expect(
      shouldAdvisorConsult({
        executorConfidence: 0.85,
        advisorThreshold: 0.9,
      }),
    ).toBe(true);
  });

  it('honours the defaultThreshold parameter', () => {
    expect(shouldAdvisorConsult({ executorConfidence: 0.6 }, 0.5)).toBe(false);
  });
});

describe('AdvisorExecutor.run', () => {
  it('returns executor-only outcome when nothing triggers advisor', async () => {
    const executor = makeProvider([aiOk(response())]);
    const advisor = makeProvider([aiOk(response({ content: 'advisor draft' }))]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advisorConsulted).toBe(false);
      expect(result.data.finalContent).toBe('executor draft');
      expect(advisor.complete).not.toHaveBeenCalled();
    }
  });

  it('consults advisor when category is a hard category', async () => {
    const executor = makeProvider([aiOk(response())]);
    const advisor = makeProvider([aiOk(response({ content: 'final answer' }))]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, { category: 'legal_drafting' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advisorConsulted).toBe(true);
      expect(result.data.finalContent).toBe('final answer');
      expect(result.data.advisorReason).toBe('hard_category:legal_drafting');
    }
  });

  it('consults advisor when executorConfidence is below threshold', async () => {
    const executor = makeProvider([aiOk(response())]);
    const advisor = makeProvider([aiOk(response({ content: 'refined' }))]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, { executorConfidence: 0.3 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advisorConsulted).toBe(true);
      expect(result.data.advisorReason).toMatch(/low_confidence:0.3/);
    }
  });

  it('consults advisor when executor returned empty content', async () => {
    const executor = makeProvider([aiOk(response({ content: '   ' }))]);
    const advisor = makeProvider([aiOk(response({ content: 'fallback' }))]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advisorConsulted).toBe(true);
      expect(result.data.advisorReason).toBe('executor_empty');
    }
  });

  it('returns executor-only when advisor fails — gracefully degrades', async () => {
    const executor = makeProvider([aiOk(response())]);
    const advisor = makeProvider([
      aiErr({
        code: 'PROVIDER_ERROR',
        message: 'down',
        provider: 'opus',
        retryable: false,
      }),
    ]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, { category: 'legal_drafting' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.advisorConsulted).toBe(false);
      expect(result.data.finalContent).toBe('executor draft');
      expect(result.data.advisorReason).toBe('advisor_failed:PROVIDER_ERROR');
    }
  });

  it('propagates executor failure as an error result', async () => {
    const executor = makeProvider([
      aiErr({
        code: 'TIMEOUT',
        message: 'too slow',
        provider: 'sonnet',
        retryable: true,
      }),
    ]);
    const advisor = makeProvider([aiOk(response())]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, {});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('TIMEOUT');
    }
    expect(advisor.complete).not.toHaveBeenCalled();
  });

  it('sums tokens + processing time across both providers when consulted', async () => {
    const executor = makeProvider([
      aiOk(
        response({
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          processingTimeMs: 200,
        }),
      ),
    ]);
    const advisor = makeProvider([
      aiOk(
        response({
          content: 'advisor draft',
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          processingTimeMs: 400,
        }),
      ),
    ]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    const result = await ex.run(baseRequest, { category: 'legal_drafting' });
    if (result.success) {
      expect(result.data.totalTokens).toBe(450);
      expect(result.data.totalProcessingTimeMs).toBe(600);
    }
  });

  it('passes the executor draft into advisor.additionalContext', async () => {
    const executor = makeProvider([aiOk(response({ content: 'EXEC_OUT' }))]);
    const advisor = makeProvider([aiOk(response({ content: 'ADV_OUT' }))]);
    const ex = new AdvisorExecutor({ executorProvider: executor, advisorProvider: advisor });
    await ex.run(baseRequest, { category: 'legal_drafting' });
    expect(advisor.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalContext: expect.stringContaining('EXEC_OUT'),
      }),
    );
  });
});
