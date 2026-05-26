/**
 * Cognitive loop — orchestrates the 6 disciplines per turn.
 *
 * The shape of the loop mirrors COGNITIVE_ENGINE_SPEC.md §3. The
 * compose-anything dispatcher is INJECTED — this package does NOT
 * import any capability package directly. The kernel-integration
 * shim (`./kernel-integration.ts`) wires the dispatcher at the
 * composition root.
 *
 * @module @borjie/cognitive-engine/runtime/cognitive-loop
 */

import type {
  ArtifactRef,
  ClockPort,
  CognitiveLlmPort,
  CognitiveTurnInput,
  CognitiveTurnOutput,
  EvidenceItem,
  SpanCitation,
} from '../types.js';
import {
  deliberateReason,
  type DeliberateReasonerDeps,
} from '../reasoning/deliberate-reasoner.js';
import { checkSufficiency } from '../reasoning/sufficiency-check.js';
import { decideScope } from '../scoping/interactive-scoper.js';
import { validateCitations } from '../grounding/cite-validator.js';
import {
  calibrateConfidence,
  reduceTier,
} from '../calibration/confidence-calibrator.js';
import { buildUncertaintyNotes } from '../calibration/uncertainty-notes-builder.js';
import { computeTurnAuditHash } from '../audit/audit-chain-link.js';
import type { CandidateEvidence } from '../reasoning/evidence-inventory.js';

/** Dispatcher port — injected by the kernel composition root. The
 *  cognitive engine never imports a capability package directly. */
export interface ComposeAnythingDispatcherPort {
  readonly dispatch: (input: {
    readonly tenant_id: string;
    readonly user_id: string;
    readonly intent: string;
    readonly utterance: string;
    readonly evidence: ReadonlyArray<EvidenceItem>;
  }) => Promise<{
    readonly artifact_ref: ArtifactRef;
    readonly text: string;
    readonly citations: ReadonlyArray<SpanCitation>;
    readonly cost_usd_cents: number;
    readonly source_quality_mean: number;
    readonly agreement_rate: number;
    readonly corpus_consistency: number;
    readonly days_since_evidence: number;
  }>;
}

export interface CognitiveLoopInput {
  readonly turn: CognitiveTurnInput;
  readonly candidate_evidence: ReadonlyArray<CandidateEvidence>;
  readonly required_evidence_kinds: ReadonlyArray<EvidenceItem['kind']>;
  readonly owner_override_just_do_it: boolean;
  readonly questions_asked_this_turn: number;
  readonly template_questions?: ReadonlyArray<{
    readonly question: string;
    readonly why_needed: string;
    readonly possible_answers?: ReadonlyArray<string>;
  }>;
}

export interface CognitiveLoopDeps {
  readonly dispatcher: ComposeAnythingDispatcherPort;
  readonly llm?: CognitiveLlmPort;
  readonly clock?: ClockPort;
  readonly reasoning?: DeliberateReasonerDeps;
}

