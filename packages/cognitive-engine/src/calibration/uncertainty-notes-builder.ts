/**
 * Uncertainty-notes builder — Discipline 3 sidecar.
 *
 * Produces human-readable "verify before relying" notes that surface
 * alongside low/medium-confidence outputs. Pure function over the
 * confidence components + cite-validator result.
 *
 * @module @borjie/cognitive-engine/calibration/uncertainty-notes-builder
 */

import type { UncertaintyNote } from '../types.js';
import type { ConfidenceResult } from './confidence-calibrator.js';

export interface UncertaintyInput {
  readonly confidence: ConfidenceResult;
  readonly uncited_claims_after_rewrite: number;
  readonly tenant_gap_summary?: string;
}

export function buildUncertaintyNotes(
  input: UncertaintyInput,
): ReadonlyArray<UncertaintyNote> {
  const notes: Array<UncertaintyNote> = [];

  if (input.confidence.components.agreement < 0.5) {
    notes.push({
      kind: 'low_corroboration',
      note:
        'Sources disagree — recommend confirming with a second authoritative reference.',
    });
  }

  if (input.confidence.components.recency < 0.3) {
    notes.push({
      kind: 'stale_evidence',
      note:
        'Cited evidence is over 60 days old — fast-moving topic; verify before relying.',
    });
  }

  if (input.confidence.components.corpus < 0.6) {
    notes.push({
      kind: 'corpus_contradiction',
      note:
        'This output partially contradicts owner corpus rules — review the corpus delta.',
    });
  }

  if (input.uncited_claims_after_rewrite > 0) {
    notes.push({
      kind: 'low_corroboration',
      note: `${input.uncited_claims_after_rewrite} claim(s) marked unverified after rewrite — confirm manually.`,
    });
  }

  if (input.tenant_gap_summary !== undefined && input.tenant_gap_summary.length > 0) {
    notes.push({
      kind: 'tenant_gap',
      note: input.tenant_gap_summary,
    });
  }

  return notes;
}
