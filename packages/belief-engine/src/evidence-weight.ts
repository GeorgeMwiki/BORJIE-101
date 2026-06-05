/**
 * Evidence weighting — PURE functions that score the "new claim" side and
 * the "prior belief" side of a contradiction so the convince-loop can
 * compute a confidence delta.
 *
 * Re-skinned portal authority for Borjie surfaces (owner > admin > manager
 * > worker). Recency decay matches LITFIN: full weight for 90 days, then
 * 0.5%/day to a 0.4 floor.
 */

import { clamp01 } from './belief-store.js';
import type { Belief, ChatPortal, WebSearchResult } from './types.js';

export const PORTAL_AUTHORITY: Record<ChatPortal, number> = {
  owner: 0.9,
  admin: 0.8,
  manager: 0.7,
  worker: 0.5,
};

export interface NewSideArgs {
  readonly portal: ChatPortal;
  readonly claimConfidence: number;
  readonly webResults: ReadonlyArray<WebSearchResult>;
}

/**
 * Weight of the new-claim side. Blend: claim 40%, web 60% — web typically
 * carries a stronger per-item authority signal, but neither dominates.
 */
export function newSideEvidenceWeight(input: NewSideArgs): number {
  const portalAuth = PORTAL_AUTHORITY[input.portal] ?? 0.4;
  const claimWeight = portalAuth * clamp01(input.claimConfidence);
  const webWeight =
    input.webResults.length === 0
      ? 0
      : input.webResults.reduce((acc, r) => acc + clamp01(r.authority), 0) /
        input.webResults.length;
  return clamp01(claimWeight * 0.4 + webWeight * 0.6);
}

/** Weight of the prior belief, decayed by age. */
export function priorSideEvidenceWeight(
  prior: Belief,
  now: number = Date.now(),
): number {
  const base = clamp01(prior.confidence);
  const ageDays = ageInDays(prior.revisedAt, now);
  const decay = Math.max(0.4, 1 - Math.max(0, ageDays - 90) * 0.005);
  return clamp01(base * decay);
}

export function ageInDays(iso: string, now: number = Date.now()): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 0;
  return (now - then) / (1000 * 60 * 60 * 24);
}
