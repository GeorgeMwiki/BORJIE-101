/**
 * Scale-aware default tab sets — SC-2 of wave SCALE-AWARE.
 *
 * Borjie supports ANY mining scale: a single-pit artisanal miner sees a
 * 4-tab cockpit; a multi-country industrial group sees up to 20 tabs.
 * The tier is a single column on `tenants` (see migration 0145) and is
 * read on the very first cockpit render — never re-fetched per tab.
 *
 * Tier ladder (additive — every higher tier inherits everything below):
 *
 *   T1 artisanal     today's task · last sale · cash position · chat   (4)
 *   T2 cooperative   + workforce · coop settlement · weekly KPI         (7)
 *   T3 midtier       + dispatch · compliance · sites map · payroll      (11)
 *   T4 industrial    + finance · HR pipeline · regulator · safety       (16)
 *                    · forecast
 *   T5 multi_country + group KPI · FX consolidation · cross-border      (20)
 *                    · multi-regulator
 *
 * Tab ids reference `OwnerOSTabType`, the union the registry already
 * validates. New tabs MUST be added to that union first.
 *
 * The defaulter is PURE — it never reads the registry. It returns the
 * ordered id list; the shell hydrates against the registry to render
 * labels / icons. This keeps the package zero-DI.
 *
 * Companion files:
 *   - packages/database/src/migrations/0145_tenants_scale_tier.sql
 *   - services/api-gateway/src/services/orchestration/scale-flows.ts
 *   - apps/owner-web/src/components/owner-os/OwnerOSShell.tsx (consumer)
 *   - Docs/OPS/SCALE_TIERS.md
 */

import type { OwnerOSTabType } from './types.js';

// ─── Tier union ─────────────────────────────────────────────────────

export const SCALE_TIERS = [
  't1_artisanal',
  't2_cooperative',
  't3_midtier',
  't4_industrial',
  't5_multi_country',
] as const;

export type ScaleTier = (typeof SCALE_TIERS)[number];

/**
 * Type-guard — narrows an arbitrary string to ScaleTier or returns the
 * safest fallback (t1_artisanal). Used at the brain / signup boundary
 * where we read free-form text out of `tenants.scale_tier`.
 */
export function coerceScaleTier(raw: string | null | undefined): ScaleTier {
  if (raw && (SCALE_TIERS as readonly string[]).includes(raw)) {
    return raw as ScaleTier;
  }
  return 't1_artisanal';
}

// ─── Tier-additive layers ───────────────────────────────────────────
//
// We list each tier as the DELTA above the previous one. The exported
// `defaultTabsFor(tier)` flattens the chain so callers never know about
// the layered shape.
//
// IMPORTANT: every id MUST exist in `OWNER_OS_TAB_TYPES` (types.ts) —
// adding a new tab type is one line there.

const T1_TABS: ReadonlyArray<OwnerOSTabType> = [
  'chat',
  // "Today's task" = a focused reminders panel
  'reminders',
  // "Last sale" = the marketplace tab (orders + sales feed)
  'marketplace',
  // "Cash position" = treasury (cash-on-hand chart)
  'treasury',
];

const T2_DELTA: ReadonlyArray<OwnerOSTabType> = [
  // Cooperative-scale gets the workforce roster
  'workforce',
  // Cooperative settlement period — surfaced via finance tab w/ coop slice
  'finance',
  // Weekly KPI = the standard insights surface
  'insights',
];

const T3_DELTA: ReadonlyArray<OwnerOSTabType> = [
  // Manager dispatch + ops + sites = the operational layer
  'ops',
  'sites',
  // Compliance calendar
  'compliance',
  // Payroll lives inside HR
  'hr',
];

const T4_DELTA: ReadonlyArray<OwnerOSTabType> = [
  // Full finance suite already on; add accounting + audit + risk + ESG
  // pipeline, regulator inbox, safety board, forecast surfaces.
  'accounting',
  'audit',
  'risk',
  'safety',
  'regulatory-filings',
];

const T5_DELTA: ReadonlyArray<OwnerOSTabType> = [
  // Multi-tenant / cross-border group surfaces
  'holdings',
  'subsidiaries',
  'family-office',
  'reports',
];

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Return the ordered tab ids the owner cockpit should render by default
 * for a given scale tier. The returned array is frozen — callers MUST
 * NOT mutate it (per project immutability rules).
 *
 * Sizes per spec:
 *   T1  4  T2  7  T3 11  T4 16  T5 20
 */
