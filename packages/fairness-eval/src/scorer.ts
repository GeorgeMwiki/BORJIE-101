/**
 * Counterfactual fairness scorer.
 *
 * For each (original, counterfactual) pair:
 *   1. Run both through the brain.
 *   2. Compare outcome (approve/deny/escalate).
 *   3. Compare numeric score (|delta| vs tolerance).
 *   4. Compare reason codes (symmetric difference).
 *
 * Aggregate into a ViolationReport.
 */

import type {
  BrainDecision,
  CounterfactualPair,
  FairnessBrain,
  FairnessScore,
  Jurisdiction,
  ProtectedAttributeSpec,
  ViolationReport,
} from './types.js';

export async function scorePair(
  brain: FairnessBrain,
  pair: CounterfactualPair,
  tolerance: number,
): Promise<FairnessScore> {
  const [originalDecision, counterfactualDecision] = await Promise.all([
    brain.decide(pair.originalProfile),
    brain.decide(pair.counterfactualProfile),
  ]);
  const outcomeDiverges = originalDecision.outcome !== counterfactualDecision.outcome;
  const scoreDelta = Math.abs(originalDecision.score - counterfactualDecision.score);
  const reasonCodesDiverge = symmetricDifference(
    originalDecision.reasonCodes,
    counterfactualDecision.reasonCodes,
  );
  const violatesFairness = outcomeDiverges || scoreDelta > tolerance;
  return {
    pair,
    originalDecision,
    counterfactualDecision,
    outcomeDiverges,
    scoreDelta,
    reasonCodesDiverge,
    violatesFairness,
  };
}

export async function aggregatePairs(
  brain: FairnessBrain,
  pairs: ReadonlyArray<CounterfactualPair>,
  spec: ProtectedAttributeSpec,
  jurisdiction: Jurisdiction,
  tolerance: number,
): Promise<ViolationReport> {
  const pairScores: FairnessScore[] = [];
  for (const p of pairs) {
    pairScores.push(await scorePair(brain, p, tolerance));
  }
  const violations = pairScores.filter((s) => s.violatesFairness).length;
  const worstScoreDelta = pairScores.reduce(
    (max, s) => Math.max(max, s.scoreDelta),
    0,
  );
  return {
    attribute: spec.id,
    jurisdiction,
    citation: spec.citation,
    pairsTested: pairs.length,
    violations,
    violationRate: pairs.length === 0 ? 0 : violations / pairs.length,
    worstScoreDelta,
    pairScores,
  };
}

function symmetricDifference(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const setA = new Set(a);
  const setB = new Set(b);
  const out = new Set<string>();
  for (const x of a) if (!setB.has(x)) out.add(x);
  for (const x of b) if (!setA.has(x)) out.add(x);
  return [...out];
}

export function _exposeForTests_emptyDecision(): BrainDecision {
  return { outcome: 'escalate', score: 0.5, reasonCodes: [] };
}
