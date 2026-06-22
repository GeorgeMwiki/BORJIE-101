/**
 * compliance-surface — guard-exempt bilingual (sw / en) copy for the
 * HONEST live-feed states of `components/compliance/ComplianceSurface.tsx`.
 *
 * The per-regulator filing STATUS (green / amber / red traffic light) and
 * the per-filing "next due" countdowns are NOT yet served by a live
 * gateway endpoint (`/api/v1/compliance/checklist` is unwired). Rather
 * than fabricate a status on a REGULATORY surface, the component renders
 * the obligation framework (real TZ mining-act law) with an honest
 * "pending live feed" pill, and the KPI strip is computed from the live
 * `daily-brief` compliance rollup — never invented literals.
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 */

export const complianceSurfaceStrings = {
  /** Honest per-regulator status when no live checklist feed exists. */
  statusPending: { en: 'Pending live feed', sw: 'Inasubiri mlisho hai' },

  /** KPI rollup banner when the daily-brief compliance slot is empty. */
  rollupPendingTitle: {
    en: 'Compliance status pending live feed',
    sw: 'Hali ya uzingatiaji inasubiri mlisho hai',
  },
  rollupPendingBody: {
    en: 'Per-filing status is sourced from the live compliance feed. The obligation framework below is the standing Tanzanian mining-act schedule; per-filing traffic-light status appears once the checklist feed is connected.',
    sw: 'Hali ya kila wasilisho hutoka kwenye mlisho hai wa uzingatiaji. Orodha ya majukumu hapa chini ni ratiba ya kudumu ya sheria ya madini ya Tanzania; hali ya taa za trafiki ya kila wasilisho itaonekana mara mlisho wa orodha utakapounganishwa.',
  },

  /** KPI strip when driven by the live daily-brief rollup. */
  rollupSourceNote: {
    en: 'From the live daily-brief compliance rollup',
    sw: 'Kutoka muhtasari hai wa uzingatiaji wa ripoti ya siku',
  },

  /** Column header for the per-filing status column. */
  colStatus: { en: 'Status', sw: 'Hali' },
} as const;
