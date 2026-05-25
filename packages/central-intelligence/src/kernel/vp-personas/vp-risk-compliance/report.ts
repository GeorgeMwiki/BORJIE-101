/**
 * VP Risk & Compliance — weekly report.
 *   - open compliance items
 *   - regulator filing calendar
 *   - dispute log
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildVpReportCard,
  rollupSeverity,
  type VpLineWorkerRollup,
  type VpReportCard,
  type VpWeeklyReport,
} from '../shared/vp-base.js';

export const VP_RISK_COMPLIANCE_REPORT_CARDS = Object.freeze([
  'open-compliance-items',
  'regulator-filing-calendar',
  'dispute-log',
] as const);

export type VpRiskComplianceReportCardKey =
  (typeof VP_RISK_COMPLIANCE_REPORT_CARDS)[number];

function pick(
  rollups: ReadonlyArray<VpLineWorkerRollup>,
  lineWorker: string,
): VpLineWorkerRollup | undefined {
  return rollups.find((r) => r.lineWorker === lineWorker);
}

export async function draftRiskComplianceWeeklyReport(args: {
  readonly scope: ScopeContext;
  readonly weekStartingIso: string;
  readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
}): Promise<VpWeeklyReport> {
  const filing = pick(args.rollups, 'compliance.filing-monitor');
  const insurance = pick(args.rollups, 'insurance.coordinator');
  const dispute = pick(args.rollups, 'dispute.mediator');

  const insuranceNote = insurance?.notes ?? 'no insurance note';

  const cards: VpReportCard[] = [
    buildVpReportCard({
      title: 'Open compliance items',
      headline: 'Open compliance items',
      ...(filing ? { rollup: filing } : {}),
      fallbackCommentary: 'Open filings + insurance gaps combined.',
    }),
    buildVpReportCard({
      title: 'Regulator filing calendar',
      headline: 'Next filing window',
      ...(filing ? { rollup: filing } : {}),
    }),
    buildVpReportCard({
      title: 'Dispute log',
      headline: 'Open disputes',
      ...(dispute ? { rollup: dispute } : {}),
      fallbackCommentary: `Insurance rollup: ${insuranceNote}`,
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
    vpName: 'vp.risk-compliance',
    reportsTo: 'owner' as const,
    weekStartingIso: args.weekStartingIso,
    cards: Object.freeze(cards),
    lineWorkerRollups: Object.freeze([...args.rollups]),
    riskCallouts: Object.freeze(riskCallouts),
  });
}
