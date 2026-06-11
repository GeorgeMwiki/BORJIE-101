/**
 * `@borjie/llm-budget-governor` — 5-hour rolling-session window (BSCHEMA-3).
 *
 * The PRIMARY limit in the Claude-Code model is a 5-hour rolling-session
 * window that STARTS on the first message of a session and RESETS 5 hours
 * later (billing-claude-code-model.md §1.2). Each tier gets a per-window
 * cost-weighted token budget (see ./tiers.ts).
 *
 * COMPUTED, NOT MIGRATED. The task prefers computation over schema change.
 * The existing `tenant_llm_budgets` substrate keys spend by daily/monthly
 * period only — there is no `session_started_at` column. Rather than add a
 * migration, this module computes the active session window purely from
 * the spend timestamps the caller already has (each spend record carries a
 * timestamp) OR from an explicit session-anchor the caller threads through.
 * No DB write, no new column, no live money.
 *
 * Anchor semantics (mirrors Claude's "starts on your first message"):
 *   - The session anchor is the timestamp of the FIRST spend whose time is
 *     within 5h of `now`. Walking the (ascending) spend records, the anchor
 *     is the earliest record that is NOT already older than 5h relative to
 *     the running window — i.e. the first record of the current unbroken
 *     5h session chain that still covers `now`.
 *   - The window is [anchor, anchor + 5h); `resetAt` = anchor + 5h.
 *   - Spend inside [anchor, anchor+5h) counts against the session budget.
 *   - If there is no spend within the last 5h, the next call will OPEN a
 *     fresh window anchored at `now` (consumed = 0, resetAt = now + 5h).
 *
 * Pure functions over plain records — no I/O, no global Date (caller passes
 * `now`).
 */

import type { ModelTier } from '../types.js';

/** The fixed rolling-session width (doc §1.2). */
export const SESSION_WINDOW_HOURS = 5 as const;
export const SESSION_WINDOW_MS = SESSION_WINDOW_HOURS * 60 * 60 * 1000;

/**
 * One unit of metered spend with the timestamp it occurred at. This is the
 * minimum the session computation needs; callers project their richer
 * spend rows down to this shape.
 */
export interface SessionSpendRecord {
  /** When the spend occurred (UTC instant). */
  readonly at: Date;
  /** Cost-weighted token units consumed (see ./metering.ts). */
  readonly weightedTokens: number;
  /** Cents consumed. */
  readonly cents: number;
  /** Model tier that produced the spend (informational). */
  readonly tier: ModelTier;
}

/** The computed state of the active rolling-session window. */
export interface SessionWindow {
  /** Inclusive window start (the session anchor). */
  readonly start: Date;
  /** Exclusive window end == `resetAt`. */
  readonly end: Date;
  /** Instant the window resets (== `end`). Always present (doc §1.4). */
  readonly resetAt: Date;
  /** Cost-weighted token units consumed inside the window. */
  readonly consumedTokens: number;
  /** Cents consumed inside the window. */
  readonly consumedCents: number;
  /** Highest model tier used inside the window (null when empty). */
  readonly highestTierUsed: ModelTier | null;
  /**
   * True when the window opened fresh at `now` because no spend fell inside
   * the last 5h (a brand-new session). consumed* are 0 in this case.
   */
  readonly isFresh: boolean;
}

const TIER_RANK: Record<ModelTier, number> = { haiku: 1, sonnet: 2, opus: 3 };

function higherTier(a: ModelTier | null, b: ModelTier): ModelTier {
  if (a === null) return b;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function addMs(d: Date, ms: number): Date {
  return new Date(d.getTime() + ms);
}

/**
 * Compute the active 5-hour rolling-session window from spend records.
 *
 * @param records Spend records (any order — sorted internally ascending).
 * @param now     The evaluation instant.
 * @param anchorOverride Optional explicit session anchor (e.g. a persisted
 *   `session_started_at`). When supplied AND still within 5h of `now`, it
 *   wins over the inferred anchor — this is the seam a future minimal
 *   migration would plug into without changing the contract.
 * @returns The window [start, start+5h), its consumed budget, and resetAt.
 */
export function computeSessionWindow(
  records: ReadonlyArray<SessionSpendRecord>,
  now: Date,
  anchorOverride?: Date,
): SessionWindow {
  const horizon = addMs(now, -SESSION_WINDOW_MS); // now - 5h (exclusive floor)

  // Records that still fall inside a window covering `now`: at > now-5h and
  // at <= now. (Future-dated records are ignored as clock skew.)
  const live = records
    .filter((r) => r.at.getTime() > horizon.getTime() && r.at.getTime() <= now.getTime())
    .slice()
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Resolve the anchor.
  let anchor: Date | null = null;
  if (
    anchorOverride &&
    anchorOverride.getTime() > horizon.getTime() &&
    anchorOverride.getTime() <= now.getTime()
  ) {
    anchor = anchorOverride;
  } else if (live.length > 0) {
    // The earliest live record opens the session (Claude: "starts on your
    // first message"). All live records are within 5h of now by construction.
    const first = live[0];
    anchor = first ? first.at : null;
  }

  if (anchor === null) {
    // No spend inside the last 5h → a fresh window opens at `now`.
    return {
      start: now,
      end: addMs(now, SESSION_WINDOW_MS),
      resetAt: addMs(now, SESSION_WINDOW_MS),
      consumedTokens: 0,
      consumedCents: 0,
      highestTierUsed: null,
      isFresh: true,
    };
  }

  const end = addMs(anchor, SESSION_WINDOW_MS);

  // Sum spend inside [anchor, anchor+5h). Records beyond `end` belong to a
  // later session and are excluded.
  let consumedTokens = 0;
  let consumedCents = 0;
  let highest: ModelTier | null = null;
  for (const r of live) {
    if (r.at.getTime() >= anchor.getTime() && r.at.getTime() < end.getTime()) {
      consumedTokens += r.weightedTokens;
      consumedCents += r.cents;
      highest = higherTier(highest, r.tier);
    }
  }

  return {
    start: anchor,
    end,
    resetAt: end,
    consumedTokens,
    consumedCents,
    highestTierUsed: highest,
    isFresh: false,
  };
}

/**
 * Remaining cost-weighted token budget in the current session window for a
 * given per-window budget. Never negative.
 */
export function sessionRemainingTokens(
  window: SessionWindow,
  sessionTokenBudget: number,
): number {
  return Math.max(0, sessionTokenBudget - window.consumedTokens);
}

/**
 * Whether the session window has rolled over relative to a previous
 * window's `resetAt` — true once `now >= previousResetAt`. Pure helper for
 * callers that cached a prior window.
 */
export function hasSessionRolledOver(
  previousResetAt: Date,
  now: Date,
): boolean {
  return now.getTime() >= previousResetAt.getTime();
}