export async function runCognitiveLoop(
  input: CognitiveLoopInput,
  deps: CognitiveLoopDeps,
): Promise<CognitiveTurnOutput> {
  const clock = deps.clock ?? { now: () => new Date() };
  const start = clock.now().getTime();

  // Discipline 1 — deliberate reasoning.
  const reasoning = await deliberateReason(
    {
      utterance: input.turn.utterance,
      candidate_evidence: input.candidate_evidence,
      required_evidence_kinds: input.required_evidence_kinds,
      is_new_user: input.turn.is_new_user,
      owner_override_just_do_it: input.owner_override_just_do_it,
    },
    {
      ...(deps.reasoning?.llm !== undefined ? { llm: deps.reasoning.llm } : {}),
      ...(deps.reasoning?.patterns !== undefined
        ? { patterns: deps.reasoning.patterns }
        : {}),
      ...(deps.llm !== undefined && deps.reasoning?.llm === undefined
        ? { llm: deps.llm }
        : {}),
    },
  );

  // Discipline 4 — interactive scoping (only when sufficiency is short).
  if (
    reasoning.sufficiency === 'needs_clarification' ||
    reasoning.sufficiency === 'needs_data'
  ) {
    const decision = checkSufficiency({
      intent: reasoning.intent_classification.intent,
      intent_confidence: reasoning.intent_classification.confidence,
      evidence: reasoning.evidence_inventory,
      required_evidence_kinds: input.required_evidence_kinds,
      is_new_user: input.turn.is_new_user,
      owner_override_just_do_it: input.owner_override_just_do_it,
    });
    const scope = decideScope({
      sufficiency: decision,
      intent: reasoning.intent_classification.intent,
      is_new_user: input.turn.is_new_user,
      questions_asked_this_turn: input.questions_asked_this_turn,
      ...(input.template_questions !== undefined
        ? { template_questions: input.template_questions }
        : {}),
    });

    const occurredAtIso = clock.now().toISOString();
    const path =
      scope.path === 'request_data'
        ? 'asked_for_data'
        : scope.path === 'ask'
          ? 'asked_for_clarification'
          : 'composed_output';
    const auditHash = computeTurnAuditHash({
      turn_id: input.turn.turn_id,
      tenant_id: input.turn.tenant_id,
      session_id: input.turn.session_id,
      path,
      confidence: 'low',
      reasoning_trace: reasoning,
      citations: [],
      occurred_at_iso: occurredAtIso,
    });
    return {
      turn_id: input.turn.turn_id,
      reasoning_trace: reasoning,
      path,
      ...(scope.questions.length > 0 ? { questions: scope.questions } : {}),
      ...(scope.requested_data.length > 0
        ? { requested_data: scope.requested_data }
        : {}),
      confidence: 'low',
      citations: [],
      cost_usd_cents: reasoning.cost_estimate_usd_cents,
      duration_ms: clock.now().getTime() - start,
      audit_hash: auditHash,
    };
  }

  // Discipline 5 — relevance pruning happens implicitly in the candidate
  // list (caller pre-pruned). The dispatcher only sees the inventory.

  // Dispatch.
  const composed = await deps.dispatcher.dispatch({
    tenant_id: input.turn.tenant_id,
    user_id: input.turn.user_id,
    intent: reasoning.intent_classification.intent,
    utterance: input.turn.utterance,
    evidence: reasoning.evidence_inventory,
  });

  // Discipline 2 — cite validator.
  const validated = validateCitations(composed.text, composed.citations);

  // Discipline 3 — confidence.
  const confidence = calibrateConfidence({
    mean_source_quality: composed.source_quality_mean,
    cross_source_agreement_rate: composed.agreement_rate,
    corpus_consistency_rate: composed.corpus_consistency,
    days_since_evidence: composed.days_since_evidence,
    uncited_claims_after_rewrite:
      validated.decision === 'rewrite'
        ? validated.sentences.filter((s) => s.verdict === 'uncited').length
        : 0,
  });

  const finalLabel =
    validated.decision === 'reject'
      ? 'refused'
      : reduceTier(confidence.label, validated.confidence_tier_reduction);

  const uncertainty = buildUncertaintyNotes({
    confidence,
    uncited_claims_after_rewrite:
      validated.decision === 'rewrite'
        ? validated.sentences.filter((s) => s.verdict === 'uncited').length
        : 0,
  });

  const path: CognitiveTurnOutput['path'] =
    validated.decision === 'reject' || finalLabel === 'refused'
      ? 'refused_low_confidence'
      : 'composed_output';

  const occurredAtIso = clock.now().toISOString();
  const auditHash = computeTurnAuditHash({
    turn_id: input.turn.turn_id,
    tenant_id: input.turn.tenant_id,
    session_id: input.turn.session_id,
    path,
    confidence: finalLabel,
    reasoning_trace: reasoning,
    citations: composed.citations,
    occurred_at_iso: occurredAtIso,
  });

  return {
    turn_id: input.turn.turn_id,
    reasoning_trace: reasoning,
    path,
    artifact_ref: composed.artifact_ref,
    confidence: finalLabel,
    citations: composed.citations,
    ...(uncertainty.length > 0 ? { uncertainty_notes: uncertainty } : {}),
    cost_usd_cents: composed.cost_usd_cents + reasoning.cost_estimate_usd_cents,
    duration_ms: clock.now().getTime() - start,
    audit_hash: auditHash,
  };
}
