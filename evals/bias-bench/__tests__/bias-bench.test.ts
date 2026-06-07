/**
 * bias-bench — proves the @borjie/bias-handling wiring performs genuine
 * compute (not a stub):
 *   - the unbiased floor brain scores within every threshold;
 *   - the adversarial ceiling brain scores strictly worse (the metrics
 *     DISCRIMINATE bias — a stub would score both identically);
 *   - the group-fairness metrics pass on a balanced fixture and FAIL on
 *     an adversarial one (the 80%-rule is load-bearing).
 */

import { describe, it, expect } from 'vitest';
import {
  safeRefusalBrain,
  stereotypingBrain,
  unknownChoiceIndex,
} from '../baselines.ts';
import { runAllSuites, gateBrain } from '../run.ts';
import { thresholdForSuite, type BiasSuite } from '../thresholds.ts';
import { scoreGroupFairness, BALANCED_DECISION_FIXTURE } from '../group-fairness.ts';
import type { FairnessRow } from '@borjie/bias-handling';

describe('baseline prompt parsing', () => {
  it('finds the "cannot be determined" choice index', () => {
    const prompt = [
      'Context: ...',
      'Question: who?',
      '  0) the older worker',
      '  1) the younger worker',
      '  2) cannot be determined',
      'Answer with only the index (0, 1, or 2).',
    ].join('\n');
    expect(unknownChoiceIndex(prompt)).toBe(2);
  });

  it('returns -1 when there is no unknown option', () => {
    const prompt = ['  0) yes', '  1) no'].join('\n');
    expect(unknownChoiceIndex(prompt)).toBe(-1);
  });
});

describe('LLM bias suites', () => {
  it('the unbiased floor brain is within every threshold', async () => {
    const results = await runAllSuites(safeRefusalBrain);
    expect(results.length).toBe(5);
    for (const r of results) {
      const threshold = thresholdForSuite(r.suite as BiasSuite);
      expect(r.itemsEvaluated).toBeGreaterThan(0);
      expect(r.overallScore).toBeLessThanOrEqual(threshold);
    }
    expect(gateBrain(results).breaches).toEqual([]);
  });

  it('the adversarial ceiling brain scores strictly worse on >=1 suite', async () => {
    const floor = await runAllSuites(safeRefusalBrain);
    const ceiling = await runAllSuites(stereotypingBrain);
    let discriminated = false;
    for (let i = 0; i < floor.length; i += 1) {
      if ((ceiling[i]?.overallScore ?? 0) > (floor[i]?.overallScore ?? 0)) {
        discriminated = true;
        break;
      }
    }
    expect(discriminated).toBe(true);
    // And at least one ceiling suite actually breaches its threshold —
    // proving the gate would fire on a biased brain.
    expect(gateBrain(ceiling).breaches.length).toBeGreaterThan(0);
  });
});

describe('group fairness', () => {
  it('passes on the balanced decision fixture (ratio >= 0.8)', () => {
    const gf = scoreGroupFairness({
      rows: BALANCED_DECISION_FIXTURE,
      privilegedGroup: 'male',
      jurisdiction: 'TZ',
      context: 'employment',
    });
    expect(gf.passes).toBe(true);
    expect(gf.disparateImpact.violates).toBe(false);
    expect(gf.protectedAttributes.length).toBeGreaterThan(0);
  });

  it('fails the 80%-rule on an adversarial decision fixture', () => {
    // male: 9/10 selected; female: 2/10 → ratio 0.22 << 0.8 floor.
    const rows: ReadonlyArray<FairnessRow> = [
      ...Array.from({ length: 9 }, () => ({ group: 'male', prediction: 1 as const })),
      ...Array.from({ length: 1 }, () => ({ group: 'male', prediction: 0 as const })),
      ...Array.from({ length: 2 }, () => ({ group: 'female', prediction: 1 as const })),
      ...Array.from({ length: 8 }, () => ({ group: 'female', prediction: 0 as const })),
    ];
    const gf = scoreGroupFairness({
      rows,
      privilegedGroup: 'male',
      jurisdiction: 'TZ',
      context: 'employment',
    });
    expect(gf.disparateImpact.violates).toBe(true);
    expect(gf.passes).toBe(false);
  });
});
