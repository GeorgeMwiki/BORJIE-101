/**
 * Portfolio Early Warning — scans an owner's site portfolio for
 * early-warning signals.
 *
 * Translates LitFin's loan-portfolio early warning to site portfolios:
 * - rising outstanding royalties
 * - maintenance cost spike
 * - production dip
 * - compliance breach risk
 * - available-capacity waterfall
 * - buyer churn probability
 *
 * Output is a structured health-check the dashboard consumes directly.
 *
 * @module intelligence-orchestrator/portfolio-early-warning
 */

import type {
  PaymentsSnapshot,
  MaintenanceSnapshot,
  ComplianceSnapshot,
  OfftakeSnapshot,
  ProductionSnapshot,
} from './types.js';

export type PortfolioAlertCategory =
  | 'arrears_rising'
  | 'maintenance_cost_spike'
  | 'production_dip'
  | 'compliance_breach_risk'
  | 'available_capacity_waterfall'
  | 'buyer_churn_elevated';

export interface PortfolioAlert {
  readonly id: string;
  readonly category: PortfolioAlertCategory;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly title: string;
  readonly description: string;
  readonly metrics: Record<string, number>;
  readonly suggestedAction: string;
}

export interface PortfolioMetrics {
  readonly siteCount: number;
  readonly totalPits: number;
  readonly activePits: number;
  readonly totalArrearsCents: number;
  readonly maintenanceSpendLast90dCents: number;
  readonly maintenanceSpendTrendPct: number;
  readonly openComplianceBreaches: number;
  readonly avgChurnProbability: number;
}

export interface ConcentrationMetric {
  readonly dimension: 'district' | 'block' | 'counterparty_segment';
  readonly bucket: string;
  readonly sharePct: number;
  readonly riskLoad: number;
}

export interface PortfolioHealthCheck {
  readonly portfolioId: string;
  readonly tenantId: string;
  readonly computedAt: string;
  readonly metrics: PortfolioMetrics;
  readonly alerts: readonly PortfolioAlert[];
  readonly concentrations: readonly ConcentrationMetric[];
  readonly overallHealth: 'green' | 'amber' | 'red';
}

export interface EarlyWarningConfig {
  readonly arrearsTotalRedCents: number;
  readonly maintenanceSpikePctRed: number;
  readonly productionPctRed: number;
  readonly churnProbabilityRed: number;
  readonly breachCountRed: number;
}

export const DEFAULT_WARNING_CONFIG: EarlyWarningConfig = Object.freeze({
  arrearsTotalRedCents: 100_000_00,
  maintenanceSpikePctRed: 30,
  productionPctRed: 85,
  churnProbabilityRed: 0.5,
  breachCountRed: 1,
});

export interface PortfolioFeed {
  readonly siteCount: number;
  readonly totalPits: number;
  readonly activePits: number;
  readonly siteSnapshots: ReadonlyArray<{
    readonly siteId: string;
    readonly district: string;
    readonly payments: PaymentsSnapshot | null;
    readonly maintenance: MaintenanceSnapshot | null;
    readonly compliance: ComplianceSnapshot | null;
    readonly offtake: OfftakeSnapshot | null;
    readonly production: ProductionSnapshot | null;
  }>;
}

export function runPortfolioHealthCheck(
  portfolioId: string,
  tenantId: string,
  feed: PortfolioFeed,
  config: EarlyWarningConfig = DEFAULT_WARNING_CONFIG,
): PortfolioHealthCheck {
  const metrics = aggregateMetrics(feed);
  const alerts = computeAlerts(metrics, config);
  const concentrations = computeConcentrations(feed);
  const overallHealth = computeOverallHealth(metrics, alerts, config);

  return {
    portfolioId,
    tenantId,
    computedAt: new Date().toISOString(),
    metrics,
    alerts,
    concentrations,
    overallHealth,
  };
}

function aggregateMetrics(feed: PortfolioFeed): PortfolioMetrics {
  let totalArrearsCents = 0;
  let maintenanceSpendLast90dCents = 0;
  let maintSpendPriorCents = 0;
  let openBreaches = 0;
  let churnSum = 0;
  let churnCount = 0;

  for (const snap of feed.siteSnapshots) {
    totalArrearsCents += snap.payments?.arrearsCents ?? 0;
    maintenanceSpendLast90dCents += snap.maintenance?.costLast90dCents ?? 0;
    if (snap.maintenance && snap.maintenance.costMomYoYPct !== 0) {
      const prior =
        snap.maintenance.costLast90dCents /
        (1 + snap.maintenance.costMomYoYPct / 100);
      maintSpendPriorCents += prior;
    }
    openBreaches += snap.compliance?.criticalBreaches ?? 0;
    if (snap.offtake) {
      churnSum += snap.offtake.churnProbability;
      churnCount += 1;
    }
  }

  const trendPct =
    maintSpendPriorCents > 0
      ? ((maintenanceSpendLast90dCents - maintSpendPriorCents) /
          maintSpendPriorCents) *
        100
      : 0;

  return {
    siteCount: feed.siteCount,
    totalPits: feed.totalPits,
    activePits: feed.activePits,
    totalArrearsCents,
    maintenanceSpendLast90dCents,
    maintenanceSpendTrendPct: trendPct,
    openComplianceBreaches: openBreaches,
    avgChurnProbability: churnCount > 0 ? churnSum / churnCount : 0,
  };
}

