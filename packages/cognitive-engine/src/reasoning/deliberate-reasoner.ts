/**
 * Deliberate reasoner — Discipline 1 orchestrator.
 *
 * Composes intent classification + evidence inventory + sufficiency
 * check into a single `ReasoningTrace`. This is what every turn runs
 * BEFORE deciding to compose, ask, or refuse.
 *
 * The trace is private by default (never surfaced in chat) — it is
 * persisted in `cognitive_turns.reasoning_trace` and surfaced only in
 * the audit panel "explain reasoning" toggle.
 *
 * @module @borjie/cognitive-engine/reasoning/deliberate-reasoner
 */

import type {
  CognitiveLlmPort,
  EvidenceItem,
  PlanStep,
  ReasoningTrace,
  SufficiencyState,
} from '../types.js';
import {
  classifyIntent,
  type IntentKeywordPattern,
} from './intent-classifier.js';
import {
  buildEvidenceInventory,
  type CandidateEvidence,
} from './evidence-inventory.js';
import {
  checkSufficiency,
  INTENT_FLOOR,
} from './sufficiency-check.js';

export interface DeliberateReasonerInput {
  readonly utterance: string;
  readonly candidate_evidence: ReadonlyArray<CandidateEvidence>;
  readonly required_evidence_kinds: ReadonlyArray<EvidenceItem['kind']>;
  readonly is_new_user: boolean;
  readonly owner_override_just_do_it: boolean;
}

export interface DeliberateReasonerDeps {
  readonly llm?: CognitiveLlmPort;
  readonly patterns?: ReadonlyArray<IntentKeywordPattern>;
}

/** Cost estimate per plan-step kind (cents). Caller can override. */
const PLAN_STEP_COST_CENTS: Readonly<Record<PlanStep['action'], number>> = {
  classify_intent: 1,
  gather_evidence: 2,
  ask_question: 1,
  request_data: 1,
  invoke_capability: 30,
  validate_output: 5,
  calibrate_confidence: 2,
};

export async function deliberateReason(
  input: DeliberateReasonerInput,
  deps: DeliberateReasonerDeps = {},
): Promise<ReasoningTrace> {
  // Stage 1 — intent.
  const intent = await classifyIntent(input.utterance, {
    ...(deps.patterns !== undefined ? { patterns: deps.patterns } : {}),
    ...(deps.llm !== undefined ? { llm: deps.llm } : {}),
  });

  // Stage 2 — evidence inventory.
  const evidence = buildEvidenceInventory(input.candidate_evidence);

  // Stage 3 — sufficiency.
  const sufficiency = checkSufficiency({
    intent: intent.intent,
    intent_confidence: intent.confidence,
    evidence,
    required_evidence_kinds: input.required_evidence_kinds,
    is_new_user: input.is_new_user,
    owner_override_just_do_it: input.owner_override_just_do_it,
  });

  // Stage 4 — plan.
  const planSteps = buildPlan(sufficiency.sufficiency);

  // Stage 5 — expected confidence.
  const expected = expectedConfidence(evidence, intent.confidence);

  const cost = planSteps.reduce((acc, s) => acc + s.expected_cost_cents, 0);

  return {
    intent_classification: intent,
    evidence_inventory: evidence,
    sufficiency: sufficiency.sufficiency,
    plan_steps: planSteps,
    expected_confidence: expected,
    cost_estimate_usd_cents: cost,
  };
}

function buildPlan(sufficiency: SufficiencyState): ReadonlyArray<PlanStep> {
  const steps: Array<PlanStep> = [
    {
      step_id: 's1',
      action: 'classify_intent',
      description: 'Classify the user intent against the pattern library',
      expected_cost_cents: PLAN_STEP_COST_CENTS.classify_intent,
    },
    {
      step_id: 's2',
      action: 'gather_evidence',
      description: 'Survey corpus + data joins + research artifacts',
      expected_cost_cents: PLAN_STEP_COST_CENTS.gather_evidence,
    },
  ];
  switch (sufficiency) {
    case 'needs_clarification':
      steps.push({
        step_id: 's3',
        action: 'ask_question',
        description: 'Emit 1-2 clarifying questions',
        expected_cost_cents: PLAN_STEP_COST_CENTS.ask_question,
      });
      break;
    case 'needs_data':
      steps.push({
        step_id: 's3',
        action: 'request_data',
        description: 'Issue a DataRequest chip with upload affordance',
        expected_cost_cents: PLAN_STEP_COST_CENTS.request_data,
      });
      break;
    case 'needs_research':
      steps.push({
        step_id: 's3',
        action: 'invoke_capability',
        description: 'Invoke research_v1 to fill the evidence gap',
        expected_cost_cents: PLAN_STEP_COST_CENTS.invoke_capability,
      });
      break;
    case 'sufficient':
      steps.push(
        {
          step_id: 's3',
          action: 'invoke_capability',
          description: 'Dispatch compose_anything_v1',
          expected_cost_cents: PLAN_STEP_COST_CENTS.invoke_capability,
        },
        {
          step_id: 's4',
          action: 'validate_output',
          description: 'Cite-validator pass over candidate output',
          expected_cost_cents: PLAN_STEP_COST_CENTS.validate_output,
        },
        {
          step_id: 's5',
          action: 'calibrate_confidence',
          description: 'Compute high/medium/low/refused label',
          expected_cost_cents: PLAN_STEP_COST_CENTS.calibrate_confidence,
        },
      );
      break;
    default:
      // exhaustiveness — should not happen
      break;
  }
  return steps;
}

function expectedConfidence(
  evidence: ReadonlyArray<EvidenceItem>,
  intentConfidence: number,
): 'high' | 'medium' | 'low' {
  if (evidence.length === 0 || intentConfidence < INTENT_FLOOR) return 'low';
  const meanQuality =
    evidence.reduce((acc, e) => acc + e.quality, 0) / evidence.length;
  if (evidence.length >= 3 && meanQuality >= 0.75) return 'high';
  if (meanQuality >= 0.5) return 'medium';
  return 'low';
}
