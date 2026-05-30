/**
 * Cross-Source Synthesizer
 *
 * Given N evidence candidates from N different domains, decide whether they
 * agree, disagree, or are too thin to commit. Returns:
 *
 *   - 'consensus'    : >=2 sources agree on the same numeric within tolerance
 *   - 'partial'      : single high-authority source carries the answer alone
 *   - 'disputed'     : sources disagree beyond tolerance
 *   - 'insufficient' : <1 usable source
 *
 * Pure synthesis — no DB writes, no LLM calls. Caller (research-loop) decides
 * how to act on each verdict.
 */

import type { CandidateEvidence } from "./types";
import { extractDomain } from "./source-authority";

const NUMERIC_TOLERANCE = 0.05;

export type SynthesisVerdict =
  | "consensus"
  | "partial"
  | "disputed"
  | "insufficient";

export interface SynthesisResult {
  readonly verdict: SynthesisVerdict;
  readonly agreeingDomains: readonly string[];
  readonly conflictingDomains: readonly string[];
  readonly leadingNumeric: number | null;
  readonly notes: string;
}

/**
 * Inspect candidate evidence and decide the synthesis verdict.
 */
export function synthesizeAcrossSources(
  candidates: readonly CandidateEvidence[],
): SynthesisResult {
  const usable = candidates.filter((c) => c.excerpt && c.excerpt.length >= 30);

  if (usable.length === 0) {
    return {
      verdict: "insufficient",
      agreeingDomains: [],
      conflictingDomains: [],
      leadingNumeric: null,
      notes: "no usable excerpts",
    };
  }

  // Extract numeric value (largest number that's not a year > 1900) per evidence
  const numerics = usable
    .map((c) => ({
      domain: c.sourceDomain ?? extractDomain(c.sourceUrl ?? "") ?? "unknown",
      value: extractLeadingNumber(c.excerpt),
    }))
    .filter((n): n is { domain: string; value: number } => n.value !== null);

  if (numerics.length === 0) {
    // No numbers — fall back to text-only consensus
    return {
      verdict: usable.length >= 2 ? "consensus" : "partial",
      agreeingDomains: usable.map(
        (c) => c.sourceDomain ?? extractDomain(c.sourceUrl ?? "") ?? "unknown",
      ),
      conflictingDomains: [],
      leadingNumeric: null,
      notes: "non-numeric synthesis",
    };
  }

  // Find largest cluster of agreeing numerics
  let bestCluster: { domain: string; value: number }[] = [];
  for (const anchor of numerics) {
    const cluster = numerics.filter((n) =>
      withinTolerance(anchor.value, n.value),
    );
    if (cluster.length > bestCluster.length) bestCluster = cluster;
  }

  const conflicting = numerics.filter(
    (n) => !bestCluster.some((c) => c.domain === n.domain),
  );

  if (bestCluster.length >= 2) {
    return {
      verdict: "consensus",
      agreeingDomains: bestCluster.map((c) => c.domain),
      conflictingDomains: conflicting.map((c) => c.domain),
      leadingNumeric: bestCluster[0].value,
      notes: `${bestCluster.length}/${numerics.length} agreeing within ${(NUMERIC_TOLERANCE * 100).toFixed(0)}%`,
    };
  }

  if (numerics.length >= 2 && conflicting.length > 0) {
    return {
      verdict: "disputed",
      agreeingDomains: bestCluster.map((c) => c.domain),
      conflictingDomains: conflicting.map((c) => c.domain),
      leadingNumeric: bestCluster[0]?.value ?? null,
      notes: "sources disagree beyond tolerance",
    };
  }

  return {
    verdict: "partial",
    agreeingDomains: bestCluster.map((c) => c.domain),
    conflictingDomains: [],
    leadingNumeric: bestCluster[0]?.value ?? null,
    notes: "single source",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractLeadingNumber(text: string): number | null {
  // Skip years (1900-2099) which often dominate excerpts but aren't the fact
  const matches = text.match(/[\d,]+(?:\.\d+)?/g);
  if (!matches) return null;
  for (const m of matches) {
    const value = parseFloat(m.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    if (Number.isInteger(value) && value >= 1900 && value <= 2099) continue;
    return value;
  }
  return null;
}

function withinTolerance(a: number, b: number): boolean {
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return a === b;
  return Math.abs(a - b) / larger <= NUMERIC_TOLERANCE;
}
