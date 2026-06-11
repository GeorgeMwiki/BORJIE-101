/**
 * Integration tests for the CONFIG-DRIVEN routing + ENSEMBLE seam inside
 * brainCall. Proves:
 *   - empty/absent config === legacy static-ladder behaviour (ladderSource).
 *   - an admin config steers the ladder (ladderSource === 'admin-config').
 *   - an enabled ensemble runs the all-at-once branch (wasEnsemble).
 *   - the ensemble degrades cost-aware with a surfaced economy note.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { brainCall, type BrainCallContext, type ModelClientRegistry } from './brain-call.js';
import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';
import { InMemoryCacheStore, PromptCache } from '../dspy-compile/index.js';
import { InMemorySpendLedger } from '../cost-cap/index.js';
import { InMemoryEvalDriftSink } from '../eval-drift-logger/index.js';
import {
  setRoutingConfigReader,
  resetRoutingConfigReader,
  type LlmRoutingConfig,
} from '../routing-config/index.js';

function client(provider: ProviderName, text: string, delayMs = 0): BrainLLMClient {
  return {
    provider,
    invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return {
        id: 'msg',
        model: req.model,
        provider,
        content: [{ type: 'text', text }],
        stopReason: 'end_turn',
        usage: { inputTokens: 20, outputTokens: 20 },
        latencyMs: delayMs,
      };
    },
  };
}

function buildCtx(
  clients: Map<string, BrainLLMClient>,
  extra: Partial<BrainCallContext> = {},
): BrainCallContext {
  const store = new InMemoryCacheStore();
  const registry: ModelClientRegistry = {
    resolve: (m) => clients.get(m) ?? client('anthropic', `default:${m}`),
  };
  return {
    conversationId: 'conv',
    clientRegistry: registry,
    promptCache: new PromptCache({ baseDir: 'compiled-prompts', reader: store, writer: store }),
    costCap: {
      budgetReader: {
        read: async () => ({ tenantId: 't', monthlyBudgetUsd: 100, conversationBudgetUsd: 5 }),
      },
      ledger: new InMemorySpendLedger(),
    },
    driftSink: new InMemoryEvalDriftSink(),
    ...extra,
  };
}

afterEach(() => {
  resetRoutingConfigReader();
  delete process.env.BORJIE_LLM_ROUTING_CONFIG;
});

describe('brainCall config-driven ladder', () => {
  it('with NO config falls back to the static ladder (ladderSource=static-ladder)', async () => {
    const clients = new Map([['anthropic/claude-haiku-4-5', client('anthropic', 'hi')]]);
    const result = await brainCall(
      { task: 'chat', prompt: 'say hi', tenantId: 't' },
      buildCtx(clients),
    );
    expect(result.ladderSource).toBe('static-ladder');
    expect(result.wasEnsemble).toBe(false);
  });

  it('with an admin config routes to the configured core (ladderSource=admin-config)', async () => {
    const config: LlmRoutingConfig = {
      coreModel: 'admin/core-model',
      orderedFallbacks: ['admin/fallback'],
    };
    setRoutingConfigReader((scope) => (scope === 'global' ? config : null));
    const clients = new Map([['admin/core-model', client('openai', 'admin-answer')]]);
    const result = await brainCall(
      { task: 'chat', prompt: 'q', tenantId: 't' },
      buildCtx(clients),
    );
    expect(result.ladderSource).toBe('admin-config');
    expect(result.modelUsed).toBe('admin/core-model');
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'admin-answer' });
  });
});

describe('brainCall ensemble seam', () => {
  it('runs the all-at-once ensemble when the admin enabled it', async () => {
    setRoutingConfigReader(() => ({
      coreModel: 'm1',
      orderedFallbacks: [],
      ensemble: {
        enabled: true,
        members: ['m1', 'm2', 'm3'],
        combineStrategy: 'majority-vote',
      },
    }));
    const clients = new Map([
      ['m1', client('anthropic', '4')],
      ['m2', client('openai', '4')],
      ['m3', client('google', '5')],
    ]);
    const result = await brainCall(
      { task: 'chat', prompt: 'what is 2+2?', tenantId: 't' },
      buildCtx(clients),
    );
    expect(result.wasEnsemble).toBe(true);
    expect(result.response.content[0]).toEqual({ type: 'text', text: '4' });
  });

  it('degrades to a single model with a surfaced economy note when budget blocks', async () => {
    setRoutingConfigReader(() => ({
      coreModel: 'm1',
      orderedFallbacks: [],
      ensemble: {
        enabled: true,
        members: ['m1', 'm2'],
        combineStrategy: 'first-wins',
      },
    }));
    const clients = new Map([
      ['m1', client('anthropic', 'single')],
      ['m2', client('openai', 'other')],
    ]);
    const ctx = buildCtx(clients, {
      ensembleBudgetCheck: async () => ({
        allow: false,
        degradeTo: 'm1',
        economyNote: 'Running a single model to respect your budget.',
      }),
    });
    const result = await brainCall(
      { task: 'chat', prompt: 'q', tenantId: 't' },
      ctx,
    );
    expect(result.wasEnsemble).toBe(false); // degraded to single
    expect(result.economyNote).toBe('Running a single model to respect your budget.');
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'single' });
  });

  it('with the kill-switch OFF ignores the ensemble config entirely', async () => {
    process.env.BORJIE_LLM_ROUTING_CONFIG = 'off';
    setRoutingConfigReader(() => ({
      coreModel: 'm1',
      orderedFallbacks: [],
      ensemble: { enabled: true, members: ['m1', 'm2'], combineStrategy: 'first-wins' },
    }));
    const clients = new Map([['anthropic/claude-haiku-4-5', client('anthropic', 'static')]]);
    const result = await brainCall(
      { task: 'chat', prompt: 'q', tenantId: 't' },
      buildCtx(clients),
    );
    expect(result.wasEnsemble).toBe(false);
    expect(result.ladderSource).toBe('static-ladder');
  });
});
