/**
 * VP Growth — weekly report.
 *   - renewal rate
 *   - vacancy days
 *   - pricing vs market
 *   - candidate acquisitions
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildVpReportCard,
  rollupSeverity,
  type VpLineWorkerRollup,
  type VpReportCard,
  type VpWeeklyReport,
} from '../shared/vp-base.js';

export const VP_GROWTH_REPORT_CARDS = Object.freeze([
  'renewal-rate',
  'vacancy-days',
  'pricing-vs-market',
  'candidate-acquisitions',
] as const);

export type VpGrowthReportCardKey = (typeof VP_GROWTH_REPORT_CARDS)[number];

function pick(
  rollups: ReadonlyArray<VpLineWorkerRollup>,
  lineWorker: string,
): VpLineWorkerRollup | undefined {
  return rollups.find((r) => r.lineWorker === lineWorker);
}

export async function draftGrowthWeeklyReport(args: {
  readonly scope: ScopeContext;
  readonly weekStartingIso: string;
  readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
}): Promise<VpWeeklyReport> {
  const lease = pick(args.rollups, 'lease.coordinator');
  const afterHours = pick(args.rollups, 'leasing.after-hours-contact');
  const pricing = pick(args.rollups, 'pricing.analyst');
  const acquisitions = pick(args.rollups, 'vacancy.acquisitions-scout');

  const cards: VpReportCard[] = [
    buildVpReportCard({
      title: 'Renewal rate',
      headline: 'Lease renewal rate',
      ...(lease ? { rollup: lease } : {}),
      numericUnit: '%',
      fallbackCommentary: 'Cohort renewal funnel.',
    }),
    buildVpReportCard({
      title: 'Vacancy days',
      headline: 'Avg vacancy-to-lease days',
      ...(afterHours ? { rollup: afterHours } : {}),
      numericUnit: 'days',
    }),
    buildVpReportCard({
      title: 'Pricing vs market',
      headline: 'Pricing variance vs comp set',
      ...(pricing ? { rollup: pricing } : {}),
      numericUnit: '%',
    }),
    buildVpReportCard({
      title: 'Candidate acquisitions',
      headline: 'Candidate acquisitions in pipe',
      ...(acquisitions ? { rollup: acquisitions } : {}),
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
    vpName: 'vp.growth',
    reportsTo: 'owner' as const,
    weekStartingIso: args.weekStartingIso,
    cards: Object.freeze(cards),
    lineWorkerRollups: Object.freeze([...args.rollups]),
    riskCallouts: Object.freeze(riskCallouts),
  });
}
