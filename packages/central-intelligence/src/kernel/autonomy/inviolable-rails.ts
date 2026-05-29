/**
 * Mr. Mwikila — inviolable safety rails for autonomous actions.
 *
 * These are hard-coded refusals the kernel issues BEFORE any
 * autonomous handler executes. They override every owner-set
 * delegation tier (even T3) because they enforce CLAUDE.md hard
 * rules + Tanzanian regulatory constraints.
 *
 * The five rails:
 *
 *   1. Family-member discipline / hire / fire — refused regardless of
 *      tier. Owner is the only actor for family-related HR.
 *
 *   2. Monthly money-out cap — every autonomous action that moves
 *      money above the per-tenant envelope (or the platform default,
 *      whichever is smaller) is refused. Owner must approve via the
 *      standard four-eye flow.
 *
 *   3. Non-TZS currency contracts — post-Mar-2026 USD-cliff
 *      remediation. Mr. Mwikila never enters a domestic contract in a
 *      non-TZS currency.
 *
 *   4. Kill-switch — if the platform kill-switch is open, every
 *      autonomous action returns `blocked_by_inviolable` with reason
 *      `kill_switch_open`. Fail-closed per CLAUDE.md.
 *
 *   5. Capex over envelope — same as (2) but specific to capex
 *      categories. The envelope_threshold is the inviolable cap; even
 *      T3 cannot exceed it.
 *
 * Deterministic — no LLM. Pure functions of the action descriptor and
 * the owner config. Tests drive every branch.
 */

import type { DelegationCategory } from './types.js';

/** Platform-wide default envelope cap in TZS (CLAUDE.md). */
export const DEFAULT_MONTHLY_ENVELOPE_TZS = 5_000_000;

export const INVIOLABLE_REASONS = [
  'family_member_target',
  'envelope_exceeded',
  'non_tzs_currency',
  'kill_switch_open',
  'capex_over_envelope',
] as const;

export type InviolableReason = (typeof INVIOLABLE_REASONS)[number];

export interface InviolableVerdictAutonomy {
  readonly status: 'pass' | 'block';
  readonly reason?: InviolableReason;
  readonly humanReadable?: string;
}

/**
 * Descriptor of the autonomous action the handler is about to take.
 * The handler builds this before calling `checkAutonomyInviolable`.
 */
export interface AutonomyActionDescriptor {
  readonly category: DelegationCategory;
  /**
   * Money out (TZS) if any. Zero or negative when no money moves.
   * Capex / payroll / inventory handlers populate this; informational
   * handlers (reminders) leave it at 0.
   */
  readonly amountTzs: number;
  /** ISO-4217 currency code. Must be 'TZS' for autonomous actions. */
  readonly currency: string;
  /**
   * When the action targets people, the role they hold relative to
   * the owner. 'family' triggers the family-member rail.
   */
  readonly targetRelation?: 'family' | 'staff' | 'counterparty' | null;
  /** Resolved per-category envelope (TZS) — owner-set or default. */
  readonly envelopeThresholdTzs: number | null;
  /** True when the platform kill-switch is open. */
  readonly killSwitchOpen: boolean;
}

/**
 * The five inviolable rails. Order matters — kill-switch wins first.
 */
export function checkAutonomyInviolable(
  d: AutonomyActionDescriptor,
): InviolableVerdictAutonomy {
  if (d.killSwitchOpen) {
    return {
      status: 'block',
      reason: 'kill_switch_open',
      humanReadable:
        'Platform kill-switch is open. Mr. Mwikila will not act autonomously.',
    };
  }

  if (d.targetRelation === 'family') {
    return {
      status: 'block',
      reason: 'family_member_target',
      humanReadable:
        'Family-member HR is owner-only. Mr. Mwikila will not act here.',
    };
  }

  if (d.amountTzs > 0 && d.currency !== 'TZS') {
    return {
      status: 'block',
      reason: 'non_tzs_currency',
      humanReadable:
        'Domestic non-TZS currency contracts are refused (USD-cliff remediation).',
    };
  }

  const envelope =
    d.envelopeThresholdTzs ?? DEFAULT_MONTHLY_ENVELOPE_TZS;

  // Capex-specific cap.
  if (d.category === 'capex' && d.amountTzs > envelope) {
    return {
      status: 'block',
      reason: 'capex_over_envelope',
      humanReadable:
        'Capex above the monthly envelope is owner-only — Mr. Mwikila will not act.',
    };
  }

  // Generic money-out cap.
  if (d.amountTzs > envelope) {
    return {
      status: 'block',
      reason: 'envelope_exceeded',
      humanReadable:
        'Action exceeds the monthly money-out envelope — owner approval required.',
    };
  }

  return { status: 'pass' };
}