function computeAlerts(
  m: PortfolioMetrics,
  config: EarlyWarningConfig,
): readonly PortfolioAlert[] {
  const alerts: PortfolioAlert[] = [];
  const ts = Date.now();
  const id = (): string => `pw-${ts}-${Math.random().toString(36).slice(2, 6)}`;

  if (m.totalArrearsCents >= config.arrearsTotalRedCents) {
    alerts.push({
      id: id(),
      category: 'arrears_rising',
      severity: 'high',
      title: 'Portfolio arrears above threshold',
      description: `Total arrears ${(m.totalArrearsCents / 100).toLocaleString()} across ${m.siteCount} site(s).`,
      metrics: { totalArrearsCents: m.totalArrearsCents },
      suggestedAction:
        'Trigger bulk collection campaign; tier sites by risk.',
    });
  }

  if (m.maintenanceSpendTrendPct >= config.maintenanceSpikePctRed) {
    alerts.push({
      id: id(),
      category: 'maintenance_cost_spike',
      severity: 'medium',
      title: 'Maintenance cost spike across portfolio',
      description: `Spend up ${m.maintenanceSpendTrendPct.toFixed(0)}% vs prior period.`,
      metrics: { trendPct: m.maintenanceSpendTrendPct },
      suggestedAction:
        'Audit vendor invoices; identify systemic cost drivers.',
    });
  }

  const productionPct =
    m.totalPits === 0 ? 100 : (m.activePits / m.totalPits) * 100;
  if (productionPct < config.productionPctRed) {
    alerts.push({
      id: id(),
      category: 'production_dip',
      severity: 'high',
      title: `Portfolio production ${productionPct.toFixed(0)}%`,
      description: `${m.totalPits - m.activePits} idle pits.`,
      metrics: { productionPct },
      suggestedAction:
        'Boost marketplace spend on under-performing districts.',
    });
  }

  if (m.openComplianceBreaches >= config.breachCountRed) {
    alerts.push({
      id: id(),
      category: 'compliance_breach_risk',
      severity: 'critical',
      title: `${m.openComplianceBreaches} open compliance breach(es)`,
      description: 'Portfolio-wide compliance exposure.',
      metrics: { breaches: m.openComplianceBreaches },
      suggestedAction: 'Prioritise remediation; brief legal.',
    });
  }

  if (m.avgChurnProbability >= config.churnProbabilityRed) {
    alerts.push({
      id: id(),
      category: 'buyer_churn_elevated',
      severity: 'high',
      title: `Avg churn probability ${(m.avgChurnProbability * 100).toFixed(0)}%`,
      description: 'Retention intervention recommended.',
      metrics: { avgChurn: m.avgChurnProbability },
      suggestedAction:
        'Trigger retention campaigns for at-risk buyer cohorts.',
    });
  }

  return alerts;
}

function computeConcentrations(
  feed: PortfolioFeed,
): readonly ConcentrationMetric[] {
  const byDistrict = new Map<string, { share: number; risk: number }>();
  const total = feed.siteCount || 1;

  for (const snap of feed.siteSnapshots) {
    const entry = byDistrict.get(snap.district) ?? { share: 0, risk: 0 };
    entry.share += 1 / total;
    entry.risk +=
      (snap.payments?.arrearsCents ?? 0) / 1_000_00 +
      (snap.compliance?.criticalBreaches ?? 0) * 5;
    byDistrict.set(snap.district, entry);
  }

  return Array.from(byDistrict.entries()).map(([bucket, v]) => ({
    dimension: 'district' as const,
    bucket,
    sharePct: v.share * 100,
    riskLoad: v.risk,
  }));
}

function computeOverallHealth(
  m: PortfolioMetrics,
  alerts: readonly PortfolioAlert[],
  config: EarlyWarningConfig,
): 'green' | 'amber' | 'red' {
  const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
  const highCount = alerts.filter((a) => a.severity === 'high').length;
  if (criticalCount > 0) return 'red';
  if (highCount >= 2) return 'red';
  if (highCount >= 1) return 'amber';
  if (m.maintenanceSpendTrendPct >= config.maintenanceSpikePctRed / 2) {
    return 'amber';
  }
  return 'green';
}

export function formatAlertsForStorage(
  alerts: readonly PortfolioAlert[],
): readonly Record<string, unknown>[] {
  return alerts.map((a) => ({
    id: a.id,
    category: a.category,
    severity: a.severity,
    title: a.title,
    description: a.description,
    metrics: a.metrics,
    suggested_action: a.suggestedAction,
  }));
}
