/**
 * VP Finance — weekly report drafting. NOI, occupancy, arrears, cash
 * position rendered as KPI cards via genui.
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildVpReportCard,
  rollupSeverity,
  type VpLineWorkerRollup,
  type VpReportCard,
  type VpWeeklyReport,
} from '../shared/vp-base.js';

export const VP_FINANCE_REPORT_CARDS = Object.freeze([
  'noi',
  'occupancy',
  'arrears',
  'cash-position',
] as const);

export type VpFinanceReportCardKey = (typeof VP_FINANCE_REPORT_CARDS)[number];

function pick(
  rollups: ReadonlyArray<VpLineWorkerRollup>,
  lineWorker: string,
): VpLineWorkerRollup | undefined {
  return rollups.find((r) => r.lineWorker === lineWorker);
}

export async function draftFinanceWeeklyReport(args: {
  readonly scope: ScopeContext;
  readonly weekStartingIso: string;
  readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
}): Promise<VpWeeklyReport> {
  const arrears = pick(args.rollups, 'arrears.chaser');
  const kra = pick(args.rollups, 'kra.filing-assistant');
  const utilities = pick(args.rollups, 'utility-billing-clerk');
  const cashflow = pick(args.rollups, 'cashflow-forecaster');

  const cards: VpReportCard[] = [
    buildVpReportCard({
      title: 'NOI',
      headline: 'Net operating income (rolling)',
      ...(cashflow ? { rollup: cashflow } : {}),
      numericUnit: 'KES',
      fallbackCommentary: 'Forecast vs. actual from cashflow-forecaster.',
    }),
    buildVpReportCard({
      title: 'Occupancy',
      headline: 'Occupancy (billing-side)',
      ...(utilities ? { rollup: utilities } : {}),
      numericUnit: '%',
    }),
    buildVpReportCard({
      title: 'Arrears',
      headline: 'Open arrears balance',
      ...(arrears ? { rollup: arrears } : {}),
      numericUnit: 'KES',
      fallbackCommentary: 'Aging buckets in line-worker rollup.',
    }),
    buildVpReportCard({
      title: 'Cash position',
      headline: 'KRA filing readiness',
      ...(kra ? { rollup: kra } : {}),
      fallbackCommentary: 'Filing window status.',
    }),
  ];

  const riskCallouts: string[] = [];
  for (const r of args.rollups) {
    if (rollupSeverity(r.outcome) >= 1) {
      riskCallouts.push(
        `${r.lineWorker} → ${r.outcome.toUpperCase()}: ${r.metric}=${r.value} (${r.notes ?? 'no note'})`,
      );
    }
  }

  return Object.freeze({
    vpName: 'vp.finance',
    reportsTo: 'owner' as const,
    weekStartingIso: args.weekStartingIso,
    cards: Object.freeze(cards),
    lineWorkerRollups: Object.freeze([...args.rollups]),
    riskCallouts: Object.freeze(riskCallouts),
  });
}