export function defaultTabsFor(tier: ScaleTier): ReadonlyArray<OwnerOSTabType> {
  switch (tier) {
    case 't1_artisanal':
      return T1_TABS;
    case 't2_cooperative':
      return Object.freeze([...T1_TABS, ...T2_DELTA] as const);
    case 't3_midtier':
      return Object.freeze([
        ...T1_TABS,
        ...T2_DELTA,
        ...T3_DELTA,
      ] as const);
    case 't4_industrial':
      return Object.freeze([
        ...T1_TABS,
        ...T2_DELTA,
        ...T3_DELTA,
        ...T4_DELTA,
      ] as const);
    case 't5_multi_country':
      return Object.freeze([
        ...T1_TABS,
        ...T2_DELTA,
        ...T3_DELTA,
        ...T4_DELTA,
        ...T5_DELTA,
      ] as const);
  }
}

/**
 * Bilingual human label for a tier — used in the marketing site, the
 * /signup wizard summary card, and admin-web tenant detail. Swahili-first
 * per CLAUDE.md.
 */
export interface ScaleTierLabel {
  readonly tier: ScaleTier;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
  /** Marketing billing-tier hint — NOT billing logic. See SC-5. */
  readonly billingHint:
    | 'free_pilot'
    | 'starter'
    | 'growth'
    | 'enterprise'
    | 'multi_region';
}

export const SCALE_TIER_LABELS: ReadonlyArray<ScaleTierLabel> = Object.freeze([
  {
    tier: 't1_artisanal',
    labelEn: 'Artisanal',
    labelSw: 'Mchimbaji mdogo',
    descriptionEn: '1-5 workers, single pit, owner is operator.',
    descriptionSw: 'Wafanyakazi 1-5, shimo moja, mwenye mgodi ndiye mfanyakazi.',
    billingHint: 'free_pilot',
  },
  {
    tier: 't2_cooperative',
    labelEn: 'Cooperative',
    labelSw: 'Ushirika',
    descriptionEn: '5-50 workers, multiple pits, weekly settlement.',
    descriptionSw: 'Wafanyakazi 5-50, mashimo mengi, malipo kila wiki.',
    billingHint: 'starter',
  },
  {
    tier: 't3_midtier',
    labelEn: 'Mid-tier',
    labelSw: 'Mgodi wa kati',
    descriptionEn: '50-500 workers, multi-site, monthly payroll.',
    descriptionSw: 'Wafanyakazi 50-500, vituo vingi, mishahara kila mwezi.',
    billingHint: 'growth',
  },
  {
    tier: 't4_industrial',
    labelEn: 'Industrial',
    labelSw: 'Mgodi mkubwa',
    descriptionEn: '500-5000 workers, multi-region, full compliance teams.',
    descriptionSw:
      'Wafanyakazi 500-5000, mikoa mingi, timu kamili za uzingativu.',
    billingHint: 'enterprise',
  },
  {
    tier: 't5_multi_country',
    labelEn: 'Multi-country group',
    labelSw: 'Kundi la nchi nyingi',
    descriptionEn: 'Cross-border group, multi-currency consolidation.',
    descriptionSw: 'Kundi la nchi mbalimbali, fedha za aina nyingi.',
    billingHint: 'multi_region',
  },
] as const);

/**
 * Look up the bilingual label / hint for a tier. Returns the T1 label
 * as a safe fallback if the tier string is unknown.
 */
export function scaleTierLabel(tier: ScaleTier): ScaleTierLabel {
  const hit = SCALE_TIER_LABELS.find((l) => l.tier === tier);
  return hit ?? SCALE_TIER_LABELS[0]!;
}

// ─── Auto-detect from wizard signals ────────────────────────────────

/**
 * Signal tuple the owner sign-up wizard captures. The fields are all
 * voluntary; missing values are treated as "small" (the most defensive
 * default — a single artisanal pit).
 */
export interface ScaleSignals {
  /** Number of workers the owner expects to have on payroll. */
  readonly workerCount?: number;
  /** Number of distinct mining sites / pits the org operates. */
  readonly siteCount?: number;
  /** Number of distinct minerals worked. */
  readonly mineralCount?: number;
  /** True when the org operates in more than one country. */
  readonly crossBorder?: boolean;
}

/**
 * Compute a tier from the signup-wizard signals. The order of checks
 * matters — we test from the top (most-permissive) down so an org with
 * 600 workers AND cross-border ends at T5, not T4.
 *
 * Numbers come from the spec:
 *   1-5 → T1, 5-50 → T2, 50-500 → T3, 500-5000 → T4, +cross-border → T5
 *
 * `siteCount` ≥ 2 forces at LEAST T2 (multi-pit) even with a tiny
 * workforce — the multi-site cockpit is what makes the tab set worth
 * paying for.
 */
export function autoDetectScaleTier(signals: ScaleSignals): ScaleTier {
  const workers = Math.max(0, signals.workerCount ?? 1);
  const sites = Math.max(1, signals.siteCount ?? 1);
  const crossBorder = signals.crossBorder === true;

  if (crossBorder) return 't5_multi_country';
  if (workers > 500) return 't4_industrial';
  if (workers > 50 || sites > 4) return 't3_midtier';
  if (workers > 5 || sites > 1) return 't2_cooperative';
  return 't1_artisanal';
}
