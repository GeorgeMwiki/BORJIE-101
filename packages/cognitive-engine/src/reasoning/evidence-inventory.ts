/**
 * Evidence inventory — Discipline 1, stage 2.
 *
 * Surveys the candidate evidence pool for the current intent: corpus,
 * data joins, research artifacts, recent ingests, UI-state snapshots.
 * Pure scoring — does NOT fetch new evidence. Inputs are caller-supplied
 * candidate refs annotated with relevance + quality; the inventory just
 * stamps them as `EvidenceItem`s.
 *
 * @module @borjie/cognitive-engine/reasoning/evidence-inventory
 */

import type { EvidenceItem } from '../types.js';

export interface CandidateEvidence {
  readonly kind: EvidenceItem['kind'];
  readonly ref_id: string;
  readonly relevance: number;
  readonly quality: number;
  readonly summary?: string;
}

/** Sort by relevance desc, then quality desc. Deterministic. */
export function buildEvidenceInventory(
  candidates: ReadonlyArray<CandidateEvidence>,
): ReadonlyArray<EvidenceItem> {
  return candidates
    .filter((c) => c.relevance > 0 && c.quality > 0)
    .map((c): EvidenceItem => {
      const base = {
        kind: c.kind,
        ref_id: c.ref_id,
        relevance: clamp01(c.relevance),
        quality: clamp01(c.quality),
      } as const;
      return c.summary === undefined ? base : { ...base, summary: c.summary };
    })
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return b.quality - a.quality;
    });
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
