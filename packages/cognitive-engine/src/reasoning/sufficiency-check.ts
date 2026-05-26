/**
 * Sufficiency check — Discipline 1, stage 3.
 *
 * Decides whether the engine has enough evidence to act, or whether it
 * needs to ask the owner a question or request data. Pure-rule based
 * (no LLM call) — fast, deterministic, auditable.
 *
 * Source of truth: COGNITIVE_ENGINE_SPEC.md §6 (decision table).
 *
 * @module @borjie/cognitive-engine/reasoning/sufficiency-check
 */

import type {
  EvidenceItem,
  IngestKind,
  SufficiencyState,
} from '../types.js';

export interface SufficiencyInput {
  readonly intent: string;
  readonly intent_confidence: number;
  readonly evidence: ReadonlyArray<EvidenceItem>;
  /** Critical evidence kinds the caller asserts the intent NEEDS. */
  readonly required_evidence_kinds: ReadonlyArray<EvidenceItem['kind']>;
  /** True when the user has been signed up for <14 days. */
  readonly is_new_user: boolean;
  /** True if the recent context contains an explicit override
   *  like "just do it" / "I trust you, decide". */
  readonly owner_override_just_do_it: boolean;
}

export interface SufficiencyDecision {
  readonly sufficiency: SufficiencyState;
  readonly missing_kinds: ReadonlyArray<EvidenceItem['kind']>;
  /** Hint to the data-request builder about the preferred upload kind. */
  readonly preferred_data_kind?: IngestKind;
  readonly rationale: string;
}

/** Confidence floor — matches `MIN_INTENT_CONFIDENCE` from
 *  `@borjie/dynamic-ui/intent-recognition`. */
export const INTENT_FLOOR = 0.7;

export function checkSufficiency(input: SufficiencyInput): SufficiencyDecision {
  // 1. Owner-override bypass.
  if (input.owner_override_just_do_it) {
    return {
      sufficiency: 'sufficient',
      missing_kinds: [],
      rationale: 'owner override (just-do-it) — bypassing scoping',
    };
  }

  // 2. Low-confidence intent → clarify.
  if (input.intent_confidence < INTENT_FLOOR) {
    return {
      sufficiency: 'needs_clarification',
      missing_kinds: [],
      rationale: `intent_confidence=${input.intent_confidence.toFixed(2)} below floor ${INTENT_FLOOR}`,
    };
  }

  // 3. Missing required evidence → data request.
  const presentKinds = new Set(input.evidence.map((e) => e.kind));
  const missing = input.required_evidence_kinds.filter((k) => !presentKinds.has(k));
  if (missing.length > 0) {
    const base = {
      sufficiency: 'needs_data' as const,
      missing_kinds: missing,
      rationale: `missing required evidence kinds: ${missing.join(', ')}`,
    };
    const preferred = inferPreferredKind(missing);
    return preferred === undefined
      ? base
      : { ...base, preferred_data_kind: preferred };
  }

  // 4. New user + broad intent (no evidence yet) → scoping conversation.
  if (input.is_new_user && input.evidence.length === 0) {
    return {
      sufficiency: 'needs_clarification',
      missing_kinds: [],
      rationale: 'new user + no evidence — start with scoping',
    };
  }

  // 5. All checks passed.
  return {
    sufficiency: 'sufficient',
    missing_kinds: [],
    rationale: 'evidence + intent thresholds met',
  };
}

function inferPreferredKind(
  missing: ReadonlyArray<EvidenceItem['kind']>,
): IngestKind | undefined {
  if (missing.includes('ingest')) return 'excel';
  if (missing.includes('data_join')) return 'csv';
  return undefined;
}
