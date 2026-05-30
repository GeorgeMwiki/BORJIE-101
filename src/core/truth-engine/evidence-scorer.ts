/**
 * Evidence Scorer
 *
 * Aggregates evidence quality into a single confidence score in [0, 1] that
 * decides whether a claim is `verified` (>= 0.8), `pending_review` (0.6-0.8),
 * or rejected (< 0.6).
 *
 * Scoring rules (immutable):
 *   - One Tier-1 source (authority >= 0.95)         -> 0.85 confidence
 *   - One Tier-2 source (authority 0.85-0.94)        -> 0.70 confidence
 *   - Two corroborating Tier-2 sources               -> 0.85 confidence
 *   - Three corroborating sources of any tier        -> 0.85 confidence (consensus boost)
 *   - LLM-only consensus (3 providers agree)         -> 0.65 confidence (research-grade only)
 *   - Single low-authority source (< 0.7)            -> capped at 0.55 (rejected)
 *
 * Recency penalty:
 *   - If newest evidence is older than category TTL  -> multiply by 0.8
 *
 * Disagreement penalty:
 *   - If evidence values disagree numerically beyond tolerance, drop to 0.4 (disputed)
 */

import type {
  CandidateEvidence,
  ClaimCategory,
  TruthEvidenceRow,
} from "./types";
import { resolveSourceAuthority, extractDomain } from "./source-authority";
import { TTL_BY_CATEGORY } from "./ttl-policy";

const TIER_1_THRESHOLD = 0.95;
const TIER_2_THRESHOLD = 0.85;

export interface ScoredEvidence {
  readonly authority: number;
  readonly evidence: CandidateEvidence;
  readonly resolvedDomain: string | null;
}

/** Resolve authority for every candidate evidence record. */
export function scoreCandidates(
  candidates: readonly CandidateEvidence[],
): readonly ScoredEvidence[] {
  return candidates.map((evidence) => {
    const resolvedDomain =
      evidence.sourceDomain ??
      (evidence.sourceUrl ? extractDomain(evidence.sourceUrl) : null);
    const authority = resolveSourceAuthority({
      sourceUrl: evidence.sourceUrl,
      sourceDomain: resolvedDomain,
      sourceType: evidence.sourceType,
    });
    return { authority, evidence, resolvedDomain };
  });
}

/**
 * Compute aggregate confidence from a set of evidence records. Pure function;
 * caller is responsible for persisting the result.
 */
export function computeConfidence(
  scored: readonly ScoredEvidence[],
  category: ClaimCategory,
  newestRetrievedAt: Date | null = null,
): number {
  if (scored.length === 0) return 0;

  const tier1 = scored.filter((s) => s.authority >= TIER_1_THRESHOLD).length;
  const tier2 = scored.filter(
    (s) => s.authority >= TIER_2_THRESHOLD && s.authority < TIER_1_THRESHOLD,
  ).length;
  const total = scored.length;

  let confidence: number;

  if (tier1 >= 1) {
    confidence = 0.85 + Math.min(0.1, (tier1 - 1) * 0.05);
  } else if (tier2 >= 2) {
    confidence = 0.85;
  } else if (tier2 >= 1) {
    confidence = 0.7;
  } else if (total >= 3) {
    confidence = 0.75;
  } else if (
    scored.some((s) => s.evidence.sourceType === "llm_consensus") &&
    total >= 2
  ) {
    confidence = 0.65;
  } else {
    confidence = Math.min(0.55, scored[0]?.authority ?? 0.4);
  }

  // Recency penalty
  if (newestRetrievedAt) {
    const ageSeconds = (Date.now() - newestRetrievedAt.getTime()) / 1000;
    const ttl = TTL_BY_CATEGORY[category];
    if (ageSeconds > ttl) {
      confidence = confidence * 0.8;
    }
  }

  return Math.min(1, Math.max(0, Number(confidence.toFixed(3))));
}

/**
 * Detect numeric disagreement across evidence. Returns true if any two
 * evidence excerpts contain numbers that differ by more than `tolerance`
 * percent of the larger value. Triggers `disputed` status.
 */
export function detectNumericDisagreement(
  evidenceList: readonly CandidateEvidence[] | readonly TruthEvidenceRow[],
  tolerancePercent = 0.05,
): boolean {
  const numbers: number[] = [];
  for (const e of evidenceList) {
    const matches = e.excerpt.match(/[\d,]+\.?\d*/g);
    if (!matches) continue;
    for (const m of matches) {
      const n = parseFloat(m.replace(/,/g, ""));
      if (!Number.isNaN(n) && n > 0) numbers.push(n);
    }
  }
  if (numbers.length < 2) return false;

  for (let i = 0; i < numbers.length; i++) {
    for (let j = i + 1; j < numbers.length; j++) {
      const a = numbers[i];
      const b = numbers[j];
      const larger = Math.max(a, b);
      if (larger === 0) continue;
      const diff = Math.abs(a - b) / larger;
      if (diff > tolerancePercent) return true;
    }
  }
  return false;
}

/**
 * Determine target status for a freshly-scored claim:
 *   - confidence >= 0.85 with at least one Tier-1 OR two Tier-2 -> 'verified'
 *   - confidence 0.6-0.85                                        -> 'pending_review'
 *   - confidence < 0.6                                           -> rejected (caller should not persist)
 *   - any numeric disagreement                                   -> 'disputed'
 */
export function classifyClaimStatus(
  scored: readonly ScoredEvidence[],
  confidence: number,
  hasDisagreement: boolean,
): "verified" | "pending_review" | "disputed" | "rejected" {
  if (hasDisagreement) return "disputed";
  if (confidence < 0.6) return "rejected";
  if (confidence < 0.85) return "pending_review";

  const tier1 = scored.filter((s) => s.authority >= TIER_1_THRESHOLD).length;
  const tier2 = scored.filter(
    (s) => s.authority >= TIER_2_THRESHOLD && s.authority < TIER_1_THRESHOLD,
  ).length;

  if (tier1 >= 1 || tier2 >= 2) return "verified";
  return "pending_review";
}
