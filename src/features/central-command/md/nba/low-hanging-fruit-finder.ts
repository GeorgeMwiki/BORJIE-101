/**
 * Low-hanging-fruit finder.
 *
 * Selects actions that combine high ease with at least moderate impact.
 * Ranking strategy:
 *   - ease >= 7
 *   - impact >= 4
 *   - sort by (ease * impact * confidence) desc
 *
 * Pure helpers over a pre-ranked list.
 *
 * @module features/central-command/md/nba/low-hanging-fruit-finder
 */

import type { RankedAction } from "./types";

const EASE_FLOOR = 7;
const IMPACT_FLOOR = 4;

export function findLowHangingFruit(
  ranked: readonly RankedAction[],
  limit = 5,
): readonly RankedAction[] {
  const filtered = ranked.filter(
    (r) => r.ice.ease >= EASE_FLOOR && r.ice.impact >= IMPACT_FLOOR,
  );

  const sorted = [...filtered].sort((a, b) => {
    const scoreA = a.ice.ease * a.ice.impact * a.ice.confidence;
    const scoreB = b.ice.ease * b.ice.impact * b.ice.confidence;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.templateId.localeCompare(b.templateId);
  });

  return Object.freeze(sorted.slice(0, Math.max(0, limit)));
}

export const LOW_HANGING_FRUIT_THRESHOLDS = Object.freeze({
  ease: EASE_FLOOR,
  impact: IMPACT_FLOOR,
});
