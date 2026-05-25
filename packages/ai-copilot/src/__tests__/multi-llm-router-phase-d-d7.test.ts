/**
 * Phase D D7 — Multi-LLM router additions.
 *
 *   - Tenant-tier-aware pick() (Opus 4.7 / Sonnet 4.6 / Haiku 4.5)
 *   - Per-sensor budget envelope (maxBudgetUsdPerCall)
 *   - 429-aware fallback (Anthropic 429 → OpenAI cooldown route)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMultiLLMRouter,
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
  userPrompt: 'short prompt',
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
          new Date(e.occurredAt).getTime() < to.getTime(),
      );
      return {
        totalCostUsdMicro: scoped.reduce((a, b) => a + b.costUsdMicro, 0),
        totalInputTokens: scoped.reduce((a, b) => a + b.inputTokens, 0),
        totalOutputTokens: scoped.reduce((a, b) => a + b.outputTokens, 0),
        callCount: scoped.length,
        byModel: {},
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
  supportedModels: string[],
  behavior: (req: AICompletionRequest) => AIResult<AICompletionResponse, AIProviderError>,
): AIProvider {
  return {
    providerId: id,
    supportedModels,
    async complete(req) {
      return behavior(req);
    },
    supportsModel: (m) => supportedModels.includes(m),
    getModelInfo: () =>
      ({
        id: supportedModels[0] ?? 'any',
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

function okResp(
  modelId: string,
  tokensIn = 10,
  tokensOut = 5,
): AIResult<AICompletionResponse, AIProviderError> {
  return {
    success: true,
    data: {
      content: 'ok',
      modelId: asModelId(modelId),
      usage: {
        promptTokens: tokensIn,
        completionTokens: tokensOut,
        totalTokens: tokensIn + tokensOut,
      },
      processingTimeMs: 1,
      finishReason: 'stop',
    },
  };
}

function errResp(
  provider: string,
  code: AIProviderError['code'],
  retryable: boolean,
  statusCode?: number,
): AIResult<AICompletionResponse, AIProviderError> {
  return {
    success: false,
    error: { code, message: 'fail', provider, retryable, statusCode },
  };
}

describe('Phase D D7 — tenant-tier-aware pick() (Anthropic leg)', () => {
  it('enterprise tier picks Opus 4.7 when registered', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider(
      'anthropic',
      ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      () => okResp('claude-opus-4-7'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-sonnet-4-6' },
        },
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis', tenantTier: 'enterprise' });
    expect(pick?.providerId).toBe('anthropic');
    expect(pick?.modelId).toBe('claude-opus-4-7');
  });

  it('growth/standard tier picks Sonnet 4.6', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider(
      'anthropic',
      ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      () => okResp('claude-sonnet-4-6'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-opus-4-7' },
        },
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis', tenantTier: 'growth' });
    expect(pick?.modelId).toBe('claude-sonnet-4-6');
  });

  it('free tier picks Haiku 4.5', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider(
      'anthropic',
      ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
      () => okResp('claude-haiku-4-5-20251001'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-opus-4-7' },
        },
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis', tenantTier: 'free' });
    expect(pick?.modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('falls back to task-bound preferred model when tier-pick is unsupported', () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    // Provider only supports Sonnet; enterprise hint would want Opus 4.7.
    const ant = stubProvider('anthropic', ['claude-sonnet-4-6'], () =>
      okResp('claude-sonnet-4-6'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-sonnet-4-6' },
        },
      },
      ledger,
    });
    const pick = router.pick({ taskType: 'analysis', tenantTier: 'enterprise' });
    expect(pick?.modelId).toBe('claude-sonnet-4-6');
  });
});

describe('Phase D D7 — per-sensor budget envelope', () => {
  it('rejects calls projected to exceed maxBudgetUsdPerCall', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', ['claude-sonnet-4-6'], () =>
      okResp('claude-sonnet-4-6'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-sonnet-4-6' },
          // 0.003 USD per 1k input + 0.015 USD per 1k output → for
          // 5000 expectedOutput tokens ≈ 0.075 USD. Ceiling 0.01 →
          // rejected.
          pricing: {
            'claude-sonnet-4-6': {
              promptPer1k: 0.003,
              completionPer1k: 0.015,
            },
          },
        },
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1' },
      hints: {
        taskType: 'analysis',
        maxBudgetUsdPerCall: 0.01,
        expectedOutputTokens: 5000,
      },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.message).toMatch(/exceeds per-call envelope/i);
    }
  });

  it('allows calls projected to fit inside the envelope', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', ['claude-sonnet-4-6'], () =>
      okResp('claude-sonnet-4-6', 10, 5),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-sonnet-4-6' },
          pricing: {
            'claude-sonnet-4-6': {
              promptPer1k: 0.003,
              completionPer1k: 0.015,
            },
          },
        },
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1' },
      hints: {
        taskType: 'analysis',
        maxBudgetUsdPerCall: 1.0,
        expectedOutputTokens: 100,
      },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(true);
  });

  it('allows calls when no pricing is configured (unbounded)', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', ['claude-sonnet-4-6'], () =>
      okResp('claude-sonnet-4-6'),
    );
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { analysis: 'claude-sonnet-4-6' },
          // No pricing → estimator returns 0 → envelope bypassed.
        },
      },
      ledger,
    });
    const r = await router.complete({
      context: { tenantId: 't1' },
      hints: {
        taskType: 'analysis',
        maxBudgetUsdPerCall: 0.000001,
      },
      request: { prompt: compiled },
    });
    expect(r.success).toBe(true);
  });
});

describe('Phase D D7 — 429 rate-limit-aware fallback', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('marks Anthropic cooled-off on RATE_LIMIT and falls to OpenAI', async () => {
    const { repo } = makeRepo();
    const ledger = createCostLedger({ repo });
    const ant = stubProvider('anthropic', ['claude-sonnet-4-6'], () =>
      errResp('anthropic', 'RATE_LIMIT', true, 429),
    );
    const oa = stubProvider('openai', ['gpt-4o-mini'], () =>
      okResp('gpt-4o-mini', 10, 5),
    );
    const warnings: object[] = [];
    const router = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant,
          preferredModels: { conversation: 'claude-sonnet-4-6' },
        },
        openai: {
          provider: oa,
          preferredModels: { conversation: 'gpt-4o-mini' },
        },
      },
      ledger,
      logger: {
        warn: (meta) => warnings.push(meta),
      },
    });

    const r1 = await router.complete({
      context: { tenantId: 't1' },
      hints: { taskType: 'conversation' },
      request: { prompt: compiled },
    });
    expect(r1.success).toBe(true);
    if (r1.success) expect(r1.data.providerId).toBe('openai');

    // Subsequent calls during cooldown skip Anthropic without
    // touching the provider.
    let anthropicCalls = 0;
    const ant2 = stubProvider('anthropic', ['claude-sonnet-4-6'], () => {
      anthropicCalls += 1;
      return errResp('anthropic', 'RATE_LIMIT', true, 429);
    });
    const router2 = createMultiLLMRouter({
      providers: {
        anthropic: {
          provider: ant2,
          preferredModels: { conversation: 'claude-sonnet-4-6' },
        },
        openai: {
          provider: oa,
          preferredModels: { conversation: 'gpt-4o-mini' },
        },
      },
      ledger,
    });
    // 1st call triggers cooldown
    await router2.complete({
      context: { tenantId: 't1' },
      hints: { taskType: 'conversation' },
      request: { prompt: compiled },
    });
    expect(anthropicCalls).toBe(1);
    // 2nd call within cooldown → Anthropic untouched
    await router2.complete({
      context: { tenantId: 't1' },
      hints: { taskType: 'conversation' },
      request: { prompt: compiled },
    });
    expect(anthropicCalls).toBe(1);

    // We logged at least one 'rate-limited' warning.
    expect(
      warnings.some(
        (w) => (w as { event?: string }).event === 'rate-limited',
      ),
    ).toBe(true);
  });
});
