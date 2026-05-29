/**
 * Tab-suggester runner (CT-6).
 *
 * Orchestrates the three pattern detectors against the live
 * observation streams (LMBM-style activity feeds) and inserts the
 * surviving proposals into `tab_proposals_inbox` for the chat surface
 * to pick up on the owner's next turn.
 *
 * The runner is pluggable: the `observations` accessor is injected so
 * we can swap a Drizzle-backed live feed for an in-memory test stub
 * without touching the detection logic. Same for `insertProposal` and
 * `findActiveProposal` (dedup).
 *
 * Dedup policy:
 *   - SKIP if an OPEN proposal exists for (user, tabType, detector).
 *   - SKIP if a DISMISSED proposal for the same key exists with
 *     `dismissed_at >= now - 7 days` (re-propose cooldown).
 *
 * Cron cadence:
 *   - Once per hour per tenant (the gateway scheduler wires this).
 *   - Owner-level runs are sub-second; the cron is the only batch loop.
 */

import {
  detectDrillDownRepeat,
  detectMwikilaEscalation,
  detectNavigationLoop,
  type DetectorResult,
  type DrillDownObservation,
  type MwikilaObservation,
  type NavigationObservation,
} from './detectors.js';

/** Pluggable observation accessor — production wires this to Drizzle. */
export interface SuggesterObservations {
  drillDowns(input: { tenantId: string; userId: string; sinceMs: number }):
    Promise<ReadonlyArray<DrillDownObservation>>;
  navigations(input: { tenantId: string; userId: string; sinceMs: number }):
    Promise<ReadonlyArray<NavigationObservation>>;
  mwikilaActions(input: { tenantId: string; userId: string; sinceMs: number }):
    Promise<ReadonlyArray<MwikilaObservation>>;
}

/** Pluggable persistence — production wires this to `tab_proposals_inbox`. */
export interface SuggesterPersistence {
  /** Returns true if a proposal for this key exists OR was dismissed <7d ago. */
  hasActiveOrCooldown(input: {
    tenantId: string;
    userId: string;
    tabType: string;
    detector: DetectorResult['detector'];
    cooldownMs: number;
  }): Promise<boolean>;
  /** Insert a fresh row + return its id. */
  insertProposal(input: {
    tenantId: string;
    userId: string;
    result: DetectorResult;
  }): Promise<string>;
}

export interface SuggesterTickInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly now: Date;
  readonly observations: SuggesterObservations;
  readonly persistence: SuggesterPersistence;
}

export interface SuggesterTickResult {
  readonly created: ReadonlyArray<{
    readonly proposalId: string;
    readonly detector: DetectorResult['detector'];
    readonly tabType: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly detector: DetectorResult['detector'];
    readonly reason: 'dedup' | 'no-pattern';
  }>;
}

const DEDUP_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const NAV_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function runTabSuggesterTick(
  input: SuggesterTickInput,
): Promise<SuggesterTickResult> {
  const created: SuggesterTickResult['created'][number][] = [];
  const skipped: SuggesterTickResult['skipped'][number][] = [];

  const nowMs = input.now.getTime();
  const since = nowMs - LOOKBACK_MS;
  const navSince = nowMs - NAV_LOOKBACK_MS;

  // Pull all three observation windows in parallel.
  const [drillObs, navObs, mwObs] = await Promise.all([
    input.observations.drillDowns({
      tenantId: input.tenantId,
      userId: input.userId,
      sinceMs: since,
    }),
    input.observations.navigations({
      tenantId: input.tenantId,
      userId: input.userId,
      sinceMs: navSince,
    }),
    input.observations.mwikilaActions({
      tenantId: input.tenantId,
      userId: input.userId,
      sinceMs: since,
    }),
  ]);

  const candidates: DetectorResult[] = [];
  const detectorInput = {
    tenantId: input.tenantId,
    userId: input.userId,
    now: input.now,
  };

  const c1 = detectDrillDownRepeat(detectorInput, drillObs);
  if (c1) candidates.push(c1);
  else skipped.push({ detector: 'drill_down_repeat', reason: 'no-pattern' });

  const c2 = detectNavigationLoop(detectorInput, navObs);
  if (c2) candidates.push(c2);
  else skipped.push({ detector: 'navigation_loop', reason: 'no-pattern' });

  const c3 = detectMwikilaEscalation(detectorInput, mwObs);
  if (c3) candidates.push(c3);
  else skipped.push({ detector: 'mwikila_escalation', reason: 'no-pattern' });

  for (const candidate of candidates) {
    const dup = await input.persistence.hasActiveOrCooldown({
      tenantId: input.tenantId,
      userId: input.userId,
      tabType: candidate.tabType,
      detector: candidate.detector,
      cooldownMs: DEDUP_COOLDOWN_MS,
    });
    if (dup) {
      skipped.push({ detector: candidate.detector, reason: 'dedup' });
      continue;
    }
    const proposalId = await input.persistence.insertProposal({
      tenantId: input.tenantId,
      userId: input.userId,
      result: candidate,
    });
    created.push({
      proposalId,
      detector: candidate.detector,
      tabType: candidate.tabType,
    });
  }

  return { created, skipped };
}
