/**
 * Integration tests for brain-call-orchestrator/ — end-to-end pipeline.
 *
 * Coverage:
 *   - full pipeline: ladder -> compile (miss OK) -> fallback -> charge -> drift
 *   - DSPy cache hit on second call (no re-compile, prompt loaded from cache)
 *   - Self-Consistency N=3 votes on samples
 *   - CoVe path runs critic and surfaces score
 *   - hedged path picks faster lane
 *   - per-call costCapUsd enforced
 *   - cost-cap exceeded blocks before invocation
 *   - eval-drift log produced per call
 */

import { describe, expect, it } from 'vitest';
import { brainCall, type ModelClientRegistry } from './brain-call.js';
import { majorityVote } from './consistency.js';
import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';
import {
  InMemoryCacheStore,
  PromptCache,
  type CompiledPrompt,
} from '../dspy-compile/index.js';
import { InMemorySpendLedger } from '../cost-cap/index.js';
import { InMemoryEvalDriftSink } from '../eval-drift-logger/index.js';

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
        usage: { inputTokens: 50, outputTokens: 50 },
        latencyMs: delayMs,
      };
    },
  };
}

function buildCtx(opts: {
  clients: Map<string, BrainLLMClient>;
  promptCacheStore?: InMemoryCacheStore;
}) {
  const store = opts.promptCacheStore ?? new InMemoryCacheStore();
  const registry: ModelClientRegistry = {
    resolve: (m) => {
      const c = opts.clients.get(m);
      if (c !== undefined) return c;
      // Default fallback: a generic OK client
      return client('anthropic', 'default-ok');
    },
  };
  return {
    conversationId: 'conv_1',
    clientRegistry: registry,
    promptCache: new PromptCache({ baseDir: 'compiled-prompts', reader: store, writer: store }),
    costCap: {
      budgetReader: { read: async () => ({ tenantId: 't', monthlyBudgetUsd: 100, conversationBudgetUsd: 5 }) },
      ledger: new InMemorySpendLedger(),
    },
    driftSink: new InMemoryEvalDriftSink(),
  };
}

