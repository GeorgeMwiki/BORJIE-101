/**
 * Multi-LLM router tests (Wave 11).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMultiLLMRouter,
  type MultiLLMRouterDeps,
  type ProviderRegistration,
} from '../providers/multi-llm-router.js';
import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
  ModelInfo,
} from '../providers/ai-provider.js';
import { asModelId, type AIResult } from '../types/core.types.js';
import {
  createCostLedger,
  type AiCostEntry,
  type CostLedgerRepository,
  type TenantAiBudget,
} from '../cost-ledger.js';
import { asPromptId } from '../types/core.types.js';
import type { CompiledPrompt } from '../types/prompt.types.js';

const compiled: CompiledPrompt = {
  promptId: asPromptId('test'),
  version: '1',
  systemPrompt: 'sys',
  userPrompt: 'hi',
  modelConfig: { modelId: '', maxTokens: 100, temperature: 0.5 },
  guardrails: {},
};

function makeRepo() {
  const entries: AiCostEntry[] = [];
  const budgets = new Map<string, TenantAiBudget>();
  const repo: CostLedgerRepository = {
    async insertEntry(entry) {
      entries.push({ ...entry });
      return { ...entry };
    },
    async sumUsage(tenantId, from, to) {
      const scoped = entries.filter(
        (e) =>
          e.tenantId === tenantId &&
          new Date(e.occurredAt).getTime() >= from.getTime() &&
          new Date(e.occurredAt).getTime() < to.getTime()
      );
      return {
        totalCostUsdMicro: scoped.reduce((a, b) => a + b.costUsdMicro, 0),
        totalInputTokens: scoped.reduce((a, b) => a + b.inputTokens, 0),
        totalOutputTokens: scoped.reduce((a, b) => a + b.outputTokens, 0),
        callCount: scoped.length,
        byModel: scoped.reduce(
          (acc, e) => {
            acc[e.model] ??= { cost: 0, calls: 0 };
            acc[e.model].cost += e.costUsdMicro;
            acc[e.model].calls += 1;
            return acc;
          },
          {} as Record<string, { cost: number; calls: number }>
        ),
      };
    },
    async listRecent(tenantId, limit) {
      return entries.filter((e) => e.tenantId === tenantId).slice(-limit);
    },
    async getBudget(tenantId) {
      return budgets.get(tenantId) ?? null;
    },
    async upsertBudget(budget) {
      budgets.set(budget.tenantId, budget);
      return budget;
    },
  };
  return { entries, budgets, repo };
}

function stubProvider(
  id: string,
  behavior: (req: AICompletionRequest) => AIResult<AICompletionResponse, AIProviderError>
): AIProvider {
  return {
    providerId: id,
    supportedModels: ['any'],
    async complete(req) {
      return behavior(req);
    },
    supportsModel: () => true,
    getModelInfo: () =>
      ({
        id: 'any',
        displayName: 'any',
        contextWindow: 1000,
        maxOutputTokens: 100,
        supportsJson: false,
        supportsVision: false,
        costPer1kPromptTokens: 0,
        costPer1kCompletionTokens: 0,
        tier: 'basic',
      }) as ModelInfo,
    healthCheck: async () => true,
  };
}

function okResp(modelId: string, tokensIn = 10, tokensOut = 5): AIResult<AICompletionResponse, AIProviderError> {
  return {
    success: true,
    data: {
      content: 'ok',
      modelId: asModelId(modelId),
      usage: { promptTokens: tokensIn, completionTokens: tokensOut, totalTokens: tokensIn + tokensOut },
      processingTimeMs: 1,
      finishReason: 'stop',
    },
  };
}
function errResp(provider: string, code: AIProviderError['code'], retryable: boolean): AIResult<AICompletionResponse, AIProviderError> {
  return { success: false, error: { code, message: 'fail', provider, retryable } };
}

function makeRegistration(provider: AIProvider, preferred: Record<string, string>): ProviderRegistration {
  return {
    provider,
    preferredModels: preferred as any,
    pricing: { 'claude-sonnet-4-6': { promptPer1k: 0.003, completionPer1k: 0.015 } },
  };
}

describe('MultiLLMRouter.pick', () => {
  it('routes analysis to anthropic by default', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', () => okResp('claude-sonnet-4-6'));
    const oa = stubProvider('openai', () => okResp('gpt-4o'));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 'claude-sonnet-4-6', conversation: 'claude-haiku-4-5-20251001' }),
        openai: makeRegistration(oa, { analysis: 'gpt-4o', conversation: 'gpt-4o-mini' }),
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis' });
    expect(pick?.providerId).toBe('anthropic');
    expect(pick?.modelId).toBe('claude-sonnet-4-6');
  });

  it('routes conversation to openai by default', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', () => okResp('claude-haiku-4-5-20251001'));
    const oa = stubProvider('openai', () => okResp('gpt-4o-mini'));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { conversation: 'claude-haiku-4-5-20251001' }),
        openai: makeRegistration(oa, { conversation: 'gpt-4o-mini' }),
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'conversation' });
    expect(pick?.providerId).toBe('openai');
  });

  it('routes batch to deepseek when available', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ds = stubProvider('deepseek', () => okResp('deepseek-chat'));
    const router = createMultiLLMRouter({
      providers: {
        deepseek: makeRegistration(ds, { batch: 'deepseek-chat' }),
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'batch' });
    expect(pick?.providerId).toBe('deepseek');
  });

  it('cheap cost budget bumps deepseek to front', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', () => okResp('s'));
    const ds = stubProvider('deepseek', () => okResp('d'));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 's' }),
        deepseek: makeRegistration(ds, { analysis: 'd' }),
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis', costBudget: 'cheap' });
    expect(pick?.providerId).toBe('deepseek');
  });

  it('returns null when no providers registered', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const router = createMultiLLMRouter({ providers: {}, ledger });
    expect(router.pick({ taskType: 'analysis' })).toBeNull();
  });
});

describe('MultiLLMRouter.complete', () => {
  let ledger: ReturnType<typeof createCostLedger>;
  let entries: AiCostEntry[];
  beforeEach(() => {
    const { repo, entries: e } = makeRepo();
    entries = e;
    ledger = createCostLedger({ repo });
  });

  it('records usage per tenant on success', async () => {
    const ant = stubProvider('anthropic', () => okResp('claude-sonnet-4-6', 100, 50));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 'claude-sonnet-4-6' }),
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1', operation: 'analysis-op' },
      hints: { taskType: 'analysis' },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0].tenantId).toBe('t1');
    expect(entries[0].provider).toBe('anthropic');
    expect(entries[0].model).toBe('claude-sonnet-4-6');
    expect(entries[0].inputTokens).toBe(100);
    expect(entries[0].outputTokens).toBe(50);
    expect(entries[0].costUsdMicro).toBeGreaterThan(0);
  });

  it('falls back to next provider on retryable error', async () => {
    const ant = stubProvider('anthropic', () =>
      errResp('anthropic', 'RATE_LIMIT', true)
    );
    const oa = stubProvider('openai', () => okResp('gpt-4o-mini', 10, 5));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { conversation: 'claude-haiku-4-5-20251001' }),
        openai: makeRegistration(oa, { conversation: 'gpt-4o-mini' }),
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1' },
      hints: { taskType: 'conversation' },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.providerId).toBe('openai');
    }
  });

  it('stops falling back on non-retryable error', async () => {
    const ant = stubProvider('anthropic', () =>
      errResp('anthropic', 'CONTEXT_LENGTH', false)
    );
    const oa = stubProvider('openai', () => okResp('gpt-4o'));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 'claude-sonnet-4-6' }),
        openai: makeRegistration(oa, { analysis: 'gpt-4o' }),
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1' },
      hints: { taskType: 'analysis' },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.code).toBe('CONTEXT_LENGTH');
  });

  it('short-circuits when tenant is over budget', async () => {
    await ledger.setBudget('t1', 1_000, { hardStop: true });
    // Pre-seed ledger with one big spend so any future call is blocked.
    await ledger.recordUsage({
      tenantId: 't1',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsdMicro: 5_000,
    });
    const ant = stubProvider('anthropic', () => okResp('claude-sonnet-4-6'));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 'claude-sonnet-4-6' }),
      },
      ledger,
    });
    await expect(
      router.complete({
        context: { tenantId: 't1' },
        hints: { taskType: 'analysis' },
        request: { prompt: compiled },
      })
    ).rejects.toMatchObject({ code: 'AI_BUDGET_EXCEEDED' });
  });

  it('tenant A usage does not leak into tenant B summary', async () => {
    const ant = stubProvider('anthropic', () => okResp('claude-sonnet-4-6', 100, 50));
    const router = createMultiLLMRouter({
      providers: {
        anthropic: makeRegistration(ant, { analysis: 'claude-sonnet-4-6' }),
      },
      ledger,
    });
    await router.complete({
      context: { tenantId: 'tenantA' },
      hints: { taskType: 'analysis' },
      request: { prompt: compiled },
    });
    const sumA = await ledger.currentMonthSpend('tenantA');
    const sumB = await ledger.currentMonthSpend('tenantB');
    expect(sumA.callCount).toBe(1);
    expect(sumB.callCount).toBe(0);
  });
});

describe('OpenAIChatProvider + DeepSeekProvider construction', () => {
  it('OpenAIChatProvider throws without apiKey', async () => {
    const { OpenAIChatProvider } = await import('../providers/openai.js');
    expect(() => new OpenAIChatProvider({ apiKey: '' })).toThrow();
  });
  it('DeepSeekProvider throws without apiKey', async () => {
    const { DeepSeekProvider } = await import('../providers/deepseek.js');
    expect(() => new DeepSeekProvider({ apiKey: '' })).toThrow();
  });
  it('OpenAIChatProvider parses a 200 response and returns content', async () => {
    const { OpenAIChatProvider } = await import('../providers/openai.js');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
        { status: 200 }
      )
    ) as typeof globalThis.fetch;
    try {
      const p = new OpenAIChatProvider({ apiKey: 'sk-test', maxRetries: 0 });
      const r = await p.complete({ prompt: compiled });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.content).toBe('hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  it('DeepSeekProvider parses a 200 response', async () => {
    const { DeepSeekProvider } = await import('../providers/deepseek.js');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ds-ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200 }
      )
    ) as typeof globalThis.fetch;
    try {
      const p = new DeepSeekProvider({ apiKey: 'ds-test', maxRetries: 0 });
      const r = await p.complete({ prompt: compiled });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.content).toBe('ds-ok');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
