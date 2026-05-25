/**
 * Proximity agent — Co-Scientist agent #5 of 6.
 *
 * Role: surface related prior hypotheses for each candidate. Helps
 * the orchestrator avoid re-investigating the same question and lets
 * the Discovery Card link back to a prior verified pattern.
 *
 * Pure function over (hypothesis, archive). The "archive" is just an
 * in-memory list — the persistence layer is the orchestrator's call.
 *
 * Similarity is computed via Jaccard over the set
 *   {treatment, outcome, ...confounders, area, perspective}
 * — cheap, deterministic, no LLM needed.
 */

import type { Hypothesis } from '../types.js';

export interface ProximityLink {
  readonly hypothesisId: string;
  readonly relatedId: string;
  readonly similarity: number;
}

export function findProximityLinks(
  candidates: readonly Hypothesis[],
  archive: readonly Hypothesis[],
  threshold = 0.4,
): readonly ProximityLink[] {
  const out: ProximityLink[] = [];
  for (const c of candidates) {
    const cKey = featureSet(c);
    for (const a of archive) {
      if (a.id === c.id) continue;
      const sim = jaccard(cKey, featureSet(a));
      if (sim >= threshold) {
        out.push({ hypothesisId: c.id, relatedId: a.id, similarity: sim });
      }
    }
  }
  return out;
}

function featureSet(h: Hypothesis): ReadonlySet<string> {
  return new Set<string>([
    `t:${h.treatment}`,
    `o:${h.outcome}`,
    `area:${h.area}`,
    `persp:${h.owningPerspective}`,
    ...h.confounders.map((c) => `c:${c}`),
  ]);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) {
    if (b.has(x)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
