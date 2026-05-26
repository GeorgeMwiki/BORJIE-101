/**
 * A/B testing tests — traffic split determinism + Bayesian decider.
 */

import { describe, it, expect } from 'vitest';
import { assignVariant } from '../ab-testing/traffic-splitter.js';
import { decideWinner } from '../ab-testing/bayes-decider.js';
import { decidePromotion } from '../ab-testing/auto-promotion.js';
import { generateVariants } from '../ab-testing/variant-generator.js';
import type { ABTestSpec } from '../types.js';

const SPEC: ABTestSpec = {
  variant_count: 2,
  traffic_split: [0.5, 0.5],
  min_sample_size: 100,
  significance_alpha: 0.05,
  auto_promote_winner: true,
};

describe('traffic splitter', () => {
  it('assigns deterministically for the same visitor', () => {
    const variants = [{ id: 'A' }, { id: 'B' }];
    const a = assignVariant({
      visitor_id: 'visitor-123',
      recipe_id: 'r',
      variants,
      spec: SPEC,
    });
    const b = assignVariant({
      visitor_id: 'visitor-123',
      recipe_id: 'r',
      variants,
      spec: SPEC,
    });
    expect(a.variant_id).toBe(b.variant_id);
  });

  it('distributes roughly evenly across visitors', () => {
    const variants = [{ id: 'A' }, { id: 'B' }];
    let aCount = 0;
    for (let i = 0; i < 1000; i++) {
      const r = assignVariant({
        visitor_id: `v${i}`,
        recipe_id: 'r',
        variants,
        spec: SPEC,
      });
      if (r.variant_id === 'A') aCount += 1;
    }
    expect(aCount).toBeGreaterThan(400);
    expect(aCount).toBeLessThan(600);
  });
});

describe('Bayesian decider', () => {
  it('returns one result per variant', () => {
    const result = decideWinner({
      variants: [
        { id: 'A', samples: 100, conversions: 5 },
        { id: 'B', samples: 100, conversions: 10 },
      ],
      min_sample_size: 100,
      significance_alpha: 0.05,
      monte_carlo_samples: 1000,
    });
    expect(result).toHaveLength(2);
    expect(result[0]!.bayes_posterior + result[1]!.bayes_posterior).toBeCloseTo(1.0, 1);
  });

  it('does not declare a winner under min sample size', () => {
    const result = decideWinner({
      variants: [
        { id: 'A', samples: 5, conversions: 1 },
        { id: 'B', samples: 5, conversions: 4 },
      ],
      min_sample_size: 1000,
      significance_alpha: 0.05,
      monte_carlo_samples: 200,
    });
    expect(result.every((r) => !r.is_winner)).toBe(true);
  });
});

describe('promotion decider', () => {
  it('requires owner approval for Tier 2 even when auto_promote_winner=true', () => {
    const decision = decidePromotion({
      spec: SPEC,
      authority_tier: 2,
      decisions: [
        { variant_id: 'A', bayes_posterior: 0.05, is_winner: false },
        { variant_id: 'B', bayes_posterior: 0.95, is_winner: true },
      ],
    });
    expect(decision.verdict).toBe('promote_owner_approval_required');
    expect(decision.winner_variant_id).toBe('B');
  });

  it('auto-promotes Tier 1 winners when auto_promote_winner=true', () => {
    const decision = decidePromotion({
      spec: SPEC,
      authority_tier: 1,
      decisions: [
        { variant_id: 'A', bayes_posterior: 0.05, is_winner: false },
        { variant_id: 'B', bayes_posterior: 0.96, is_winner: true },
      ],
    });
    expect(decision.verdict).toBe('promote_auto');
  });

  it('returns no_winner when no variant crosses threshold', () => {
    const decision = decidePromotion({
      spec: SPEC,
      authority_tier: 1,
      decisions: [
        { variant_id: 'A', bayes_posterior: 0.45, is_winner: false },
        { variant_id: 'B', bayes_posterior: 0.55, is_winner: false },
      ],
    });
    expect(decision.verdict).toBe('no_winner');
  });
});

describe('variant generator', () => {
  it('produces variants of the requested count', () => {
    const variants = generateVariants({
      recipe_id: 'r',
      channel: 'meta_ads',
      audience_segment: 'mining_owner',
      variant_count: 3,
      brief: {
        base_message: 'base',
        cta_options: ['CTA1', 'CTA2'],
        headline_options: ['H1', 'H2', 'H3'],
        tone_options: ['neutral'],
      },
    });
    expect(variants).toHaveLength(3);
    expect(variants[0]!.id).toContain('meta_ads');
  });
});
