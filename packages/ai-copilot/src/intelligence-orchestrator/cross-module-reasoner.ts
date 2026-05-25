/**
 * Cross-Module Reasoner — BORJIE estate edition.
 *
 * Joins facts across maintenance, payments, compliance, leasing, inspection,
 * FAR, tenant-risk, occupancy to surface composite risks that no single
 * module can detect alone.
 *
 * Example: "unit 4B arrears climbing" → reasoner sees (arrears rising 30d)
 * + (3 open plumbing cases in 60d) + (rent 15% above market) → produces
 * "tenant likely dissatisfied, churn probability elevated".
 *
 * @module intelligence-orchestrator/cross-module-reasoner
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  LeasingSnapshot,
  InspectionSnapshot,
  FARSnapshot,
  TenantRiskSnapshot,
  OccupancySnapshot,
  CrossModuleInsight,
} from './types.js';

export interface ReasoningInput {
  readonly payments: PaymentsSnapshot | null;
  readonly maintenance: MaintenanceSnapshot | null;
  readonly compliance: ComplianceSnapshot | null;
  readonly leasing: LeasingSnapshot | null;
  readonly inspection: InspectionSnapshot | null;
  readonly far: FARSnapshot | null;
  readonly tenantRisk: TenantRiskSnapshot | null;
  readonly occupancy: OccupancySnapshot | null;
}

export function generateCrossModuleInsights(
  input: ReasoningInput,
): readonly CrossModuleInsight[] {
  const insights: CrossModuleInsight[] = [];
  const ts = Date.now();
  const nextId = (): string =>
    `cmi-${ts}-${Math.random().toString(36).slice(2, 8)}`;

  // Rule 1: Arrears rising AND maintenance cost spike → tenant dissatisfaction
  if (
    input.payments &&
    input.maintenance &&
    input.payments.arrearsCents > 0 &&
    input.payments.consecutiveLateMonths >= 2 &&
    input.maintenance.costMomYoYPct > 30
  ) {
    insights.push({
      id: nextId(),
      type: 'arrears_rising_with_maintenance_cost_spike',
      severity: 'high',
      title: 'Arrears climbing alongside maintenance cost spike',
      description:
        `Arrears at ${formatCents(input.payments.arrearsCents)} with ${input.payments.consecutiveLateMonths} consecutive late months; ` +
        `maintenance costs up ${input.maintenance.costMomYoYPct.toFixed(0)}% YoY. ` +
        `The combination suggests tenant dissatisfaction or an asset-quality issue the tenant is paying for via reduced compliance.`,
      sourceModules: ['payments', 'maintenance'],
      confidence: 0.8,
      actionable: true,
      suggestedAction:
        'Schedule a tenant conversation; inspect the unit; propose a joint maintenance/payment plan.',
    });
  }

  // Rule 2: Vacancy dip AND elevated churn probability
  if (
    input.leasing &&
    input.occupancy &&
    input.leasing.churnProbability > 0.6 &&
    input.occupancy.occupancyPct < 85
  ) {
    insights.push({
      id: nextId(),
      type: 'vacancy_dip_with_tenant_churn',
      severity: 'high',
      title: 'Occupancy below 85% with elevated churn probability',
      description:
        `Occupancy is ${input.occupancy.occupancyPct.toFixed(0)}% and churn probability is ` +
        `${(input.leasing.churnProbability * 100).toFixed(0)}%. Without intervention, ` +
        `vacancy will worsen as upcoming lease-ends do not renew.`,
      sourceModules: ['leasing', 'occupancy'],
      confidence: 0.75,
      actionable: true,
      suggestedAction:
        'Trigger retention campaign: targeted renewal offers, mid-lease satisfaction check-ins.',
    });
  }

  // Rule 3: Compliance breach on high-risk tenant
  if (
    input.compliance &&
    input.tenantRisk &&
    input.compliance.criticalBreaches > 0 &&
    (input.tenantRisk.riskGrade === 'D' || input.tenantRisk.riskGrade === 'E')
  ) {
    insights.push({
      id: nextId(),
      type: 'compliance_breach_on_high_risk_tenant',
      severity: 'critical',
      title: 'Compliance breach on a high-risk tenant',
      description:
        `${input.compliance.criticalBreaches} critical compliance breach(es) affect a ` +
        `grade-${input.tenantRisk.riskGrade} tenant (risk score ${input.tenantRisk.riskScore}/100). ` +
        `Regulatory exposure compounds with dispute likelihood.`,
      sourceModules: ['compliance', 'tenant-risk'],
      confidence: 0.85,
      actionable: true,
      suggestedAction:
        'Prioritise breach remediation; pre-notify legal; capture evidence chain for any tenant dispute.',
    });
  }

  // Rule 4: Repeat maintenance AND rent already above market
  if (
    input.maintenance &&
    input.leasing &&
    input.maintenance.repeatCaseRate > 0.3 &&
    input.leasing.avgRentVsMarketPct > 10
  ) {
    insights.push({
      id: nextId(),
      type: 'repeat_maintenance_with_rent_concession',
      severity: 'medium',
      title: 'High repeat-maintenance while rent is above market',
      description:
        `Repeat-case rate ${(input.maintenance.repeatCaseRate * 100).toFixed(0)}% ` +
        `with rent ${input.leasing.avgRentVsMarketPct.toFixed(0)}% above market. ` +
        `Tenants paying a premium will not tolerate chronic issues; churn will rise.`,
      sourceModules: ['maintenance', 'leasing'],
      confidence: 0.7,
      actionable: true,
      suggestedAction:
        'Fix root-cause on recurring categories; consider temporary rent concession during remediation.',
    });
  }

  // Rule 5: Lease ending soon AND open compliance items
  if (
    input.leasing &&
    input.compliance &&
    input.leasing.leaseEndWithin60d > 0 &&
    input.compliance.overdueItems > 0
  ) {
    insights.push({
      id: nextId(),
      type: 'lease_end_with_open_compliance',
      severity: 'medium',
      title: 'Lease ending with overdue compliance items',
      description:
        `${input.leasing.leaseEndWithin60d} lease(s) end in the next 60 days while ` +
        `${input.compliance.overdueItems} compliance item(s) are overdue. Move-out disputes become ` +
        `inevitable if units are handed over with unresolved compliance.`,
      sourceModules: ['leasing', 'compliance'],
      confidence: 0.7,
      actionable: true,
      suggestedAction:
        'Close compliance items before exit inspection; produce a clean handover pack.',
    });
  }

  // Rule 6: FAR aging AND rising maintenance
  if (
    input.far &&
    input.maintenance &&
    input.far.assetsNearingEOL > 0 &&
    input.maintenance.costMomYoYPct > 20
  ) {
    insights.push({
      id: nextId(),
      type: 'far_aging_with_rising_maintenance',
      severity: 'medium',
      title: 'Aging assets driving rising maintenance cost',
      description:
        `${input.far.assetsNearingEOL} asset(s) nearing end-of-life while maintenance costs are ` +
        `up ${input.maintenance.costMomYoYPct.toFixed(0)}% YoY. Capex replacement is likely cheaper than continued repair.`,
      sourceModules: ['far', 'maintenance'],
      confidence: 0.7,
      actionable: true,
      suggestedAction:
        'Model capex replace-vs-repair; surface to owner for capital decision.',
    });
  }

  // Rule 7: Failed inspection with no follow-up
  if (
    input.inspection &&
    input.inspection.failedItems > 0 &&
    input.maintenance &&
    input.maintenance.openCases === 0
  ) {
    insights.push({
      id: nextId(),
      type: 'inspection_fail_with_no_followup',
      severity: 'high',
      title: 'Failed inspection items with no maintenance follow-up',
      description:
        `${input.inspection.failedItems} inspection item(s) failed but no maintenance cases are open. ` +
        `Unresolved fail-items surface later as tenant complaints and compliance breaches.`,
      sourceModules: ['inspection', 'maintenance'],
      confidence: 0.85,
      actionable: true,
      suggestedAction:
        'Auto-create maintenance cases from each failed inspection item.',
    });
  }

  // Rule 8: Complaint surge with churn risk
  if (
    input.tenantRisk &&
    input.leasing &&
    input.tenantRisk.complaintsLast90d > 2 &&
    input.leasing.churnProbability > 0.5
  ) {
    insights.push({
      id: nextId(),
      type: 'tenant_complaint_surge_with_churn_risk',
      severity: 'high',
      title: 'Complaint surge combined with churn probability',
      description:
        `${input.tenantRisk.complaintsLast90d} complaints in 90 days; churn probability ` +
        `${(input.leasing.churnProbability * 100).toFixed(0)}%. Reactive response loses the tenant.`,
      sourceModules: ['tenant-risk', 'leasing'],
      confidence: 0.8,
      actionable: true,
      suggestedAction:
        'Proactive call from manager; root-cause fix; document resolution for lease renewal.',
    });
  }

  return insights;
}

function formatCents(cents: number): string {
  return `${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
