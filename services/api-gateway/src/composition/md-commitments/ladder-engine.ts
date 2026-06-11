/**
 * LadderEngine — the graduated reminder ladder + escalation for the MD
 * DEFERRAL / FOLLOW-THROUGH organ.
 *
 * A deferred item that fires ONCE and is ignored is still a dropped thread. The
 * closed loop adds a graduated reminder ladder (escalating reach, gated on
 * acknowledgement) with a defined safe-halt fallback that NEVER silently
 * auto-proceeds on a sovereign/money action.
 *
 *   rung 0  in-app    → cockpit event (the proactive tray)
 *   rung 1  email     → user-followup email dispatcher (quiet-hours-respecting)
 *   rung 2  SMS       → reminders SMS path (quiet-hours-deferred)
 *   rung 3  owner-    → user-followup owner-direct + mwikila_actions_inbox row
 *           direct      with a proposal_ttl — and for SOVEREIGN commitments this
 *                       rung is a SAFE-HALT: surface + wait, NEVER auto-file.
 *   rung 4  escalate  → mining_escalations row (owner severity) if rung 3's SLA
 *                       is missed.
 *
 * This module is a PURE COMPOSITION of EXISTING dispatchers — no new channel
 * code. The dispatchers are injected as ports so the engine stays unit-testable
 * and the composition root binds the live ones (publishCockpitEvent /
 * user-followup / reminders SMS / mwikila_actions_inbox insert /
 * mining_escalations insert).
 *
 * GOVERNANCE: advancing a rung is the ONLY effect — it surfaces louder, it
 * never actuates. A sovereign commitment's top rung is fail-CLOSED: the safe-
 * halt raises the alarm and parks the action for HITL; it never flips to
 * auto-execute on any timer. No `console.*` (the injected logger only).
 */

import type { MdCommitment } from '@borjie/database/repositories';

export const MAX_LADDER_RUNG = 4;

/** A single rung's reach. Higher = louder / more intrusive. */
export type LadderRung = 0 | 1 | 2 | 3 | 4;

/** What the engine decided to do for one commitment this sweep. */
export interface LadderDecision {
  readonly rung: LadderRung;
  /** True when this rung is a sovereign SAFE-HALT (surface + wait, no actuate). */
  readonly safeHalt: boolean;
  /** True when a dispatcher was invoked (a rung actually fired this sweep). */
  readonly dispatched: boolean;
  /** Human-readable reason (audit + observability). */
  readonly reason: string;
}

/**
 * The dispatcher ports the ladder composes. Each is the EXISTING live channel,
 * adapted to a tiny call surface. All are async + best-effort: a dispatcher
 * fault is swallowed by the engine (a channel outage never breaks the sweep).
 */
export interface LadderDispatchers {
  /** rung 0 — in-app proactive tray (publishCockpitEvent-backed). */
  inApp(c: MdCommitment): Promise<void>;
  /** rung 1 — email (user-followup, quiet-hours-respecting). */
  email(c: MdCommitment): Promise<void>;
  /** rung 2 — SMS (reminders SMS path, quiet-hours-deferred). */
  sms(c: MdCommitment): Promise<void>;
  /**
   * rung 3 — owner-direct + the mwikila_actions_inbox SAFE-HALT row. For a
   * sovereign commitment this is surface-and-wait: the inbox row is `proposed`
   * with a proposal_ttl; it is NEVER auto-executed. Returns nothing — the owner
   * acts out of band.
   */
  ownerDirectSafeHalt(c: MdCommitment): Promise<void>;
  /** rung 4 — mining_escalations row (owner severity). */
  escalate(c: MdCommitment): Promise<void>;
}

/** Per-tenant ladder cadence (risk-tiered SLAs). Tenant-tunable, never hard-coded. */
export interface LadderPrefs {
  /** Routine cadence between rungs (ms) when NOT sovereign + low urgency. */
  readonly routineRungIntervalMs?: number;
  /** Tight cadence between rungs (ms) for sovereign / high-urgency items. */
  readonly tightRungIntervalMs?: number;
}

