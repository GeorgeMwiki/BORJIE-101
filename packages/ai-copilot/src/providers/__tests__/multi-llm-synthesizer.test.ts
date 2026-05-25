/**
 * Tests for the multi-LLM fan-out synthesizer.
 *
 * Verified behaviours:
 *   - merge mode invokes synthesizer with all successful proposals
 *   - jury mode invokes synthesizer with all successful proposals (different prompt)
 *   - race-verify returns the fastest proposer's answer without calling synthesizer
 *   - partial proposer failure still produces an answer when minSuccesses is met
 *   - all-fail aggregates errors and never invokes synthesizer
 *   - low agreement sets escalate=true
 *   - synthesizer failure falls back to highest-confidence proposer
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createMultiLLMSynthesizer,
  type ProposerRegistration,
} from '../multi-llm-synthesizer.js';
import type {
  AIProvider,
  AICompletionRequest,
  AICompletionResponse,
  AIProviderError,
} from '../ai-provider.js';
import type { AIResult } from '../../types/core.types.js';
import { aiOk, aiErr, asModelId } from '../../types/core.types.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function makeResponse(text: string, latencyMs = 0, finishReason: 'stop' | 'length' = 'stop'): AICompletionResponse {
  return {
    content: text,
    modelId: asModelId('test-model'),
    usage: { promptTokens: 5, completionTokens: text.split(' ').length, totalTokens: 5 + text.split(' ').length },
    processingTimeMs: latencyMs,
    finishReason,
  };
}

function makeProvider(opts: {
  id: string;
  reply?: (req: AICompletionRequest) => Promise<AIResult<AICompletionResponse, AIProviderError>>;
}): AIProvider {
  return {
    providerId: opts.id,
    supportedModels: ['test-model'],
    complete: opts.reply ?? (async () => aiOk(makeResponse('default'))),
    supportsModel: (m) => m === 'test-model',
    getModelInfo: () => null,
    healthCheck: async () => true,
  };
}

function makeRegistration(id: string, provider: AIProvider): ProposerRegistration {
  return { id, provider, model: 'test-model' };
}

function makeRequest(prompt = 'What is the capital of France?'): AICompletionRequest {
  return {
    prompt: {
      systemPrompt: 'You are a helpful AI.',
      userPrompt: prompt,
      compiledAt: new Date(),
      templateId: 'test',
      version: 1,
    } as AICompletionRequest['prompt'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('multi-llm-synthesizer', () => {
  it('throws on zero proposers', () => {
    expect(() =>
      createMultiLLMSynthesizer({
        proposers: [],
        synthesizer: makeRegistration('synth', makeProvider({ id: 'synth' })),
      }),
    ).toThrow(/at least 1 proposer/);
  });

  it('merge mode fans out to all proposers and calls synthesizer once', async () => {
    const synthSpy = vi.fn(async (req: AICompletionRequest) => {
      // Synthesizer must see all 3 proposals in the user prompt.
      const userPrompt = req.prompt?.userPrompt ?? '';
      expect(userPrompt).toContain('Proposal 1');
      expect(userPrompt).toContain('Proposal 2');
      expect(userPrompt).toContain('Proposal 3');
      return aiOk(makeResponse('Paris is the capital of France.'));
    });

    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('anthropic', makeProvider({ id: 'anthropic', reply: async () => aiOk(makeResponse('Paris')) })),
        makeRegistration('openai',    makeProvider({ id: 'openai',    reply: async () => aiOk(makeResponse('Paris, France')) })),
        makeRegistration('deepseek',  makeProvider({ id: 'deepseek',  reply: async () => aiOk(makeResponse('The capital is Paris.')) })),
      ],
      synthesizer: makeRegistration('synth', makeProvider({ id: 'synth', reply: synthSpy })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'merge' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.content).toBe('Paris is the capital of France.');
    expect(result.data.proposerOutcomes).toHaveLength(3);
    expect(result.data.proposerOutcomes.every((o) => o.success)).toBe(true);
    expect(result.data.synthesizerFallback).toBe(false);
    expect(result.data.degraded).toBe(false);
    expect(synthSpy).toHaveBeenCalledOnce();
  });

  it('jury mode uses the jury system prompt', async () => {
    let capturedSystemPrompt = '';
    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('a', makeProvider({ id: 'a', reply: async () => aiOk(makeResponse('Paris is in France')) })),
        makeRegistration('b', makeProvider({ id: 'b', reply: async () => aiOk(makeResponse('Paris is the capital')) })),
      ],
      synthesizer: makeRegistration('judge', makeProvider({
        id: 'judge',
        reply: async (req) => {
          capturedSystemPrompt = req.prompt?.systemPrompt ?? '';
          return aiOk(makeResponse('Paris is the capital\n\nJury rationale: most accurate'));
        },
      })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'jury' });
    expect(result.success).toBe(true);
    expect(capturedSystemPrompt).toContain('jury');
    expect(capturedSystemPrompt).toContain('best candidate verbatim');
  });

  it('race-verify returns fastest proposer without calling synthesizer', async () => {
    const synthSpy = vi.fn(async () => aiOk(makeResponse('SHOULD NOT BE CALLED')));

    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('slow', makeProvider({
          id: 'slow',
          reply: async () => {
            await new Promise((r) => setTimeout(r, 30));
            return aiOk(makeResponse('slow answer'));
          },
        })),
        makeRegistration('fast', makeProvider({
          id: 'fast',
          reply: async () => aiOk(makeResponse('fast answer')),
        })),
      ],
      synthesizer: makeRegistration('synth', makeProvider({ id: 'synth', reply: synthSpy })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'race-verify' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.content).toBe('fast answer');
    expect(result.data.synthesizerFallback).toBe(true);
    expect(synthSpy).not.toHaveBeenCalled();
  });

  it('survives partial proposer failure when minSuccesses is met', async () => {
    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('ok-a', makeProvider({ id: 'ok-a', reply: async () => aiOk(makeResponse('alpha')) })),
        makeRegistration('boom', makeProvider({
          id: 'boom',
          reply: async () =>
            aiErr({ code: 'RATE_LIMIT', provider: 'boom', message: '429' } as AIProviderError),
        })),
        makeRegistration('ok-b', makeProvider({ id: 'ok-b', reply: async () => aiOk(makeResponse('alpha-2')) })),
      ],
      synthesizer: makeRegistration('synth', makeProvider({
        id: 'synth',
        reply: async () => aiOk(makeResponse('merged-alpha')),
      })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'merge', minProposerSuccesses: 2 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.content).toBe('merged-alpha');
    expect(result.data.degraded).toBe(true);
    expect(result.data.proposerOutcomes.filter((o) => !o.success)).toHaveLength(1);
  });

  it('returns error when minSuccesses not met (all fail)', async () => {
    const synthSpy = vi.fn(async () => aiOk(makeResponse('UNCALLED')));

    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('a', makeProvider({
          id: 'a',
          reply: async () =>
            aiErr({ code: 'PROVIDER_ERROR', provider: 'a', message: 'down' } as AIProviderError),
        })),
        makeRegistration('b', makeProvider({
          id: 'b',
          reply: async () =>
            aiErr({ code: 'TIMEOUT', provider: 'b', message: 'slow' } as AIProviderError),
        })),
      ],
      synthesizer: makeRegistration('s', makeProvider({ id: 's', reply: synthSpy })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'merge', minProposerSuccesses: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.proposerErrors).toHaveLength(2);
    expect(synthSpy).not.toHaveBeenCalled();
  });

  it('flags escalate=true when agreement is low', async () => {
    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('a', makeProvider({
          id: 'a',
          reply: async () => aiOk(makeResponse('mango banana orange grape strawberry')),
        })),
        makeRegistration('b', makeProvider({
          id: 'b',
          reply: async () => aiOk(makeResponse('hydrogen helium lithium beryllium boron')),
        })),
      ],
      synthesizer: makeRegistration('s', makeProvider({
        id: 's',
        reply: async () => aiOk(makeResponse('synthesized')),
      })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'merge', minAgreementThreshold: 0.5 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.escalate).toBe(true);
    expect(result.data.agreement).toBeLessThan(0.5);
  });

  it('falls back to highest-confidence proposer when synthesizer fails', async () => {
    const synth = createMultiLLMSynthesizer({
      proposers: [
        // Short-and-incomplete (length finish-reason) should rank lower.
        makeRegistration('short', makeProvider({
          id: 'short',
          reply: async () => aiOk(makeResponse('short', 50, 'length')),
        })),
        // Clean stop, more tokens → preferred fallback.
        makeRegistration('rich', makeProvider({
          id: 'rich',
          reply: async () => aiOk(makeResponse('rich detailed answer with many tokens', 100, 'stop')),
        })),
      ],
      synthesizer: makeRegistration('synth', makeProvider({
        id: 'synth',
        reply: async () =>
          aiErr({ code: 'PROVIDER_ERROR', provider: 'synth', message: 'overloaded' } as AIProviderError),
      })),
    });

    const result = await synth.synthesize(makeRequest(), { mode: 'merge' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.content).toBe('rich detailed answer with many tokens');
    expect(result.data.synthesizerFallback).toBe(true);
    expect(result.data.escalate).toBe(true);
  });

  it('records per-proposer latency in outcomes', async () => {
    const synth = createMultiLLMSynthesizer({
      proposers: [
        makeRegistration('a', makeProvider({
          id: 'a',
          reply: async () => {
            await new Promise((r) => setTimeout(r, 20));
            return aiOk(makeResponse('a-answer'));
          },
        })),
      ],
      synthesizer: makeRegistration('s', makeProvider({ id: 's', reply: async () => aiOk(makeResponse('synth')) })),
    });

    const result = await synth.synthesize(makeRequest());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.proposerOutcomes[0]!.latencyMs).toBeGreaterThanOrEqual(20);
  });
});
