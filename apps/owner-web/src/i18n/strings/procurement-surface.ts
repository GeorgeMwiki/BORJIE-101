/**
 * Procurement-coordination surface (O-W-10) — per-file {en, sw} string
 * module.
 *
 * Single language per active locale (zero-mix canon). Every key carries a
 * REAL Swahili translation; no machine-translation stubs, no English value
 * sitting in the `sw` slot. The endpoint `hint` strings are diagnostic and
 * not user copy — they stay as the bare path on both locales by design.
 *
 * `scope` and `period` are free-form data values served by the gateway (not a
 * closed UI vocabulary) so they render verbatim. `kycStatus` and
 * `preferredStatus` ARE closed enums (KYC_STATUSES / PREFERRED_STATUSES) and so
 * are localized through the label tables below — never the raw token. The
 * chrome — section headers, column headers, empty/error copy and the closed
 * alert-level enum — is localized here too.
 */

export const procurementSurfaceStrings = {
  refresh: { en: 'Refresh', sw: 'Onyesha upya' },
  unknownError: { en: 'unknown error', sw: 'hitilafu isiyojulikana' },

  // Spend-by-vendor section
  spendTitle: { en: 'Spend by vendor', sw: 'Matumizi kwa muuzaji' },
  spendSubtitle: {
    en: 'Issued + closed purchase orders aggregated per vendor.',
    sw: 'Oda za ununuzi zilizotolewa + zilizofungwa zilizokusanywa kwa kila muuzaji.',
  },
  spendLoadFailedTitle: {
    en: 'Could not load spend analytics',
    sw: 'Imeshindwa kupakia takwimu za matumizi',
  },
  spendEmptyTitle: { en: 'No spend yet', sw: 'Hakuna matumizi bado' },
  spendEmptyBody: {
    en: 'Issue purchase orders to vendors to see real spend aggregated here by vendor and category.',
    sw: 'Toa oda za ununuzi kwa wauzaji ili kuona matumizi halisi yaliyokusanywa hapa kwa muuzaji na kundi.',
  },

  // Budgets section
  budgetsTitle: { en: 'Budget availability', sw: 'Upatikanaji wa bajeti' },
  budgetsSubtitle: {
    en: 'Amount less spent, committed and reserved — with alert level.',
    sw: 'Kiasi kasoro kilichotumika, kilichoahidiwa na kilichohifadhiwa — na kiwango cha tahadhari.',
  },
  budgetsLoadFailedTitle: {
    en: 'Could not load budgets',
    sw: 'Imeshindwa kupakia bajeti',
  },
  budgetsEmptyTitle: { en: 'No budgets set', sw: 'Hakuna bajeti zilizowekwa' },
  budgetsEmptyBody: {
    en: 'Create procurement budgets to track availability, commitments and overspend alerts.',
    sw: 'Tengeneza bajeti za ununuzi ili kufuatilia upatikanaji, ahadi na tahadhari za matumizi ya ziada.',
  },

  // Vendors section
  vendorsTitle: { en: 'Vendor registry', sw: 'Daftari la wauzaji' },
  vendorsSubtitle: {
    en: 'Approved + pending vendors with KYC status and rating.',
    sw: 'Wauzaji walioidhinishwa + wanaosubiri wenye hali ya KYC na ukadiriaji.',
  },
  vendorsLoadFailedTitle: {
    en: 'Could not load vendors',
    sw: 'Imeshindwa kupakia wauzaji',
  },
  vendorsEmptyTitle: {
    en: 'No vendors registered',
    sw: 'Hakuna wauzaji waliosajiliwa',
  },
  vendorsEmptyBody: {
    en: 'Register suppliers to build the vendor registry that powers RFQs, purchase orders and spend analytics.',
    sw: 'Sajili wasambazaji ili kujenga daftari la wauzaji linaloendesha RFQ, oda za ununuzi na takwimu za matumizi.',
  },

  // Spend table columns
  colVendor: { en: 'Vendor', sw: 'Muuzaji' },
  colPos: { en: 'POs', sw: 'Oda' },
  colAvgPo: { en: 'Avg PO', sw: 'Wastani wa oda' },
  colTotalSpend: { en: 'Total spend', sw: 'Jumla ya matumizi' },

  // Budgets table columns
  colScope: { en: 'Scope', sw: 'Wigo' },
  colPeriod: { en: 'Period', sw: 'Kipindi' },
  colBudget: { en: 'Budget', sw: 'Bajeti' },
  colAvailable: { en: 'Available', sw: 'Inayopatikana' },
  colUtilisation: { en: 'Utilisation', sw: 'Matumizi' },
  colStatus: { en: 'Status', sw: 'Hali' },

  // Vendors table columns
  colCountry: { en: 'Country', sw: 'Nchi' },
  colKyc: { en: 'KYC', sw: 'KYC' },
  colRating: { en: 'Rating', sw: 'Ukadiriaji' },
} as const;

