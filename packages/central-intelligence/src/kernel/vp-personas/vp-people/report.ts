/**
 * VP People — weekly report.
 *   - vendor performance scorecards
 *   - employee attrition risk
 *   - payroll on-time hit-rate
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildVpReportCard,
  rollupSeverity,
  type VpLineWorkerRollup,
  type VpReportCard,
  type VpWeeklyReport,
} from '../shared/vp-base.js';

export const VP_PEOPLE_REPORT_CARDS = Object.freeze([
  'vendor-performance',
  'employee-attrition-risk',
  'payroll-on-time',
] as const);

export type VpPeopleReportCardKey = (typeof VP_PEOPLE_REPORT_CARDS)[number];

function pick(
  rollups: ReadonlyArray<VpLineWorkerRollup>,
  lineWorker: string,
): VpLineWorkerRollup | undefined {
  return rollups.find((r) => r.lineWorker === lineWorker);
}

export async function draftPeopleWeeklyReport(args: {
  readonly scope: ScopeContext;
  readonly weekStartingIso: string;
  readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
}): Promise<VpWeeklyReport> {
  const vendor = pick(args.rollups, 'vendor.onboarding');
  const retention = pick(args.rollups, 'retention.strategist');
  const payroll = pick(args.rollups, 'payroll-prep');

  const cards: VpReportCard[] = [
    buildVpReportCard({
      title: 'Vendor performance',
      headline: 'Vendor scorecard (median)',
      ...(vendor ? { rollup: vendor } : {}),
      numericUnit: '/100',
    }),
    buildVpReportCard({
      title: 'Employee attrition risk',
      headline: 'Employees at-risk',
      ...(retention ? { rollup: retention } : {}),
      fallbackCommentary: 'From retention.strategist.',
    }),
    buildVpReportCard({
      title: 'Payroll on-time',
      headline: 'Payroll on-time hit-rate',
      ...(payroll ? { rollup: payroll } : {}),
      numericUnit: '%',
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
    vpName: 'vp.people',
    reportsTo: 'owner' as const,
    weekStartingIso: args.weekStartingIso,
    cards: Object.freeze(cards),
    lineWorkerRollups: Object.freeze([...args.rollups]),
    riskCallouts: Object.freeze(riskCallouts),
  });
}
