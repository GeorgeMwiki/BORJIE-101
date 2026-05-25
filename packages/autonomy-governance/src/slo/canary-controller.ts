/**
 * Canary traffic-split controller.
 *
 * Stage ladder (low → high traffic):
 *   shadow → canary-1pct → canary-5pct → canary-25pct → live
 *
 * Promotion is manual (operator-driven; out of scope for substrate).
 * Demotion is automatic: any SLO breach with action `reduce-traffic` drops
 * the sub-MD down one rung. Demotion below `shadow` is a no-op — the
 * sub-MD is in shadow only; nothing to demote to. Use `handoff` /
 * `kill-and-rollback` for terminal actions.
 */

import type { CanaryStage } from '../types.js';

const STAGE_ORDER = [
  'shadow',
  'canary-1pct',
  'canary-5pct',
  'canary-25pct',
  'live',
] as const satisfies readonly CanaryStage[];

/**
 * Numeric traffic share for each stage. Used by the dispatcher to decide
 * whether an incoming request is routed to the canary version.
 */
export const STAGE_TRAFFIC_SHARE: Readonly<Record<CanaryStage, number>> = Object.freeze({
  shadow: 0,
  'canary-1pct': 0.01,
  'canary-5pct': 0.05,
  'canary-25pct': 0.25,
  live: 1.0,
});

export function stageIndex(stage: CanaryStage): number {
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0) throw new Error(`unknown canary stage: ${stage}`);
  return i;
}

/**
 * Return the next-lower stage, or `null` if already at `shadow`.
 */
export function demoteStage(stage: CanaryStage): CanaryStage | null {
  const i = stageIndex(stage);
  if (i === 0) return null;
  const next = STAGE_ORDER[i - 1];
  // Index is bounds-checked above; assert non-undefined for noUncheckedIndexedAccess.
  if (!next) return null;
  return next;
}

/**
 * Return the next-higher stage, or `null` if already at `live`.
 */
export function promoteStage(stage: CanaryStage): CanaryStage | null {
  const i = stageIndex(stage);
  if (i === STAGE_ORDER.length - 1) return null;
  const next = STAGE_ORDER[i + 1];
  if (!next) return null;
  return next;
}

/**
 * Deterministic routing decision: should this request be routed to the
 * canary version? Uses a 32-bit FNV-1a hash of the requestId mod 10_000
 * so the same request always lands on the same side (sticky routing —
 * critical for SLO attribution).
 */
export function shouldRouteToCanary(
  stage: CanaryStage,
  requestId: string,
): boolean {
  if (stage === 'shadow') return false;
  if (stage === 'live') return true;
  const share = STAGE_TRAFFIC_SHARE[stage];
  return hash01(requestId) < share;
}

function hash01(input: string): number {
  // FNV-1a 32-bit, normalised to [0, 1).
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash / 0x1_0000_0000;
}
