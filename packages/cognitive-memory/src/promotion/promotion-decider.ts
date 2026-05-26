/**
 * Promotion decider (Wave 18AA).
 *
 * Pure functions that decide whether a cell should transition between
 * lifecycle states. The four-state promotion lifecycle is documented
 * in §4 of UNIFIED_COGNITIVE_MEMORY_SPEC.md:
 *
 *   observed ──reinforce by ≥2 OTHER specialisations──→ reinforced
 *   reinforced ──≥10 recalls over ≥14 days, no contradictions──→ consolidated
 *   consolidated ──180 days idle──→ decayed
 *   * ──memory.contradict() with confidence ≥0.7──→ contradicted
 *
 * The functions here are PURE — they take a cell + clock/context
 * inputs and return a decision. The actual state transition is
 * applied by the operations module (which also writes the audit row).
 */

import {
  CONSOLIDATE_ELAPSED_DAYS,
  CONSOLIDATE_RECALL_THRESHOLD,
  CONTRADICT_EVIDENCE_THRESHOLD,
  DECAY_IDLE_DAYS,
  REINFORCE_PROMOTION_THRESHOLD,
  type CognitiveMemoryCell,
  type MemoryStatus,
} from '../types.js';

export type PromotionDecision =
  | { readonly action: 'none' }
  | { readonly action: 'promote'; readonly to: MemoryStatus; readonly reason: string };

/** Distinct other specialisations that have reinforced this cell. */
function distinctOtherReinforcers(cell: CognitiveMemoryCell): number {
  const others = new Set(
    cell.reinforced_by_specialisations.filter(
      (s) => s !== cell.contributed_by_specialisation,
    ),
  );
  return others.size;
}

function daysBetween(a_iso: string, b_iso: string): number {
  const ms = Date.parse(b_iso) - Date.parse(a_iso);
  if (Number.isNaN(ms)) {
    return 0;
  }
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Should `observed → reinforced` fire? Requires reinforcement from
 * ≥2 different specialisations (the contributor doesn't count). Spec §4.
 */
export function shouldPromoteToReinforced(cell: CognitiveMemoryCell): PromotionDecision {
  if (cell.promotion_status !== 'observed') {
    return { action: 'none' };
  }
  const others = distinctOtherReinforcers(cell);
  if (others < REINFORCE_PROMOTION_THRESHOLD) {
    return { action: 'none' };
  }
  return {
    action: 'promote',
    to: 'reinforced',
    reason: `reinforced by ${others.toString()} distinct other specialisations`,
  };
}

/**
 * Should `reinforced → consolidated` fire? Requires ≥10 recalls AND
 * ≥14 elapsed days AND zero contradictions in that window. Spec §4.
 */
export function shouldPromoteToConsolidated(
  cell: CognitiveMemoryCell,
  now_iso: string,
): PromotionDecision {
  if (cell.promotion_status !== 'reinforced') {
    return { action: 'none' };
  }
  if (cell.contradicting_cell_id !== null) {
    return { action: 'none' };
  }
  if (cell.access_count < CONSOLIDATE_RECALL_THRESHOLD) {
    return { action: 'none' };
  }
  const elapsed = daysBetween(cell.created_at, now_iso);
  if (elapsed < CONSOLIDATE_ELAPSED_DAYS) {
    return { action: 'none' };
  }
  return {
    action: 'promote',
    to: 'consolidated',
    reason: `accessed ${cell.access_count.toString()}× over ${elapsed.toFixed(1)} days, no contradictions`,
  };
}

/**
 * Should `consolidated → decayed` fire? After 180 days idle (no
 * recalls). Spec §4.
 */
export function shouldDecay(
  cell: CognitiveMemoryCell,
  now_iso: string,
): PromotionDecision {
  if (cell.promotion_status !== 'consolidated') {
    return { action: 'none' };
  }
  const reference_iso = cell.last_accessed_at ?? cell.created_at;
  const idle_days = daysBetween(reference_iso, now_iso);
  if (idle_days < DECAY_IDLE_DAYS) {
    return { action: 'none' };
  }
  return {
    action: 'promote',
    to: 'decayed',
    reason: `idle for ${idle_days.toFixed(1)} days`,
  };
}

/**
 * Gate the contradict operation by evidence confidence. Spec §4.
 * Returns true when the call should be accepted.
 */
export function isContradictionPlausible(new_evidence_confidence: number): boolean {
  return new_evidence_confidence >= CONTRADICT_EVIDENCE_THRESHOLD;
}

/**
 * Decide what (if any) promotion should fire next for this cell.
 * Used by the consolidation worker when scanning candidates nightly.
 */
export function nextPromotion(
  cell: CognitiveMemoryCell,
  now_iso: string,
): PromotionDecision {
  if (cell.promotion_status === 'observed') {
    return shouldPromoteToReinforced(cell);
  }
  if (cell.promotion_status === 'reinforced') {
    return shouldPromoteToConsolidated(cell, now_iso);
  }
  if (cell.promotion_status === 'consolidated') {
    return shouldDecay(cell, now_iso);
  }
  return { action: 'none' };
}
