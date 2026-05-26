/**
 * Report catalogue type shapes (O-W-18).
 */

export type ReportKind =
  | 'daily-owner-brief'
  | 'weekly-strategy-memo'
  | 'monthly-business'
  | 'site-daily'
  | 'investor-bank'
  | 'board-pack'
  | 'audit-pack'
  | 'community-update';

export interface ReportSpec {
  readonly kind: ReportKind;
  readonly title: string;
  readonly description: string;
  readonly defaultRangeDays: number;
}

export interface GeneratedReport {
  readonly id: string;
  readonly kind: ReportKind;
  readonly url: string;
  readonly generatedAt: string;
  readonly pages: number;
}

/**
 * Static catalogue of report kinds the owner can generate. This is UI
 * configuration (not mock data) — every kind here maps 1:1 onto a
 * gateway endpoint exposed by `services/api-gateway/src/routes/mining/reports.hono.ts`.
 */
export const REPORT_CATALOGUE: ReadonlyArray<ReportSpec> = [
  {
    kind: 'daily-owner-brief',
    title: 'Daily Owner Brief',
    description: 'Cockpit snapshot, blockers, decisions waiting on me.',
    defaultRangeDays: 1,
  },
  {
    kind: 'weekly-strategy-memo',
    title: 'Weekly Strategy Memo',
    description: 'Portfolio ranking, capital pacing, mechanisation pacing.',
    defaultRangeDays: 7,
  },
  {
    kind: 'monthly-business',
    title: 'Monthly Business Report',
    description: 'Full operating + financial report card.',
    defaultRangeDays: 30,
  },
  {
    kind: 'site-daily',
    title: 'Site Daily',
    description: 'Single-site shift reconciliation and blockers.',
    defaultRangeDays: 1,
  },
  {
    kind: 'investor-bank',
    title: 'Investor / Bank Pack',
    description: 'External-narrative one-pager with provenance.',
    defaultRangeDays: 30,
  },
  {
    kind: 'board-pack',
    title: 'Board Pack',
    description: 'Quarterly board narrative with risk and asks.',
    defaultRangeDays: 90,
  },
  {
    kind: 'audit-pack',
    title: 'Audit Pack',
    description: 'Regulator-ready evidence chain.',
    defaultRangeDays: 90,
  },
  {
    kind: 'community-update',
    title: 'Community Update',
    description: 'Village-friendly Swahili CSR delivery summary.',
    defaultRangeDays: 30,
  },
];
