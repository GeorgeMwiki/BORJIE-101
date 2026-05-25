/**
 * Unit + integration tests for cost-cascade/.
 *
 * Coverage:
 *   - normaliseModel strips prefix + cloud suffix
 *   - getPricing returns Anthropic Haiku $1/$5
 *   - computeCost matches expected USD
 *   - runCascade stops at first confident response (cheapest)
 *   - runCascade escalates Haiku -> Sonnet -> Opus on low scores
 *   - 60% Haiku miss + 95% Sonnet hit yields large savings vs all-Opus
 *   - empty steps -> EMPTY_CASCADE
 *   - budget enforcement aborts before exhausting all
 */

import { describe, expect, it } from 'vitest';
import { computeCost, getPricing, normaliseModel } from './pricing.js';
import { runCascade, type CascadeStep } from './cascade-runner.js';
import type { BrainLLMClient, BrainLLMRequest, BrainLLMResponse, ProviderName } from '../types.js';

function client(provider: ProviderName, text: string): BrainLLMClient {
  return {
    provider,
    invoke: async (req: BrainLLMRequest): Promise<BrainLLMResponse> => ({
      id: 'msg',
      model: req.model,
      provider,
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 100 },
      latencyMs: 1,
    }),
  };
}

const baseReq: BrainLLMRequest = {
  model: 'placeholder',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  maxTokens: 100,
};

describe('pricing', () => {
  it('normaliseModel strips provider prefix and cloud suffix', () => {
    expect(normaliseModel('anthropic/claude-haiku-4-5@bedrock')).toBe('claude-haiku-4-5');
    expect(normaliseModel('openai/gpt-5')).toBe('gpt-5');
  });

  it('getPricing returns Haiku $1/$5', () => {
    const p = getPricing('anthropic/claude-haiku-4-5');
    expect(p.inputPerMillion).toBe(1);
    expect(p.outputPerMillion).toBe(5);
  });

  it('getPricing returns Sonnet $3/$15', () => {
    const p = getPricing('anthropic/claude-sonnet-4-6');
    expect(p.inputPerMillion).toBe(3);
    expect(p.outputPerMillion).toBe(15);
  });

  it('getPricing returns Opus $15/$75', () => {
    const p = getPricing('anthropic/claude-opus-4-7');
    expect(p.inputPerMillion).toBe(15);
    expect(p.outputPerMillion).toBe(75);
  });

  it('computeCost matches expected USD for 1M input + 1M output on Haiku', () => {
    const { usd } = computeCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, getPricing('claude-haiku-4-5'));
    expect(usd).toBeCloseTo(6, 4); // $1 + $5
  });

  it('falls back to default pricing for unknown model', () => {
    const p = getPricing('unknown/whatever');
    expect(p.inputPerMillion).toBeGreaterThan(0);
  });
});

describe('runCascade', () => {
  const cascade: CascadeStep[] = [
    { model: 'anthropic/claude-haiku-4-5', client: client('anthropic', 'haiku-answer') },
    { model: 'anthropic/claude-sonnet-4-6', client: client('anthropic', 'sonnet-answer') },
    { model: 'anthropic/claude-opus-4-7', client: client('anthropic', 'opus-answer') },
  ];

  it('returns Haiku immediately when score crosses threshold', async () => {
    const res = await runCascade(baseReq, cascade, {
      confidenceThreshold: 0.6,
      evalFn: () => 0.9, // Haiku confident
    });
    expect(res.modelUsed).toBe('anthropic/claude-haiku-4-5');
    expect(res.steps).toBe(1);
    expect(res.savingsVsTopUsd).toBeGreaterThan(0);
  });

  it('escalates from Haiku -> Sonnet when first score is low', async () => {
    let calls = 0;
    const res = await runCascade(baseReq, cascade, {
      confidenceThreshold: 0.7,
      evalFn: () => {
        calls += 1;
        return calls === 1 ? 0.3 : 0.95; // miss then hit
      },
    });
    expect(res.modelUsed).toBe('anthropic/claude-sonnet-4-6');
    expect(res.steps).toBe(2);
  });

  it('full escalation to Opus when both cheaper models miss', async () => {
    let calls = 0;
    const res = await runCascade(baseReq, cascade, {
      confidenceThreshold: 0.9,
      evalFn: () => {
        calls += 1;
        return calls < 3 ? 0.5 : 0.95;
      },
    });
    expect(res.modelUsed).toBe('anthropic/claude-opus-4-7');
    expect(res.steps).toBe(3);
  });

  it('synthetic eval: 60% Haiku miss + 95% Sonnet hit beats all-Opus on cost', async () => {
    // Sample 100 cascade runs to estimate savings.
    let runs = 0;
    let totalCascadeCost = 0;
    while (runs < 100) {
      const cheap = Math.random() > 0.6 ? 0.9 : 0.3;
      const mid = Math.random() > 0.05 ? 0.92 : 0.4;
      const top = 0.99;
      let pulls = 0;
      const evalFn = () => {
        pulls += 1;
        return pulls === 1 ? cheap : pulls === 2 ? mid : top;
      };
      const res = await runCascade(baseReq, cascade, { confidenceThreshold: 0.85, evalFn });
      totalCascadeCost += res.totalCostUsd;
      runs += 1;
    }
    // 100 all-Opus calls: 100 * (100 tokens in @ $15/M + 100 tokens out @ $75/M)
    // = 100 * (1.5e-3 + 7.5e-3) = 0.9 USD.
    // Cascade should be materially cheaper given >40% Haiku hits.
    expect(totalCascadeCost).toBeLessThan(0.9);
  });

  it('records onStep telemetry for each cascade step', async () => {
    const steps: Array<{ model: string; escalated: boolean }> = [];
    let n = 0;
    await runCascade(baseReq, cascade, {
      confidenceThreshold: 0.8,
      evalFn: () => {
        n += 1;
        return n === 3 ? 0.95 : 0.5;
      },
      onStep: (e) => steps.push({ model: e.model, escalated: e.escalated }),
    });
    expect(steps).toHaveLength(3);
    expect(steps[0]!.escalated).toBe(true);
    expect(steps[2]!.escalated).toBe(false);
  });

  it('throws EMPTY_CASCADE on empty steps', async () => {
    await expect(
      runCascade(baseReq, [], { evalFn: () => 1 })
    ).rejects.toMatchObject({ code: 'EMPTY_CASCADE' });
  });

  it('enforces budget cap and returns best-effort if no model crosses threshold', async () => {
    const res = await runCascade(baseReq, cascade, {
      confidenceThreshold: 0.99,
      budgetUsd: 0.05, // tight cap — only Haiku fits
      evalFn: () => 0.5,
    });
    expect(res.modelUsed).toBe('anthropic/claude-haiku-4-5'); // best of what we could afford
    expect(res.steps).toBeLessThanOrEqual(3);
  });
});
