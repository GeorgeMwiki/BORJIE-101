/**
 * Proactive Alert Engine — surfaces insights without being asked.
 *
 * Scans the unified snapshot + cross-module insights and emits an
 * operator-facing alert queue: every alert comes with evidence refs and an
 * action plan. Priority 1 alerts require immediate operator action.
 *
 * Example output:
 *   {
 *     priority: 1,
 *     category: 'arrears_escalation',
 *     title: '3 units in District-East entering 91+ arrears bucket',
 *     actionPlan: [
 *       'Issue soft demand (Swahili) within 48h',
 *       'Escalate to field visit if no response',
 *       'Prepare legal notice draft',
 *     ],
 *     evidenceRefs: ['payments.arrears_bucket_91_plus', 'cases.open_high']
 *   }
 *
 * @module intelligence-orchestrator/proactive-alert-engine
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  LeasingSnapshot,
  InspectionSnapshot,
  TenantRiskSnapshot,
  OccupancySnapshot,
  CrossModuleInsight,
  ProactiveAlert,
} from './types.js';

export interface AlertInput {
  readonly payments: PaymentsSnapshot | null;
  readonly maintenance: MaintenanceSnapshot | null;
  readonly compliance: ComplianceSnapshot | null;
  readonly leasing: LeasingSnapshot | null;
  readonly inspection: InspectionSnapshot | null;
  readonly tenantRisk: TenantRiskSnapshot | null;
  readonly occupancy: OccupancySnapshot | null;
  readonly crossModuleInsights: readonly CrossModuleInsight[];
}

export function generateProactiveAlerts(
  input: AlertInput,
  confidenceThreshold: number,
): readonly ProactiveAlert[] {
  const alerts: ProactiveAlert[] = [];
  const ts = Date.now();
  const nextId = (): string =>
    `pa-${ts}-${Math.random().toString(36).slice(2, 8)}`;

  // P1: 91+ arrears bucket
  if (input.payments && input.payments.arrearsBuckets['91_plus'] > 0) {
    alerts.push({
      id: nextId(),
      priority: 1,
      category: 'arrears_escalation',
      title: 'Arrears in 91+ day bucket',
      message:
        `Arrears aging beyond 90 days detected. ` +
        `Total 91+ bucket: ${formatCents(input.payments.arrearsBuckets['91_plus'])}.`,
      evidenceRefs: ['payments.arrears_buckets.91_plus'],
      actionPlan: [
        'Issue formal demand letter (Swahili/English).',
        'Schedule field visit if no response within 7 days.',
        'Prepare legal notice draft for manager review.',
      ],
      dataPoints: {
        buckets: input.payments.arrearsBuckets,
        consecutiveLateMonths: input.payments.consecutiveLateMonths,
      },
      requiresOperatorAction: true,
    });
  }

  // P1: critical compliance breach
  if (input.compliance && input.compliance.criticalBreaches > 0) {
    alerts.push({
      id: nextId(),
      priority: 1,
      category: 'compliance_breach',
      title: `${input.compliance.criticalBreaches} critical compliance breach(es)`,
      message:
        `Immediate remediation required. ${input.compliance.overdueItems} compliance item(s) overdue overall.`,
      evidenceRefs: ['compliance.critical_breaches', 'compliance.overdue_items'],
      actionPlan: [
        'Acknowledge breach in system.',
        'Remediate or document mitigation within 48h.',
        'File regulator notification if threshold exceeded.',
      ],
      dataPoints: {
        critical: input.compliance.criticalBreaches,
        overdue: input.compliance.overdueItems,
      },
      requiresOperatorAction: true,
    });
  }

  // P1: occupancy dip
  if (input.occupancy && input.occupancy.occupancyPct < 80) {
    alerts.push({
      id: nextId(),
      priority: 1,
      category: 'occupancy_dip',
      title: `Occupancy below threshold: ${input.occupancy.occupancyPct.toFixed(0)}%`,
      message:
        `${input.occupancy.vacancyCount} vacant unit(s). Average vacancy days: ` +
        `${input.occupancy.avgVacancyDays.toFixed(0)}. Time on market: ${input.occupancy.timeOnMarketDays.toFixed(0)}d.`,
      evidenceRefs: ['occupancy.pct', 'occupancy.vacancy_count'],
      actionPlan: [
        'Review marketplace listings and pricing.',
        'Trigger boosted campaigns for long-vacant units.',
        'Consider rent adjustment for units >60 days on market.',
      ],
      dataPoints: {
        occupancyPct: input.occupancy.occupancyPct,
        vacancies: input.occupancy.vacancyCount,
      },
      requiresOperatorAction: true,
    });
  }

  // P1: cross-module critical insights
  const criticalInsights = input.crossModuleInsights.filter(
    (i) => i.severity === 'critical' && i.confidence >= confidenceThreshold,
  );
  for (const insight of criticalInsights) {
    alerts.push({
      id: nextId(),
      priority: 1,
      category: 'compliance_breach',
      title: insight.title,
      message: insight.description,
      evidenceRefs: insight.sourceModules.map((m) => `${m}.snapshot`),
      actionPlan: insight.suggestedAction
        ? [insight.suggestedAction]
        : ['Review cross-module analysis.'],
      dataPoints: { modules: insight.sourceModules },
      requiresOperatorAction: true,
    });
  }

  // P2: maintenance cost spike
  if (input.maintenance && input.maintenance.costMomYoYPct > 25) {
    alerts.push({
      id: nextId(),
      priority: 2,
      category: 'maintenance_cost',
      title: 'Maintenance cost spike detected',
      message:
        `Maintenance costs up ${input.maintenance.costMomYoYPct.toFixed(0)}% YoY. ` +
        `Open cases: ${input.maintenance.openCases}. Critical: ${input.maintenance.criticalCases}.`,
      evidenceRefs: [
        'maintenance.cost_last_90d',
        'maintenance.cost_trend_yoy',
      ],
      actionPlan: [
        'Identify top 3 cost categories.',
        'Review vendor pricing vs. alternates.',
        'Assess capex vs. repair decisions for aging assets.',
      ],
      dataPoints: {
        costYoY: input.maintenance.costMomYoYPct,
        topCategories: input.maintenance.topCategories,
      },
      requiresOperatorAction: false,
    });
  }

  // P2: cross-module high insights
  const highInsights = input.crossModuleInsights.filter(
    (i) => i.severity === 'high' && i.confidence >= confidenceThreshold,
  );
  for (const insight of highInsights) {
    alerts.push({
      id: nextId(),
      priority: 2,
      category: 'tenant_churn',
      title: insight.title,
      message: insight.description,
      evidenceRefs: insight.sourceModules.map((m) => `${m}.snapshot`),
      actionPlan: insight.suggestedAction
        ? [insight.suggestedAction]
        : ['Review detailed analysis.'],
      dataPoints: { modules: insight.sourceModules },
      requiresOperatorAction: false,
    });
  }

  // P2: churn probability elevated
  if (input.leasing && input.leasing.churnProbability > 0.6) {
    alerts.push({
      id: nextId(),
      priority: 2,
      category: 'tenant_churn',
      title: `Tenant churn probability ${(input.leasing.churnProbability * 100).toFixed(0)}%`,
      message:
        `Upcoming lease ends: ${input.leasing.leaseEndWithin60d}; pending renewals: ${input.leasing.pendingRenewals}.`,
      evidenceRefs: ['leasing.churn_probability', 'leasing.lease_end_60d'],
      actionPlan: [
        'Send renewal offers 45 days before lease end.',
        'Schedule satisfaction check-ins for at-risk units.',
      ],
      dataPoints: {
        churnProbability: input.leasing.churnProbability,
        upcomingEnds: input.leasing.leaseEndWithin60d,
      },
      requiresOperatorAction: false,
    });
  }

  // P2: inspection gap
  if (input.inspection && input.inspection.overdueInspections > 0) {
    alerts.push({
      id: nextId(),
      priority: 2,
      category: 'inspection_gap',
      title: `${input.inspection.overdueInspections} overdue inspection(s)`,
      message: `Failed items in most-recent inspection: ${input.inspection.failedItems}.`,
      evidenceRefs: ['inspection.overdue', 'inspection.failed_items'],
      actionPlan: [
        'Dispatch field team to clear inspection backlog.',
        'Auto-create maintenance cases for each failed item.',
      ],
      dataPoints: {
        overdue: input.inspection.overdueInspections,
        failed: input.inspection.failedItems,
      },
      requiresOperatorAction: false,
    });
  }

  // P3: tenant dispute pattern
  if (input.tenantRisk && input.tenantRisk.disputeCount > 1) {
    alerts.push({
      id: nextId(),
      priority: 3,
      category: 'tenant_churn',
      title: `${input.tenantRisk.disputeCount} disputes on record`,
      message: `Payment reliability: ${input.tenantRisk.paymentReliabilityPct.toFixed(0)}%.`,
      evidenceRefs: ['tenant_risk.disputes', 'tenant_risk.payment_reliability'],
      actionPlan: [
        'Review dispute resolution timelines.',
        'Document decisions for future audit trail.',
      ],
      dataPoints: {
        disputes: input.tenantRisk.disputeCount,
        reliability: input.tenantRisk.paymentReliabilityPct,
      },
      requiresOperatorAction: false,
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
