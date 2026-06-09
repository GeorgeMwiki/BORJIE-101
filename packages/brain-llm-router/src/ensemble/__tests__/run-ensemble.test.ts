/**
 * Tests for the all-at-once ENSEMBLE orchestrator.
 *
 * Coverage: each combine strategy (first-wins / majority-vote /
 * judge-synthesis / debate), fail-safe (no members, all-errored), and the
 * COST-AWARE degrade-to-single path (surfaced economy note — TEST=PAYING).
 */

import { describe, expect, it } from 'vitest';
import { runEnsemble, type EnsembleInvoke } from '../run-ensemble.js';
import type { BrainLLMRequest, BrainLLMResponse } from '../../types.js';

function baseRequest(): BrainLLMRequest {
  return {
    model: 'primary/model',
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'what is 2+2?' }] }],
    maxTokens: 256,
  };
}

function resp(model: string, text: string, latencyMs = 0): BrainLLMResponse {
  return {
    id: `msg-${model}`,
    model,
    provider: 'anthropic',
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 10 },
    latencyMs,
  };
}

/** Build an invoke that returns a fixed text per model, with optional delay. */
function invokeMap(
  map: Record<string, { text: string; delayMs?: number; throws?: boolean }>,
): EnsembleInvoke {
  return async (model) => {
    const e = map[model];
    if (!e) return resp(model, 'default');
    if (e.delayMs) await new Promise((r) => setTimeout(r, e.delayMs));
    if (e.throws) throw new Error(`fail ${model}`);
    return resp(model, e.text, e.delayMs ?? 0);
  };
}

describe('runEnsemble combine strategies', () => {
  it('first-wins returns the fastest non-error response', async () => {
    const invoke = invokeMap({
      slow: { text: 'slow', delayMs: 40 },
      fast: { text: 'fast', delayMs: 1 },
    });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['slow', 'fast'],
      strategy: 'first-wins',
      invoke,
    });
    expect(result.strategyUsed).toBe('first-wins');
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'fast' });
    expect(result.degraded).toBe(false);
  });

  it('majority-vote returns the most common answer', async () => {
    const invoke = invokeMap({
      a: { text: '4' },
      b: { text: '4' },
      c: { text: '5' },
    });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b', 'c'],
      strategy: 'majority-vote',
      invoke,
    });
    expect(result.strategyUsed).toBe('majority-vote');
    expect(result.response.content[0]).toEqual({ type: 'text', text: '4' });
    expect(result.confidence).toBeCloseTo(2 / 3, 5);
  });

  it('judge-synthesis synthesises via the judge port', async () => {
    const invoke = invokeMap({ a: { text: 'draft A' }, b: { text: 'draft B' } });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b'],
      strategy: 'judge-synthesis',
      judgeModel: 'judge/model',
      invoke,
      synthesise: async ({ drafts }) => ({
        score: 90,
        feedback: `synthesised: ${drafts.join(' + ')}`,
      }),
    });
    expect(result.strategyUsed).toBe('judge-synthesis');
    expect(result.response.model).toBe('judge/model');
    const block = result.response.content[0];
    expect(block.type === 'text' && block.text.startsWith('synthesised:')).toBe(true);
  });

  it('debate falls back to majority-vote when no synthesiser is wired', async () => {
    const invoke = invokeMap({ a: { text: 'X' }, b: { text: 'X' }, c: { text: 'Y' } });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b', 'c'],
      strategy: 'debate',
      invoke,
    });
    // No synthesise port → safe majority-vote, but strategyUsed stays 'debate'.
    expect(result.strategyUsed).toBe('debate');
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'X' });
  });
});

describe('runEnsemble fail-safe', () => {
  it('with NO members runs the single primary model', async () => {
    const invoke = invokeMap({ 'primary/model': { text: 'primary-answer' } });
    const result = await runEnsemble({
      request: baseRequest(),
      members: [],
      strategy: 'majority-vote',
      invoke,
    });
    expect(result.strategyUsed).toBe('single');
    expect(result.membersRun).toEqual(['primary/model']);
  });

  it('with all members erroring retries the primary as single', async () => {
    // Both members throw during the parallel fan-out; the all-errored
    // fail-safe then retries members[0] once as a single call (which succeeds
    // on the second attempt).
    const attempts = new Map<string, number>();
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b'],
      strategy: 'first-wins',
      invoke: async (model) => {
        const n = (attempts.get(model) ?? 0) + 1;
        attempts.set(model, n);
        // First call (fan-out) fails; second call (single retry of 'a') wins.
        if (n === 1) throw new Error(`fail ${model}`);
        return resp(model, 'recovered');
      },
    });
    expect(result.strategyUsed).toBe('single');
    expect(result.membersRun).toEqual(['a']);
    expect(result.response.content[0]).toEqual({ type: 'text', text: 'recovered' });
  });
});

describe('runEnsemble cost-aware degrade (TEST=PAYING)', () => {
  it('degrades to a single model with a SURFACED economy note when budget blocks', async () => {
    const invoke = invokeMap({
      a: { text: 'a' },
      b: { text: 'b' },
      c: { text: 'c' },
    });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b', 'c'],
      strategy: 'majority-vote',
      invoke,
      budgetCheck: async () => ({
        allow: false,
        degradeTo: 'a',
        economyNote: 'Budget low: ran a single model.',
      }),
    });
    expect(result.degraded).toBe(true);
    expect(result.strategyUsed).toBe('single');
    expect(result.membersRun).toEqual(['a']);
    expect(result.economyNote).toBe('Budget low: ran a single model.');
  });

  it('runs the full ensemble when the budget allows', async () => {
    const invoke = invokeMap({ a: { text: '4' }, b: { text: '4' } });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b'],
      strategy: 'majority-vote',
      invoke,
      budgetCheck: async () => ({ allow: true }),
    });
    expect(result.degraded).toBe(false);
    expect(result.economyNote).toBeUndefined();
  });

  it('degrades conservatively when the budget check throws', async () => {
    const invoke = invokeMap({ a: { text: 'a' }, b: { text: 'b' } });
    const result = await runEnsemble({
      request: baseRequest(),
      members: ['a', 'b'],
      strategy: 'first-wins',
      invoke,
      budgetCheck: async () => {
        throw new Error('governor down');
      },
    });
    expect(result.degraded).toBe(true);
    expect(result.membersRun).toEqual(['a']);
    expect(result.economyNote).toContain('budget check unavailable');
  });
});
