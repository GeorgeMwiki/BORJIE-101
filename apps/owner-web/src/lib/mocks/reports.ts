/**
 * Report catalogue mocks (O-W-18).
 *
 * The owner picks a report type + date range then triggers a
 * generation job. The generated report is offered as a downloadable
 * PDF stub URL once ready.
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

export interface GeneratedReport {
  readonly id: string;
  readonly kind: ReportKind;
  readonly url: string;
  readonly generatedAt: string;
  readonly pages: number;
}

export function generateMockReport(kind: ReportKind): GeneratedReport {
  return {
    id: `rpt_${kind}_${Date.now()}`,
    kind,
    url: `/api/v1/owner/reports/${kind}/${Date.now()}.pdf`,
    generatedAt: new Date().toISOString(),
    pages: kind === 'board-pack' ? 24 : kind === 'monthly-business' ? 12 : 4,
  };
}
