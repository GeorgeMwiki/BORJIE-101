/**
 * Heuristic PRM — rule-based step-quality scoring (Phase 1).
 *
 * Five orthogonal signals from §2.1 of the spec:
 *   1. cite_presence          — citations attached?
 *   2. compliance_precondition — required preconditions hold?
 *   3. math_check             — arithmetic balances?
 *   4. schema_validity        — tool args parse?
 *   5. policy_alignment       — autonomy + killswitch OK?
 *
 * No I/O. No mutation. Deterministic. The PRM contract requires a pure
 * function — this module is a single function, no hidden state, no
 * closures over module-level let bindings.
 */

import type { PrmFn, PrmInput, PrmOutput, PrmSignal } from '../types.js';

const SIGNAL_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  cite_presence: 0.2,
  compliance_precondition: 0.3,
  math_check: 0.2,
  schema_validity: 0.15,
  policy_alignment: 0.15,
});

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function scoreCitePresence(input: PrmInput): PrmSignal {
  const { candidateStep } = input;
  const cites = candidateStep.args['citations'] ?? candidateStep.args['cite'];
  const hasArrayOfCitations = Array.isArray(cites) && cites.length > 0;
  const isCiteLookup = candidateStep.kind === 'cite_lookup';
  const score = hasArrayOfCitations || isCiteLookup ? 1 : 0.3;
  return Object.freeze({
    name: 'cite_presence',
    score,
    weight: SIGNAL_WEIGHTS['cite_presence'] ?? 0.2,
    explanation: hasArrayOfCitations
      ? 'step carries explicit citations'
      : isCiteLookup
        ? 'step is itself a cite lookup'
        : 'no citations attached — penalised',
  });
}

function scoreCompliancePrecondition(input: PrmInput): PrmSignal {
  const { candidateStep, context } = input;
  const required = candidateStep.args['preconditions'];
  if (!Array.isArray(required) || required.length === 0) {
    return Object.freeze({
      name: 'compliance_precondition',
      score: 0.7,
      weight: SIGNAL_WEIGHTS['compliance_precondition'] ?? 0.3,
      explanation: 'no explicit preconditions declared',
    });
  }
  const satisfiedKey = 'preconditions_satisfied';
  const satisfied = candidateStep.args[satisfiedKey];
  const ok = satisfied === true;
  const tierOk = context.autonomyTier <= 3;
  const score = ok && tierOk ? 1 : 0;
  return Object.freeze({
    name: 'compliance_precondition',
    score,
    weight: SIGNAL_WEIGHTS['compliance_precondition'] ?? 0.3,
    explanation: ok
      ? 'all declared preconditions satisfied'
      : 'precondition violation — hard zero',
  });
}

function scoreMathCheck(input: PrmInput): PrmSignal {
  const { candidateStep } = input;
  const lhs = candidateStep.args['lhs'];
  const rhs = candidateStep.args['rhs'];
  const tolerance =
    typeof candidateStep.args['tolerance'] === 'number'
      ? (candidateStep.args['tolerance'] as number)
      : 0.01;
  if (typeof lhs !== 'number' || typeof rhs !== 'number') {
    return Object.freeze({
      name: 'math_check',
      score: 0.8,
      weight: SIGNAL_WEIGHTS['math_check'] ?? 0.2,
      explanation: 'no arithmetic claim to check',
    });
  }
  const diff = Math.abs(lhs - rhs);
  const ok = diff <= tolerance;
  return Object.freeze({
    name: 'math_check',
    score: ok ? 1 : 0,
    weight: SIGNAL_WEIGHTS['math_check'] ?? 0.2,
    explanation: ok
      ? `arithmetic balances (|lhs−rhs|=${diff.toFixed(4)})`
      : `arithmetic mismatch (|lhs−rhs|=${diff.toFixed(4)})`,
  });
}

function scoreSchemaValidity(input: PrmInput): PrmSignal {
  const { candidateStep } = input;
  const schemaValid = candidateStep.args['__schema_valid'];
  if (schemaValid === false) {
    return Object.freeze({
      name: 'schema_validity',
      score: 0,
      weight: SIGNAL_WEIGHTS['schema_validity'] ?? 0.15,
      explanation: 'tool args fail downstream Zod schema',
    });
  }
  return Object.freeze({
    name: 'schema_validity',
    score: 1,
    weight: SIGNAL_WEIGHTS['schema_validity'] ?? 0.15,
    explanation: 'tool args structurally valid',
  });
}

function scorePolicyAlignment(input: PrmInput): PrmSignal {
  const { context } = input;
  if (context.killswitchActive) {
    return Object.freeze({
      name: 'policy_alignment',
      score: 0,
      weight: SIGNAL_WEIGHTS['policy_alignment'] ?? 0.15,
      explanation: 'killswitch active — all steps zero-rated',
    });
  }
  const tier = context.autonomyTier;
  const score = tier === 1 ? 1 : tier === 2 ? 0.8 : 0.6;
  return Object.freeze({
    name: 'policy_alignment',
    score,
    weight: SIGNAL_WEIGHTS['policy_alignment'] ?? 0.15,
    explanation: `autonomy tier ${String(tier)} — ${score === 1 ? 'fully autonomous' : 'gated'}`,
  });
}

function aggregate(signals: ReadonlyArray<PrmSignal>): number {
  const totalWeight = signals.reduce((acc, s) => acc + s.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = signals.reduce((acc, s) => acc + s.score * s.weight, 0);
  return clamp01(weighted / totalWeight);
}

/**
 * The heuristic PRM. Deterministic, pure, no I/O.
 */
export const heuristicPrm: PrmFn = (input: PrmInput): PrmOutput => {
  const signals = Object.freeze([
    scoreCitePresence(input),
    scoreCompliancePrecondition(input),
    scoreMathCheck(input),
    scoreSchemaValidity(input),
    scorePolicyAlignment(input),
  ]);
  const score = aggregate(signals);
  const hardZero = signals.some(
    (s) =>
      s.score === 0 &&
      (s.name === 'compliance_precondition' ||
        s.name === 'schema_validity' ||
        s.name === 'policy_alignment'),
  );
  const finalScore = hardZero ? 0 : score;
  return Object.freeze({
    score: finalScore,
    confidence: 0.7,
    signals,
    explanation: hardZero
      ? 'hard-zero from compliance/schema/policy guard'
      : `weighted ${finalScore.toFixed(3)} across 5 signals`,
  });
};