const DEFAULT_ROUTINE_RUNG_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_TIGHT_RUNG_MS = 4 * 60 * 60 * 1000; // 4h

/**
 * Decide which rung a due/overdue commitment should be on THIS sweep, and fire
 * the matching dispatcher — but only advance a rung when the prior rung
 * produced NO acknowledgement within its risk-tiered SLA (gated on ack).
 *
 * Pure decision + a single dispatch side-effect (swallowed on fault). Returns
 * the decision so the caller can persist the new rung + last_nudged_at and
 * write the audit row.
 */
export async function runLadder(
  commitment: MdCommitment,
  dispatchers: LadderDispatchers,
  prefs: LadderPrefs,
  nowMs: number,
  logger: { warn(meta: Record<string, unknown>, msg?: string): void },
): Promise<LadderDecision> {
  const rungIntervalMs =
    commitment.sovereign
      ? prefs.tightRungIntervalMs ?? DEFAULT_TIGHT_RUNG_MS
      : prefs.routineRungIntervalMs ?? DEFAULT_ROUTINE_RUNG_MS;

  // Acknowledgement gate: if the owner acked the last surface, the loop pauses
  // climbing (the ack will be cleared when the item re-surfaces unconfirmed).
  const ackedAfterLastNudge =
    commitment.ackedAtMs !== null &&
    (commitment.lastNudgedAtMs === null ||
      commitment.ackedAtMs >= commitment.lastNudgedAtMs);

  // Has the SLA since the last nudge elapsed? (No prior nudge → fire rung 0 now.)
  const slaElapsed =
    commitment.lastNudgedAtMs === null ||
    nowMs - commitment.lastNudgedAtMs >= rungIntervalMs;

  if (ackedAfterLastNudge) {
    // Owner acknowledged — hold the ladder; the confirm step decides closure.
    return Object.freeze({
      rung: clampRung(commitment.rungLevel),
      safeHalt: false,
      dispatched: false,
      reason: 'acknowledged — ladder held pending confirmation',
    });
  }

  if (!slaElapsed) {
    return Object.freeze({
      rung: clampRung(commitment.rungLevel),
      safeHalt: false,
      dispatched: false,
      reason: 'within SLA of the last surface — no new rung',
    });
  }

  // SLA elapsed, no ack → advance one rung (capped) and fire it.
  const nextRung = clampRung(
    commitment.lastNudgedAtMs === null
      ? commitment.rungLevel // first surface fires the CURRENT rung
      : commitment.rungLevel + 1,
  );

  const safeHalt = commitment.sovereign && nextRung >= 3;
  let dispatched = false;
  try {
    await dispatchRung(nextRung, commitment, dispatchers);
    dispatched = true;
  } catch (err) {
    // A channel outage never breaks the sweep — surface louder next tick.
    logger.warn(
      {
        commitmentId: commitment.id,
        rung: nextRung,
        err: err instanceof Error ? err.message : String(err),
      },
      'md-commitments: ladder dispatch failed (swallowed)',
    );
  }

  return Object.freeze({
    rung: nextRung,
    safeHalt,
    dispatched,
    reason: safeHalt
      ? 'sovereign safe-halt — surfaced + waiting for HITL (never auto-actuated)'
      : `ladder rung ${nextRung} fired`,
  });
}

function clampRung(n: number): LadderRung {
  const v = Math.min(MAX_LADDER_RUNG, Math.max(0, Math.floor(n)));
  return v as LadderRung;
}

async function dispatchRung(
  rung: LadderRung,
  c: MdCommitment,
  d: LadderDispatchers,
): Promise<void> {
  switch (rung) {
    case 0:
      await d.inApp(c);
      return;
    case 1:
      await d.email(c);
      return;
    case 2:
      await d.sms(c);
      return;
    case 3:
      // Owner-direct + the SAFE-HALT inbox row. For a sovereign commitment this
      // is surface-and-wait — the inbox row is proposed, never auto-executed.
      await d.ownerDirectSafeHalt(c);
      return;
    case 4:
      await d.escalate(c);
      return;
  }
}
