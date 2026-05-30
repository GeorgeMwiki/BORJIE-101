/**
 * High-impact finder.
 *
 * Selects actions purely by impact (ICE.impact >= 7), ranked by
 * (impact * confidence) — effort intentionally ignored.
 *
 * Pure.
 *
 * @module features/central-command/md/nba/high-impact-finder
 */

import type { RankedAction } from "./types";

const IMPACT_FLOOR = 7;

export function findHighImpact(
  ranked: readonly RankedAction[],
  limit = 5,
): readonly RankedAction[] {
  const filtered = ranked.filter((r) => r.ice.impact >= IMPACT_FLOOR);

  const sorted = [...filtered].sort((a, b) => {
    const scoreA = a.ice.impact * a.ice.confidence;
    const scoreB = b.ice.impact * b.ice.confidence;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.templateId.localeCompare(b.templateId);
  });

  return Object.freeze(sorted.slice(0, Math.max(0, limit)));
}

export const HIGH_IMPACT_THRESHOLD = IMPACT_FLOOR;
