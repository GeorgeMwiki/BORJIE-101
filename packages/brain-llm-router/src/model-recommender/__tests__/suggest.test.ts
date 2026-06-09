/**
 * Tests for the AI-SUGGEST recommender (suggest-only, HITL).
 *
 * Coverage: ranked output per use-case, cost/latency sensitivity, and the
 * capability HARD-GATE (a candidate below a policy-pinned floor is dropped —
 * a sovereign/legal use-case can NEVER be suggested a sub-floor model).
 */

import { describe, expect, it } from 'vitest';
import { suggestModelRouting, type ModelCandidate } from '../suggest.js';

const catalog: readonly ModelCandidate[] = [
  { model: 'anthropic/claude-haiku-4-5', family: 'haiku' },
  { model: 'anthropic/claude-sonnet-4-6', family: 'sonnet' },
  { model: 'anthropic/claude-opus-4-8', family: 'opus' },
];

describe('suggestModelRouting', () => {
  it('returns a ranked suggestion per use-case', () => {
    const result = suggestModelRouting({
      useCases: ['casual_chat', 'document_summary'],
      catalog,
    });
    expect(result.perUseCase).toHaveLength(2);
    for (const uc of result.perUseCase) {
      expect(uc.ranked.length).toBeGreaterThan(0);
      expect(uc.top).not.toBeNull();
      expect(uc.top?.rationale.length).toBeGreaterThan(0);
    }
  });

  it('prefers the cheaper/faster model for a no-floor casual use-case (cost-weighted)', () => {
    const result = suggestModelRouting({
      useCases: ['casual_chat'],
      catalog,
      // Bias heavily toward cost so haiku wins decisively.
      weights: { cost: 0.8, capability: 0.1, latency: 0.1 },
    });
    expect(result.perUseCase[0]!.top?.family).toBe('haiku');
  });

  it('HARD-GATES below-floor candidates for a legal use-case (offtake_drafting -> opus only)', () => {
    const result = suggestModelRouting({
      useCases: ['offtake_drafting'], // min-tier floor = opus
      catalog,
    });
    const uc = result.perUseCase[0]!;
    expect(uc.minFamily).toBe('opus');
    // Only opus qualifies; haiku + sonnet are disqualified by the floor.
    expect(uc.ranked.every((r) => r.family === 'opus')).toBe(true);
    expect(uc.top?.family).toBe('opus');
  });

  it('respects a sonnet floor (royalty_calculation drops haiku, keeps sonnet+opus)', () => {
    const result = suggestModelRouting({
      useCases: ['royalty_calculation'], // floor = sonnet
      catalog,
    });
    const families = result.perUseCase[0]!.ranked.map((r) => r.family);
    expect(families).not.toContain('haiku');
    expect(families).toContain('sonnet');
    expect(families).toContain('opus');
  });

  it('incorporates observed p50 latency metadata into the score', () => {
    const result = suggestModelRouting({
      useCases: ['casual_chat'],
      catalog,
      metrics: {
        'anthropic/claude-haiku-4-5': { p50LatencyMs: 5000 }, // artificially slow
        'anthropic/claude-sonnet-4-6': { p50LatencyMs: 100 },
      },
      weights: { cost: 0.1, capability: 0.1, latency: 0.8 },
    });
    // With latency dominating and haiku made slow, sonnet should out-rank it.
    const top = result.perUseCase[0]!.top!;
    expect(top.family).toBe('sonnet');
    expect(top.estimatedLatencyMs).toBe(100);
  });

  it('surfaces estimated cost per million tokens', () => {
    const result = suggestModelRouting({ useCases: ['casual_chat'], catalog });
    for (const r of result.perUseCase[0]!.ranked) {
      expect(r.estimatedCostPerMillion).toBeGreaterThan(0);
    }
  });

  it('is pure — calling twice yields identical output (no mutation)', () => {
    const a = suggestModelRouting({ useCases: ['casual_chat'], catalog });
    const b = suggestModelRouting({ useCases: ['casual_chat'], catalog });
    expect(a).toEqual(b);
  });
});
