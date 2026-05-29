/**
 * Mr. Mwikila autonomous-MD framework — shared types.
 *
 * The kernel slice that lets Mr. Mwikila act on the owner's behalf
 * under owner-defined delegation tiers. See
 * `Docs/RESEARCH/AUTONOMOUS_MD_SOTA.md` for the SOTA references and
 * the design rationale (Anthropic Computer Use, OpenAI Operator,
 * Devin 1-5 autonomy scale, Manus, Cursor + Oasis).
 *
 *   T0  inform-only        owner does the action
 *   T1  propose             owner one-tap approves
 *   T2  act-with-reversal   reversible within reversal_window_hours
 *   T3  irrevocable          rare; owner explicitly elevated
 *
 * No I/O in this module. Pure types + helper functions.
 */

/**
 * Twelve delegation categories — must mirror the SQL CHECK in
 * migrations 0128 + 0129.
 */
export const DELEGATION_CATEGORIES = [
  'shifts',
  'payroll-prep',
  'royalty-filing',
  'license-renewal-reminders',
  'contract-followups',
  'worker-hires',
  'worker-discipline',
  'capex',
  'inventory-orders',
  'compliance-filings',
  'marketplace-bids',
  'marketplace-counters',
] as const;

export type DelegationCategory = (typeof DELEGATION_CATEGORIES)[number];

export const DELEGATION_TIERS = ['T0', 'T1', 'T2', 'T3'] as const;

export type DelegationTier = (typeof DELEGATION_TIERS)[number];

export const ACTION_STATUSES = [
  'proposed',
  'owner_approved',
  'owner_denied',
  'executed',
  'reversed',
  'committed',
  'blocked_by_inviolable',
  'expired',
] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * Per-category default tier. Conservative — the inboxed handler always
 * picks the SAFER of (owner-set tier, category default). The owner
 * explicitly raises the tier if they want more autonomy.
 */
export const CATEGORY_DEFAULT_TIER: Readonly<
  Record<DelegationCategory, DelegationTier>
> = Object.freeze({
  shifts: 'T2',
  'payroll-prep': 'T1',
  'royalty-filing': 'T1',
  'license-renewal-reminders': 'T2',
  'contract-followups': 'T1',
  'worker-hires': 'T0',
  'worker-discipline': 'T0',
  capex: 'T0',
  'inventory-orders': 'T2',
  'compliance-filings': 'T1',
  'marketplace-bids': 'T1',
  'marketplace-counters': 'T2',
});

/**
 * Default reversal window per category (hours). Used when the owner
 * has not overridden via `owner_delegation_prefs.reversal_window_hours`.
 *
 * - 4h for marketplace counters because counterparties may rely on the price.
 * - 24h for the rest (shifts, inventory, license reminders).
 */
export const CATEGORY_DEFAULT_REVERSAL_HOURS: Readonly<
  Record<DelegationCategory, number>
> = Object.freeze({
  shifts: 24,
  'payroll-prep': 24,
  'royalty-filing': 24,
  'license-renewal-reminders': 24,
  'contract-followups': 24,
  'worker-hires': 24,
  'worker-discipline': 24,
  capex: 24,
  'inventory-orders': 24,
  'compliance-filings': 24,
  'marketplace-bids': 24,
  'marketplace-counters': 4,
});

/**
 * Owner-set delegation preference (one row in `owner_delegation_prefs`).
 * Domain types — handler reads / writes via the recorder service.
 */
export interface DelegationPref {
  readonly tenantId: string;
  readonly category: DelegationCategory;
  readonly tier: DelegationTier;
  readonly reversalWindowHours: number | null;
  readonly envelopeThresholdTzs: number | null;
  readonly setByUserId: string | null;
  readonly setAt: string;
  readonly notes: string | null;
}

/**
 * Resolved (effective) delegation for a category. Either an owner-set
 * row or the safe default. The handler always reads through `resolve`
 * — never from the raw table — so the safest of (owner, default) wins.
 */
export interface ResolvedDelegation {
  readonly category: DelegationCategory;
  readonly tier: DelegationTier;
  readonly reversalWindowHours: number;
  readonly envelopeThresholdTzs: number | null;
  readonly source: 'owner' | 'default';
}

/**
 * Tier-rank helper — higher number = more autonomy.
 * T0 = 0, T1 = 1, T2 = 2, T3 = 3.
 */
export function tierRank(tier: DelegationTier): 0 | 1 | 2 | 3 {
  switch (tier) {
    case 'T0':
      return 0;
    case 'T1':
      return 1;
    case 'T2':
      return 2;
    case 'T3':
      return 3;
  }
}

/**
 * Compose the effective tier of (owner-set, category default). When
 * the owner has no preference for the category, the default wins.
 */
export function effectiveTier(
  ownerTier: DelegationTier | null,
  category: DelegationCategory,
): DelegationTier {
  if (ownerTier === null) return CATEGORY_DEFAULT_TIER[category];
  return ownerTier;
}

/**
 * Resolved-delegation factory. Pass the per-tenant row from the DB
 * (or null when no override) and the category.
 */
export function resolveDelegation(
  pref: DelegationPref | null,
  category: DelegationCategory,
): ResolvedDelegation {
  if (pref === null || pref.category !== category) {
    return Object.freeze({
      category,
      tier: CATEGORY_DEFAULT_TIER[category],
      reversalWindowHours: CATEGORY_DEFAULT_REVERSAL_HOURS[category],
      envelopeThresholdTzs: null,
      source: 'default',
    });
  }
  const tier = effectiveTier(pref.tier, category);
  const reversalWindowHours =
    pref.reversalWindowHours ?? CATEGORY_DEFAULT_REVERSAL_HOURS[category];
  return Object.freeze({
    category,
    tier,
    reversalWindowHours,
    envelopeThresholdTzs: pref.envelopeThresholdTzs,
    source: 'owner',
  });
}

/**
 * Is the resolved tier permissive enough for Mwikila to execute
 * without waiting for owner approval? True for T2 and T3.
 */
export function tierAllowsImmediateExecution(tier: DelegationTier): boolean {
  return tier === 'T2' || tier === 'T3';
}

/**
 * Is the resolved tier reversible by the owner? True only for T2.
 */
export function tierAllowsReversal(tier: DelegationTier): boolean {
  return tier === 'T2';
}
