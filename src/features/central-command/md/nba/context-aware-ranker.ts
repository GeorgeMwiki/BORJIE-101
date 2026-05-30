/**
 * Context-aware ranker.
 *
 * Takes the candidate actions, scores them under ICE / RICE / WSJF /
 * Eisenhower, and produces a composite ranking weighted by:
 *   - owner sentiment (negative sentiment -> tilt toward people-first)
 *   - owner style preference (bias-to-action -> tilt toward ease)
 *
 * All functions are pure. Inputs are read-only.
 *
 * @module features/central-command/md/nba/context-aware-ranker
 */

import { classifyEisenhower } from "./eisenhower";
import { round, scoreIce } from "./ice-scorer";
import { scoreRice } from "./rice-scorer";
import { scoreWsjf } from "./wsjf-scorer";
import type { ActionCandidate, BusinessSnapshot, RankedAction } from "./types";

interface WeightProfile {
  readonly ice: number;
  readonly rice: number;
  readonly wsjf: number;
  readonly urgency: number;
}

const BASE_WEIGHTS: WeightProfile = Object.freeze({
  ice: 0.35,
  rice: 0.25,
  wsjf: 0.25,
  urgency: 0.15,
});

/**
 * Score every candidate and return them ranked by composite score.
 * Higher composite score is better. Stable order: by composite desc,
 * then by templateId asc for determinism.
 */
export function rankCandidates(
  candidates: readonly ActionCandidate[],
  snapshot: BusinessSnapshot,
): readonly RankedAction[] {
  const weights = deriveWeights(snapshot);
  const ranked = candidates.map((c) => toRankedAction(c, weights));
  return Object.freeze(
    [...ranked].sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      return a.templateId.localeCompare(b.templateId);
    }),
  );
}

function toRankedAction(
  candidate: ActionCandidate,
  weights: WeightProfile,
): RankedAction {
  const ice = scoreIce(candidate);
  const rice = scoreRice(candidate);
  const wsjf = scoreWsjf(candidate);
  const eisenhower = classifyEisenhower(candidate);

  // Normalize each score to a 0..1 band so the composite is comparable.
  const iceNorm = ice.ice / 100;
  const riceNorm = clampZeroOne(rice.rice / 500);
  const wsjfNorm = clampZeroOne(wsjf.wsjf / 30);
  const urgencyNorm = eisenhower.urgencyScore / 10;

  const compositeScore = round(
    weights.ice * iceNorm +
      weights.rice * riceNorm +
      weights.wsjf * wsjfNorm +
      weights.urgency * urgencyNorm,
    4,
  );

  return Object.freeze({
    templateId: candidate.template.id,
    title: candidate.template.title,
    description: candidate.template.description,
    domain: candidate.template.domain,
    ice,
    rice,
    wsjf,
    eisenhower,
    compositeScore,
    subjectRef: candidate.subjectRef,
    rationale: candidate.reason,
  });
}

function deriveWeights(snapshot: BusinessSnapshot): WeightProfile {
  const style = snapshot.ownerStyle;
  const sentiment = snapshot.ownerSentiment?.score ?? 0;

  // Default copy
  let ice = BASE_WEIGHTS.ice;
  let rice = BASE_WEIGHTS.rice;
  let wsjf = BASE_WEIGHTS.wsjf;
  let urgency = BASE_WEIGHTS.urgency;

  if (style) {
    if (style.preferredMode === "bias-to-action") {
      ice += style.easeBias * 0.1;
      wsjf += 0.05;
    } else if (style.preferredMode === "deliberate") {
      rice += 0.1;
      wsjf -= 0.05;
    } else if (style.preferredMode === "data-driven") {
      rice += 0.1;
    } else if (style.preferredMode === "people-first") {
      urgency += 0.05;
    }
    ice += style.impactBias * 0.05;
  }

  // Negative sentiment -> push urgency up so wins land fast.
  if (sentiment < 0) {
    urgency += Math.min(0.1, Math.abs(sentiment) * 0.1);
  }

  const total = ice + rice + wsjf + urgency;
  return Object.freeze({
    ice: ice / total,
    rice: rice / total,
    wsjf: wsjf / total,
    urgency: urgency / total,
  });
}

function clampZeroOne(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** De-duplicate rankings by (templateId + subjectRef) keeping the best score. */
export function dedupeRankings(
  ranked: readonly RankedAction[],
): readonly RankedAction[] {
  const map = new Map<string, RankedAction>();
  for (const r of ranked) {
    const key = `${r.templateId}::${r.subjectRef ?? ""}`;
    const existing = map.get(key);
    if (!existing || existing.compositeScore < r.compositeScore) {
      map.set(key, r);
    }
  }
  return Object.freeze(
    [...map.values()].sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      return a.templateId.localeCompare(b.templateId);
    }),
  );
}
