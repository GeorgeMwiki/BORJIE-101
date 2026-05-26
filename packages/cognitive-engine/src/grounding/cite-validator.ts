/**
 * Cite-validator — Discipline 2 orchestrator.
 *
 * Pre-output validator. Every claim sentence must have a resolvable
 * `citation_id`. Outputs the rewritten text + a per-sentence verdict
 * map + a global decision (`pass | rewrite | reject`).
 *
 * Source of truth: COGNITIVE_ENGINE_SPEC.md §5.
 *
 * @module @borjie/cognitive-engine/grounding/cite-validator
 */

import type { SpanCitation } from '../types.js';
import { classifySentences, type ClassifiedSentence } from './claim-extractor.js';
import { buildCitationIndex, resolveCitations } from './citation-resolver.js';

export type Verdict = 'pass' | 'uncited' | 'faked';

export interface ValidatedSentence extends ClassifiedSentence {
  readonly verdict: Verdict;
}

export interface CiteValidatorResult {
  readonly sentences: ReadonlyArray<ValidatedSentence>;
  readonly rewritten_text: string;
  /** Fraction of claim sentences that failed. */
  readonly failure_rate: number;
  readonly decision: 'pass' | 'rewrite' | 'reject';
  /** Tier reduction to apply downstream: 0 = no change, 1 = drop one tier. */
  readonly confidence_tier_reduction: 0 | 1 | 2;
}

/** Threshold: above this, reject the entire output. Spec §5 step 5. */
export const REJECT_FAILURE_RATE = 0.2;

export function validateCitations(
  text: string,
  citations: ReadonlyArray<SpanCitation>,
): CiteValidatorResult {
  const sentences = classifySentences(text);
  const index = buildCitationIndex(citations);

  const validated: Array<ValidatedSentence> = [];
  let claimCount = 0;
  let failedCount = 0;
  let fakedAny = false;

  for (const s of sentences) {
    if (!s.is_claim) {
      validated.push({ ...s, verdict: 'pass' });
      continue;
    }
    claimCount += 1;
    if (s.citation_markers.length === 0) {
      failedCount += 1;
      validated.push({ ...s, verdict: 'uncited' });
      continue;
    }
    const resolutions = resolveCitations(s.citation_markers, index);
    const allResolved = resolutions.every((r) => r.resolved);
    if (!allResolved) {
      failedCount += 1;
      fakedAny = true;
      validated.push({ ...s, verdict: 'faked' });
      continue;
    }
    validated.push({ ...s, verdict: 'pass' });
  }

  const failureRate = claimCount === 0 ? 0 : failedCount / claimCount;

  // Faked citation = nuclear; spec §5 step 4. We still rewrite the text
  // to remove the faked marker, but decision is reject.
  if (fakedAny) {
    return {
      sentences: validated,
      rewritten_text: rewriteText(validated),
      failure_rate: failureRate,
      decision: 'reject',
      confidence_tier_reduction: 2,
    };
  }

  if (failureRate > REJECT_FAILURE_RATE) {
    return {
      sentences: validated,
      rewritten_text: rewriteText(validated),
      failure_rate: failureRate,
      decision: 'reject',
      confidence_tier_reduction: 2,
    };
  }

  if (failedCount > 0) {
    return {
      sentences: validated,
      rewritten_text: rewriteText(validated),
      failure_rate: failureRate,
      decision: 'rewrite',
      confidence_tier_reduction: 1,
    };
  }

  return {
    sentences: validated,
    rewritten_text: text,
    failure_rate: 0,
    decision: 'pass',
    confidence_tier_reduction: 0,
  };
}

function rewriteText(
  sentences: ReadonlyArray<ValidatedSentence>,
): string {
  return sentences
    .map((s) => {
      if (s.verdict === 'uncited') {
        return '[unverified — please confirm]';
      }
      if (s.verdict === 'faked') {
        // Strip the faked markers entirely.
        return s.text.replace(/\[cit_[a-zA-Z0-9_-]+\]/g, '').trim();
      }
      return s.text;
    })
    .join(' ');
}
