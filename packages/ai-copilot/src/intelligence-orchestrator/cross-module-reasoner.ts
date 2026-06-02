/**
 * Cross-Module Reasoner — Borjie estate edition.
 *
 * Joins facts across maintenance, payments, compliance, offtake, inspection,
 * FAR, counterparty-risk, production to surface composite risks that no single
 * module can detect alone.
 *
 * Example: "pit 4B arrears climbing" → reasoner sees (arrears rising 30d)
 * + (3 open pumping cases in 60d) + (price 15% above market) → produces
 * "counterparty likely dissatisfied, churn probability elevated".
 *
 * @module intelligence-orchestrator/cross-module-reasoner
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  OfftakeSnapshot,
  InspectionSnapshot,
  FARSnapshot,
  CounterpartyRiskSnapshot,
  ProductionSnapshot,
  CrossModuleInsight,
} from './types.js';

export interface ReasoningInput {
  readonly payments: PaymentsSnapshot | null;
  readonly maintenance: MaintenanceSnapshot | null;
  readonly compliance: ComplianceSnapshot | null;
  readonly offtake: OfftakeSnapshot | null;
  readonly inspection: InspectionSnapshot | null;
  readonly far: FARSnapshot | null;
  readonly counterpartyRisk: CounterpartyRiskSnapshot | null;
  readonly production: ProductionSnapshot | null;
}

export function generateCrossModuleInsights(
  input: ReasoningInput,
): readonly CrossModuleInsight[] {
  const insights: CrossModuleInsight[] = [];
  const ts = Date.now();
  const nextId = (): string =>
    `cmi-${ts}-${Math.random().toString(36).slice(2, 8)}`;

  // Rule 1: Arrears rising AND maintenance cost spike → counterparty dissatisfaction
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
        `The combination suggests counterparty dissatisfaction or an asset-quality issue the counterparty is paying for via reduced compliance.`,
      sourceModules: ['payments', 'maintenance'],
      confidence: 0.8,
      actionable: true,
      suggestedAction:
        'Schedule a counterparty conversation; inspect the pit; propose a joint maintenance/payment plan.',
    });
  }

  // Rule 2: Production dip AND elevated churn probability
  if (
    input.offtake &&
    input.production &&
    input.offtake.churnProbability > 0.6 &&
    input.production.productionPct < 85
  ) {
    insights.push({
      id: nextId(),
      type: 'production_dip_with_buyer_churn',
      severity: 'high',
      title: 'Production below 85% with elevated churn probability',
      description:
        `Production is ${input.production.productionPct.toFixed(0)}% and churn probability is ` +
        `${(input.offtake.churnProbability * 100).toFixed(0)}%. Without intervention, ` +
        `available capacity will worsen as upcoming offtake-ends do not renew.`,
      sourceModules: ['offtake', 'production'],
      confidence: 0.75,
      actionable: true,
      suggestedAction:
        'Trigger retention campaign: targeted renewal offers, mid-offtake satisfaction check-ins.',
    });
  }

  // Rule 3: Compliance breach on high-risk counterparty
  if (
    input.compliance &&
    input.counterpartyRisk &&
    input.compliance.criticalBreaches > 0 &&
    (input.counterpartyRisk.riskGrade === 'D' || input.counterpartyRisk.riskGrade === 'E')
  ) {
    insights.push({
      id: nextId(),
      type: 'compliance_breach_on_high_risk_counterparty',
      severity: 'critical',
      title: 'Compliance breach on a high-risk counterparty',
      description:
        `${input.compliance.criticalBreaches} critical compliance breach(es) affect a ` +
        `grade-${input.counterpartyRisk.riskGrade} counterparty (risk score ${input.counterpartyRisk.riskScore}/100). ` +
        `Regulatory exposure compounds with dispute likelihood.`,
      sourceModules: ['compliance', 'counterparty-risk'],
      confidence: 0.85,
      actionable: true,
      suggestedAction:
        'Prioritise breach remediation; pre-notify legal; capture evidence chain for any counterparty dispute.',
    });
  }

  // Rule 4: Repeat maintenance AND price already above market
  if (
    input.maintenance &&
    input.offtake &&
    input.maintenance.repeatCaseRate > 0.3 &&
    input.offtake.avgPriceVsMarketPct > 10
  ) {
    insights.push({
      id: nextId(),
      type: 'repeat_maintenance_with_price_concession',
      severity: 'medium',
      title: 'High repeat-maintenance while price is above market',
      description:
        `Repeat-case rate ${(input.maintenance.repeatCaseRate * 100).toFixed(0)}% ` +
        `with price ${input.offtake.avgPriceVsMarketPct.toFixed(0)}% above market. ` +
        `Buyers paying a premium will not tolerate chronic issues; churn will rise.`,
      sourceModules: ['maintenance', 'offtake'],
      confidence: 0.7,
      actionable: true,
      suggestedAction:
        'Fix root-cause on recurring categories; consider temporary price concession during remediation.',
    });
  }

  // Rule 5: Offtake ending soon AND open compliance items
  if (
    input.offtake &&
    input.compliance &&
    input.offtake.offtakeEndWithin60d > 0 &&
    input.compliance.overdueItems > 0
  ) {
    insights.push({
      id: nextId(),
      type: 'offtake_end_with_open_compliance',
      severity: 'medium',
      title: 'Offtake ending with overdue compliance items',
      description:
        `${input.offtake.offtakeEndWithin60d} offtake(s) end in the next 60 days while ` +
        `${input.compliance.overdueItems} compliance item(s) are overdue. Offboarding disputes become ` +
        `inevitable if pits are handed over with unresolved compliance.`,
      sourceModules: ['offtake', 'compliance'],
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
        `Unresolved fail-items surface later as counterparty complaints and compliance breaches.`,
      sourceModules: ['inspection', 'maintenance'],
      confidence: 0.85,
      actionable: true,
      suggestedAction:
        'Auto-create maintenance cases from each failed inspection item.',
    });
  }

  // Rule 8: Complaint surge with churn risk
  if (
    input.counterpartyRisk &&
    input.offtake &&
    input.counterpartyRisk.complaintsLast90d > 2 &&
    input.offtake.churnProbability > 0.5
  ) {
    insights.push({
      id: nextId(),
      type: 'counterparty_complaint_surge_with_churn_risk',
      severity: 'high',
      title: 'Complaint surge combined with churn probability',
      description:
        `${input.counterpartyRisk.complaintsLast90d} complaints in 90 days; churn probability ` +
        `${(input.offtake.churnProbability * 100).toFixed(0)}%. Reactive response loses the counterparty.`,
      sourceModules: ['counterparty-risk', 'offtake'],
      confidence: 0.8,
      actionable: true,
      suggestedAction:
        'Proactive call from manager; root-cause fix; document resolution for offtake renewal.',
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