describe('brainCall full pipeline', () => {
  it('runs ladder -> fallback -> charge -> drift for a simple chat task', async () => {
    const clients = new Map<string, BrainLLMClient>([
      ['anthropic/claude-haiku-4-5', client('anthropic', 'hello user')],
    ]);
    const ctx = buildCtx({ clients });
    const result = await brainCall(
      { task: 'chat', prompt: 'say hi', tenantId: 't' },
      ctx
    );
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'hello user' });
    expect(result.modelUsed).toBe('anthropic/claude-haiku-4-5');
    expect(result.fallbackDepth).toBe(0);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.consistency).toBe(1);
    expect(result.verificationScore).toBe(1);
    expect(result.compiledPromptUsed).toBe(false); // no cache populated
    expect((ctx.driftSink as InMemoryEvalDriftSink).count()).toBe(1);
  });

  it('uses DSPy-compiled prompt when cache hit', async () => {
    const clients = new Map<string, BrainLLMClient>([
      ['anthropic/claude-haiku-4-5', client('anthropic', 'compiled-prompt-reply')],
    ]);
    const store = new InMemoryCacheStore();
    // Seed a compiled prompt for the chat_task.
    const compiled: CompiledPrompt = {
      signatureName: 'chat_task',
      signatureVersion: 'v1',
      model: 'anthropic/claude-haiku-4-5',
      compiledSystem: '<role>compiled role</role>',
      compiledInstruction: 'follow compiled instructions',
      demonstrations: [],
      compiledAt: '2026-05-19T00:00:00.000Z',
      compilerScore: 0.95,
      compilerName: 'MIPROv2-port',
    };
    await store.write('compiled-prompts/chat_task/claude-haiku-4-5.json', JSON.stringify(compiled));
    const ctx = buildCtx({ clients, promptCacheStore: store });
    const result = await brainCall(
      { task: 'chat', prompt: 'say hi', tenantId: 't' },
      ctx
    );
    expect(result.compiledPromptUsed).toBe(true);
  });

  it('Self-Consistency: N=3 returns majority winner', async () => {
    // Sample order: ['answer-a', 'answer-a', 'answer-b'] => 'answer-a' wins 2/3.
    const responses = ['answer-a', 'answer-a', 'answer-b'];
    let i = 0;
    const adapter: BrainLLMClient = {
      provider: 'anthropic',
      invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => ({
        id: 'm',
        model: req.model,
        provider: 'anthropic',
        content: [{ type: 'text', text: responses[i++ % responses.length]! }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      }),
    };
    const clients = new Map<string, BrainLLMClient>([['anthropic/claude-haiku-4-5', adapter]]);
    const ctx = buildCtx({ clients });
    const result = await brainCall(
      { task: 'chat', prompt: 'q', tenantId: 't', options: { consistencyN: 3 } },
      ctx
    );
    expect((result.response.content[0] as { text: string }).text).toBe('answer-a');
    expect(result.consistency).toBeCloseTo(2 / 3, 4);
  });

  it('CoVe path runs the critic and surfaces a verification score', async () => {
    const drafter = client('anthropic', 'draft text');
    const critic: BrainLLMClient = {
      provider: 'anthropic',
      invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => ({
        id: 'crit',
        model: req.model,
        provider: 'anthropic',
        content: [{ type: 'text', text: '0.82' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
        latencyMs: 1,
      }),
    };
    const clients = new Map<string, BrainLLMClient>([
      ['anthropic/claude-haiku-4-5', drafter],
    ]);
    const ctx = {
      ...buildCtx({ clients }),
      cove: { criticClient: critic, criticModel: 'anthropic/claude-haiku-4-5' },
    };
    const result = await brainCall(
      { task: 'chat', prompt: 'verify me', tenantId: 't', options: { cove: true } },
      ctx
    );
    expect(result.verificationScore).toBeCloseTo(0.82, 2);
  });

  it('hedged path picks the faster lane', async () => {
    const slow = client('anthropic', 'slow-primary', 80);
    const fast = client('anthropic', 'fast-secondary', 5);
    const clients = new Map<string, BrainLLMClient>([
      ['anthropic/claude-haiku-4-5', slow],
      ['anthropic/claude-sonnet-4-6', fast],
    ]);
    const ctx = { ...buildCtx({ clients }), hedgeAfterMs: 10 };
    const result = await brainCall(
      { task: 'chat', prompt: 'q', tenantId: 't', options: { hedged: true } },
      ctx
    );
    expect((result.response.content[0] as { text: string }).text).toBe('fast-secondary');
    expect(result.wasHedged).toBe(true);
  });

  it('per-call costCapUsd enforced after the call', async () => {
    // Haiku 50/50 tokens => ~0.0003 USD; cap at 0.0001 should fail.
    const clients = new Map<string, BrainLLMClient>([
      ['anthropic/claude-haiku-4-5', client('anthropic', 'ok')],
    ]);
    const ctx = buildCtx({ clients });
    await expect(
      brainCall(
        { task: 'chat', prompt: 'q', tenantId: 't', options: { costCapUsd: 0.0001 } },
        ctx
      )
    ).rejects.toMatchObject({ code: 'COST_CAP_EXCEEDED' });
  });

  it('majorityVote helper: unanimous returns consistency=1', () => {
    const samples: BrainLLMResponse[] = [
      {
        id: '1', model: 'x', provider: 'anthropic',
        content: [{ type: 'text', text: 'same' }],
        stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
      },
      {
        id: '2', model: 'x', provider: 'anthropic',
        content: [{ type: 'text', text: 'same' }],
        stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1,
      },
    ];
    const vote = majorityVote(samples);
    expect(vote.consistency).toBe(1);
  });
});