/**
 * Budget alert-level labels (a closed enum) — one canonical Swahili term
 * per level. Rendered inside the status badge so the level reads in the
 * active locale, never the raw token.
 */
export const budgetAlertLevelLabels: Record<
  'green' | 'amber' | 'red' | 'over',
  { readonly en: string; readonly sw: string }
> = {
  green: { en: 'Green', sw: 'Kijani' },
  amber: { en: 'Amber', sw: 'Manjano' },
  red: { en: 'Red', sw: 'Nyekundu' },
  over: { en: 'Over', sw: 'Imezidi' },
};

/**
 * Vendor KYC-status labels — the closed `KYC_STATUSES` vocabulary from
 * `@borjie/procurement-coordination` (pending | submitted | approved |
 * rejected | blocked). Rendered in the active locale, never the raw token.
 */
export const kycStatusLabels: Record<
  'pending' | 'submitted' | 'approved' | 'rejected' | 'blocked',
  { readonly en: string; readonly sw: string }
> = {
  pending: { en: 'Pending', sw: 'Inasubiri' },
  submitted: { en: 'Submitted', sw: 'Imewasilishwa' },
  approved: { en: 'Approved', sw: 'Imeidhinishwa' },
  rejected: { en: 'Rejected', sw: 'Imekataliwa' },
  blocked: { en: 'Blocked', sw: 'Imezuiwa' },
};

/**
 * Vendor preferred-status labels — the closed `PREFERRED_STATUSES`
 * vocabulary (preferred | standard | blacklisted). Active-locale only.
 */
export const preferredStatusLabels: Record<
  'preferred' | 'standard' | 'blacklisted',
  { readonly en: string; readonly sw: string }
> = {
  preferred: { en: 'Preferred', sw: 'Anayependelewa' },
  standard: { en: 'Standard', sw: 'Kawaida' },
  blacklisted: { en: 'Blacklisted', sw: 'Amepigwa marufuku' },
};

/** Fallback for an unrecognised status value — never a raw token. */
export const vendorStatusUnknown = { en: 'Unknown', sw: 'Haijulikani' };

/**
 * Budget-scope labels — the closed `BUDGET_SCOPES` vocabulary from
 * `@borjie/procurement-coordination` (org | department | property |
 * category). Rendered in the active locale, never the raw token.
 *
 * MINING-DOMAIN RENAME: the `property` scope is a real-estate residue from
 * the source domain (BUDGET_SCOPES still ships `'property'`). A mining owner
 * scopes a budget to a SITE, so we render it as "Site" / "Tovuti" — a
 * LABEL-ONLY rename. The DB enum value stays `property` (immutable enum); the
 * coordinated schema rename is flagged as a residual, not done here.
 */
export const budgetScopeLabels: Record<
  'org' | 'department' | 'property' | 'category',
  { readonly en: string; readonly sw: string }
> = {
  org: { en: 'Organisation', sw: 'Shirika' },
  department: { en: 'Department', sw: 'Idara' },
  property: { en: 'Site', sw: 'Tovuti' },
  category: { en: 'Category', sw: 'Kundi' },
};

/**
 * Budget-period labels — the closed `BUDGET_PERIODS` vocabulary
 * (monthly | quarterly | annual). Active-locale only, never the raw token.
 */
export const budgetPeriodLabels: Record<
  'monthly' | 'quarterly' | 'annual',
  { readonly en: string; readonly sw: string }
> = {
  monthly: { en: 'Monthly', sw: 'Kila mwezi' },
  quarterly: { en: 'Quarterly', sw: 'Kila robo mwaka' },
  annual: { en: 'Annual', sw: 'Kila mwaka' },
};

/** Fallback for an unrecognised scope / period value — never a raw token. */
export const budgetScopePeriodUnknown = { en: 'Unknown', sw: 'Haijulikani' };
