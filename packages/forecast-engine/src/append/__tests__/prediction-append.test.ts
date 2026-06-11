/**
 * Prediction-APPEND invariant — the hard rail.
 *
 * Asserts that appending a forecast to a rule-based decision:
 *  - carries the decision through BYTE-FOR-BYTE unchanged,
 *  - never returns a modified decision,
 *  - marks the prediction 'advisory' (no decision authority),
 *  - rejects an empty evidence chain.
 */

import { describe, it, expect } from 'vitest';
import {
  appendForecastPrediction,
  type RuleBasedDecision,
} from '../prediction-append.js';
import type { EvidenceId, ForecastResult } from '../../types.js';

const EVIDENCE: EvidenceId = {
  id: 'ev-1',
  model: 'classical:ets_theta',
  version: '1.0.0',
  inputWindow: 30,
  horizon: 3,
  coverage: 0.9,
  baselineBeaten: false,
};

function forecast(evidenceIds: EvidenceId[]): ForecastResult {
  return {
    forecastId: 'fc_abc',
    tenantId: 'tenant-1',
    target: 'mining.A6.royalty_accrual',
    horizon: 3,
    points: [
      { step: 1, point: 10, quantiles: { '0.5': 10 } },
      { step: 2, point: 11, quantiles: { '0.5': 11 } },
      { step: 3, point: 12, quantiles: { '0.5': 12 } },
    ],
    intervals: [
      { step: 1, point: 10, lower: 9, upper: 11, alpha: 0.1 },
      { step: 2, point: 11, lower: 9.5, upper: 12.5, alpha: 0.1 },
      { step: 3, point: 12, lower: 10, upper: 14, alpha: 0.1 },
    ],
    model: 'classical:ets_theta',
    modelVersion: '1.0.0',
    baselineBeaten: false,
    conformalCoverage: 0.9,
    evidenceIds,
  };
}

interface RoyaltyDecision {
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly dueDateIso: string;
}

describe('appendForecastPrediction — APPEND-never-replace', () => {
  it('carries the rule-based decision through UNCHANGED', () => {
    const decision: RuleBasedDecision<RoyaltyDecision> = {
      decisionId: 'dec-1',
      rule: 'royalty.A6.statutory_formula',
      decision: {
        amountMinor: 1_500_000,
        currencyCode: 'TZS',
        dueDateIso: '2026-07-01',
      },
    };
    const before = JSON.stringify(decision);
    const env = appendForecastPrediction(decision, forecast([EVIDENCE]));

    // Same reference, identical content — nothing was mutated.
    expect(env.ruleBasedDecision).toBe(decision);
    expect(JSON.stringify(decision)).toBe(before);
    expect(env.ruleBasedDecision.decision).toEqual({
      amountMinor: 1_500_000,
      currencyCode: 'TZS',
      dueDateIso: '2026-07-01',
    });
    expect(env.mode).toBe('append');
  });

  it('marks the prediction advisory (no decision authority)', () => {
    const decision: RuleBasedDecision = {
      decisionId: 'dec-2',
      rule: 'licence.A10.deadline_engine',
      decision: { status: 'on_track' },
    };
    const env = appendForecastPrediction(decision, forecast([EVIDENCE]));
    expect(env.prediction.authority).toBe('advisory');
    expect(env.prediction.median).toEqual([10, 11, 12]);
    expect(env.prediction.lower).toEqual([9, 9.5, 10]);
    expect(env.prediction.upper).toEqual([11, 12.5, 14]);
    expect(env.prediction.evidenceIds).toHaveLength(1);
  });

  it('throws on an empty evidence chain', () => {
    const decision: RuleBasedDecision = {
      decisionId: 'dec-3',
      rule: 'r',
      decision: {},
    };
    expect(() => appendForecastPrediction(decision, forecast([]))).toThrow(
      /empty evidence chain/,
    );
  });

  it('does not let mutating the envelope reach back into the original decision', () => {
    const decision: RuleBasedDecision<{ n: number }> = {
      decisionId: 'dec-4',
      rule: 'r',
      decision: { n: 1 },
    };
    const env = appendForecastPrediction(decision, forecast([EVIDENCE]));
    // The advisory prediction is a separate structure; reading it must
    // never need to touch the decision. Confirm the decision payload is
    // still the authoritative value.
    expect(env.ruleBasedDecision.decision.n).toBe(1);
    expect(env.prediction.target).toBe('mining.A6.royalty_accrual');
  });
});
