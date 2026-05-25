/**
 * Discovery Card builder — emits the admin-portal render contract.
 *
 * Given a ranked hypothesis + its CausalFusion result + the active
 * reflections, produce a `DiscoveryCard` object suitable for direct
 * JSON serialisation into the API gateway response.
 *
 * Pure function. No I/O. Order of evidence chips is deterministic so
 * snapshot tests are stable.
 */

import type {
  CausalFusionResult,
  DiscoveryCard,
  Evidence,
  Hypothesis,
  RankedHypothesis,
} from '../types.js';
import type { ReflectionVerdict } from '../co-scientist/reflection-agent.js';

export interface CardBuilderInput {
  readonly ranked: RankedHypothesis;
  readonly causalFusion: CausalFusionResult | undefined;
  readonly reflection: ReflectionVerdict | undefined;
  readonly now: string;
  /** Stable id, usually `${runId}-${ranked.hypothesis.id}`. */
  readonly cardId: string;
}

export function buildDiscoveryCard(input: CardBuilderInput): DiscoveryCard {
  const h: Hypothesis = input.ranked.hypothesis;
  const fusion = input.causalFusion;
  const evidence = buildEvidence(fusion, input.reflection);
  const riskScore = computeRiskScore(fusion, input.reflection);

  return {
    id: input.cardId,
    title: buildTitle(h),
    hypothesis: h,
    dag: fusion?.dag ?? emptyDag(h),
    refutation: fusion?.refutationScores ?? blankRefutation(),
    evidence,
    elo: input.ranked.elo,
    recommendedAction: buildRecommendedAction(h, fusion),
    riskScore,
    perspective: h.owningPerspective,
    createdAt: input.now,
  };
}

function buildTitle(h: Hypothesis): string {
  return `${capitalise(h.area)}: ${h.treatment} → ${h.outcome}`;
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function buildEvidence(
  fusion: CausalFusionResult | undefined,
  reflection: ReflectionVerdict | undefined,
): readonly Evidence[] {
  const out: Evidence[] = [];
  if (fusion) {
    out.push({
      kind: fusion.kept ? 'refutation_passed' : 'refutation_failed',
      summary: fusion.rationale,
      strength: averageRefutation(fusion),
    });
  }
  if (reflection) {
    out.push({
      kind: 'expert_prior',
      summary: reflection.critique || 'Reflection critique unavailable.',
      strength: reflection.score,
    });
  }
  return out;
}

function averageRefutation(fusion: CausalFusionResult): number {
  const s = fusion.refutationScores;
  const parts: number[] = [s.placebo, s.bootstrap, s.unobservedConfounder];
  if (s.conditionalIndependence !== undefined) parts.push(s.conditionalIndependence);
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

function computeRiskScore(
  fusion: CausalFusionResult | undefined,
  reflection: ReflectionVerdict | undefined,
): number {
  // Risk falls as evidence rises. Cap at [0,1].
  let evidence = 0;
  let weight = 0;
  if (fusion) {
    evidence += averageRefutation(fusion);
    weight += 1;
  }
  if (reflection) {
    evidence += reflection.score;
    weight += 1;
  }
  if (weight === 0) return 1; // No evidence ⇒ max risk.
  const avg = evidence / weight;
  const risk = 1 - avg;
  return Math.min(1, Math.max(0, risk));
}

function buildRecommendedAction(h: Hypothesis, fusion: CausalFusionResult | undefined): string {
  if (!fusion) {
    return `Investigate further: collect baseline data for ${h.treatment} and ${h.outcome}.`;
  }
  if (fusion.kept) {
    return `Run a sandboxed A/B varying ${h.treatment} for the ${h.area} cohort; measure ${h.outcome} over 90 days.`;
  }
  return `Hypothesis dropped at refutation. Park, and revisit when ${h.confounders.join(', ') || 'more controls'} are richer.`;
}

function emptyDag(h: Hypothesis): DiscoveryCard['dag'] {
  return {
    nodes: [h.treatment, h.outcome],
    edges: [{ from: h.treatment, to: h.outcome }],
    candidateEdges: [],
  };
}

function blankRefutation(): DiscoveryCard['refutation'] {
  return {
    placebo: 0,
    bootstrap: 0,
    unobservedConfounder: 0,
  };
}
