/**
 * VP Operations — weekly report drafting. Cross-line-worker aggregate
 * rendered as KPI cards via genui in the owner portal.
 */

import type { ScopeContext } from '../../../types.js';
import {
  buildVpReportCard,
  rollupSeverity,
  type VpLineWorkerRollup,
  type VpReportCard,
  type VpWeeklyReport,
} from '../shared/vp-base.js';

export const VP_OPERATIONS_REPORT_CARDS = Object.freeze([
  'maintenance-sla-hit-rate',
  'complaint-resolution-time',
  'vacancy-days',
  'inspection-coverage',
] as const);

export type VpOperationsReportCardKey = (typeof VP_OPERATIONS_REPORT_CARDS)[number];

function pickRollup(
  rollups: ReadonlyArray<VpLineWorkerRollup>,
  lineWorker: string,
): VpLineWorkerRollup | undefined {
  return rollups.find((r) => r.lineWorker === lineWorker);
}

export async function draftOpsWeeklyReport(args: {
  readonly scope: ScopeContext;
  readonly weekStartingIso: string;
  readonly rollups: ReadonlyArray<VpLineWorkerRollup>;
}): Promise<VpWeeklyReport> {
  const maintenance = pickRollup(args.rollups, 'maintenance.dispatch');
  const complaint = pickRollup(args.rollups, 'complaint.triage');
  const onboarding = pickRollup(args.rollups, 'tenant.onboarding-officer');
  const inspections = pickRollup(args.rollups, 'inspections.scheduler');

  const cards: VpReportCard[] = [
    buildVpReportCard({
      title: 'Maintenance SLA hit-rate',
      headline: 'Maintenance SLA hit-rate',
      ...(maintenance ? { rollup: maintenance } : {}),
      numericUnit: '%',
    }),
    buildVpReportCard({
      title: 'Complaint resolution time',
      headline: 'Avg complaint resolution',
      ...(complaint ? { rollup: complaint } : {}),
      numericUnit: 'hours',
    }),
    buildVpReportCard({
      title: 'Vacancy days',
      headline: 'Vacancy days (onboarding-side)',
      ...(onboarding ? { rollup: onboarding } : {}),
      numericUnit: 'days',
    }),
    buildVpReportCard({
      title: 'Inspection coverage',
      headline: 'Inspection coverage',
      ...(inspections ? { rollup: inspections } : {}),
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
    vpName: 'vp.operations',
    reportsTo: 'owner' as const,
    weekStartingIso: args.weekStartingIso,
    cards: Object.freeze(cards),
    lineWorkerRollups: Object.freeze([...args.rollups]),
    riskCallouts: Object.freeze(riskCallouts),
  });
}
