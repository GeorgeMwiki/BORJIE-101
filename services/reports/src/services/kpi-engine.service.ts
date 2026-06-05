/**
 * KPI Calculation Engine
 * 
 * Provides comprehensive Key Performance Indicator calculations
 * for mining-estate operations.
 */

import type { TenantId, SiteId } from '../types/index.js';
import { logger } from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface KPIPeriod {
  start: Date;
  end: Date;
  label: string; // e.g., "2024-Q1", "2024-03", "2024"
}

export interface KPIValue {
  current: number;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
  trend: 'up' | 'down' | 'stable' | 'unknown';
  target?: number;
  targetVariance?: number;
}

export interface FinancialKPIs {
  grossPotentialRoyalty: KPIValue;
  effectiveGrossIncome: KPIValue;
  totalRevenue: KPIValue;
  totalExpenses: KPIValue;
  operatingExpenses: KPIValue;
  netOperatingIncome: KPIValue;
  operatingExpenseRatio: KPIValue;
  debtServiceCoverageRatio: KPIValue | null;
  capitalExpenditures: KPIValue;
  revenuePerUnit: KPIValue;
  expensePerUnit: KPIValue;
}

export interface CollectionKPIs {
  collectionRate: KPIValue;
  totalBilled: KPIValue;
  totalCollected: KPIValue;
  totalOutstanding: KPIValue;
  outstandingRate: KPIValue;
  avgDaysToCollect: KPIValue;
  badDebtWriteoff: KPIValue;
  agingBuckets: {
    current: number;
    thirtyDays: number;
    sixtyDays: number;
    ninetyDays: number;
    overNinetyDays: number;
  };
}

export interface AssetUtilisationKPIs {
  physicalUtilisation: KPIValue;
  economicUtilisation: KPIValue;
  totalUnits: number;
  producingUnits: number;
  idleUnits: number;
  turnoverRate: KPIValue;
  avgIdleDays: KPIValue;
  newAgreements: KPIValue;
  renewals: KPIValue;
  offboardings: KPIValue;
  renewalRate: KPIValue;
  avgAgreementLength: number; // months
}

export interface MaintenanceKPIs {
  totalWorkOrders: KPIValue;
  completedWorkOrders: KPIValue;
  openWorkOrders: number;
  avgResponseTime: KPIValue; // hours
  avgResolutionTime: KPIValue; // hours
  slaComplianceRate: KPIValue;
  firstTimeFixRate: KPIValue;
  reopenRate: KPIValue;
  preventiveRatio: KPIValue;
  emergencyRatio: KPIValue;
  avgCostPerWorkOrder: KPIValue;
  totalMaintenanceCost: KPIValue;
  costPerUnit: KPIValue;
  customerSatisfactionScore: KPIValue;
}

export interface BuyerSatisfactionKPIs {
  overallSatisfaction: KPIValue;
  nps: KPIValue; // Net Promoter Score
  responseRate: KPIValue;
  maintenanceSatisfaction: KPIValue;
  communicationSatisfaction: KPIValue;
  valueForMoneySatisfaction: KPIValue;
  churnRiskScore: KPIValue; // AI-generated
  predictedChurn: number; // count
}

export interface VendorPerformanceKPIs {
  avgVendorRating: KPIValue;
  avgResponseTime: KPIValue;
  avgCompletionTime: KPIValue;
  slaComplianceRate: KPIValue;
  reopenRate: KPIValue;
  topPerformers: Array<{
    vendorId: string;
    vendorName: string;
    score: number;
    completedJobs: number;
  }>;
  underperformers: Array<{
    vendorId: string;
    vendorName: string;
    score: number;
    issues: string[];
  }>;
}

export interface PortfolioSummaryKPIs {
  period: KPIPeriod;
  tenantId: TenantId;
  financial: FinancialKPIs;
  collection: CollectionKPIs;
  assetUtilisation: AssetUtilisationKPIs;
  maintenance: MaintenanceKPIs;
  satisfaction: BuyerSatisfactionKPIs;
  vendor: VendorPerformanceKPIs;
  healthScore: KPIValue; // 0-100
}

export interface SiteKPIsDetail {
  siteId: SiteId;
  siteName: string;
  period: KPIPeriod;
  financial: FinancialKPIs;
  collection: CollectionKPIs;
  assetUtilisation: AssetUtilisationKPIs;
  maintenance: MaintenanceKPIs;
  healthScore: number;
  ranking: number; // among portfolio
}

export interface KPIBenchmark {
  kpiName: string;
  industryAvg: number;
  topQuartile: number;
  bottomQuartile: number;
  yourValue: number;
  percentile: number;
}

export interface KPIAlert {
  id: string;
  kpiName: string;
  currentValue: number;
  threshold: number;
  thresholdType: 'above' | 'below';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  siteId?: SiteId;
  createdAt: Date;
}

// ============================================================================
// Data Provider Interface
// ============================================================================

export interface IKPIDataProvider {
  getFinancialData(tenantId: TenantId, period: KPIPeriod, siteIds?: SiteId[]): Promise<RawFinancialData>;
  getCollectionData(tenantId: TenantId, period: KPIPeriod, siteIds?: SiteId[]): Promise<RawCollectionData>;
  getAssetUtilisationData(tenantId: TenantId, period: KPIPeriod, siteIds?: SiteId[]): Promise<RawAssetUtilisationData>;
  getMaintenanceData(tenantId: TenantId, period: KPIPeriod, siteIds?: SiteId[]): Promise<RawMaintenanceData>;
  getSatisfactionData(tenantId: TenantId, period: KPIPeriod): Promise<RawSatisfactionData>;
  getVendorData(tenantId: TenantId, period: KPIPeriod): Promise<RawVendorData>;
  getSiteList(tenantId: TenantId): Promise<Array<{ id: SiteId; name: string; units: number }>>;
}

export interface RawFinancialData {
  current: {
    grossPotentialRoyalty: number;
    idleCapacity: number;
    concessions: number;
    badDebt: number;
    otherIncome: number;
    operatingExpenses: number;
    capitalExpenditures: number;
    debtService?: number;
  };
  previous: {
    grossPotentialRoyalty: number;
    idleCapacity: number;
    concessions: number;
    badDebt: number;
    otherIncome: number;
    operatingExpenses: number;
    capitalExpenditures: number;
    debtService?: number;
  } | null;
  totalUnits: number;
  targets?: {
    noi: number;
    expenseRatio: number;
  };
}

export interface RawCollectionData {
  current: {
    totalBilled: number;
    totalCollected: number;
    outstanding: number;
    badDebtWriteoff: number;
    avgDaysToCollect: number;
    agingBuckets: {
      current: number;
      thirtyDays: number;
      sixtyDays: number;
      ninetyDays: number;
      overNinetyDays: number;
    };
  };
  previous: {
    totalBilled: number;
    totalCollected: number;
    outstanding: number;
    badDebtWriteoff: number;
    avgDaysToCollect: number;
  } | null;
  targets?: {
    collectionRate: number;
    outstandingRate: number;
  };
}

export interface RawAssetUtilisationData {
  current: {
    totalUnits: number;
    producingUnits: number;
    newAgreements: number;
    renewals: number;
    offboardings: number;
    avgIdleDays: number;
    avgAgreementLengthMonths: number;
    economicUtilisationRate: number;
  };
  previous: {
    totalUnits: number;
    producingUnits: number;
    newAgreements: number;
    renewals: number;
    offboardings: number;
    avgIdleDays: number;
  } | null;
  targets?: {
    utilisationRate: number;
    renewalRate: number;
  };
}

export interface RawMaintenanceData {
  current: {
    totalWorkOrders: number;
    completedWorkOrders: number;
    openWorkOrders: number;
    avgResponseTimeHours: number;
    avgResolutionTimeHours: number;
    slaCompliant: number;
    firstTimeFixes: number;
    reopened: number;
    preventive: number;
    emergency: number;
    totalCost: number;
    avgSatisfaction: number;
  };
  previous: {
    totalWorkOrders: number;
    completedWorkOrders: number;
    avgResponseTimeHours: number;
    avgResolutionTimeHours: number;
    slaCompliant: number;
    totalCost: number;
    avgSatisfaction: number;
  } | null;
  totalUnits: number;
  targets?: {
    slaCompliance: number;
    firstTimeFixRate: number;
    avgResponseTime: number;
  };
}

export interface RawSatisfactionData {
  current: {
    overallScore: number;
    nps: number;
    responseRate: number;
    maintenanceScore: number;
    communicationScore: number;
    valueScore: number;
    churnRiskScore: number;
    predictedChurn: number;
  };
  previous: {
    overallScore: number;
    nps: number;
    responseRate: number;
    maintenanceScore: number;
    communicationScore: number;
    valueScore: number;
    churnRiskScore: number;
  } | null;
  targets?: {
    overallSatisfaction: number;
    nps: number;
  };
}

export interface RawVendorData {
  avgRating: number;
  avgResponseTimeHours: number;
  avgCompletionTimeHours: number;
  slaComplianceRate: number;
  reopenRate: number;
  previousAvgRating: number | null;
  previousSlaComplianceRate: number | null;
  topPerformers: Array<{
    vendorId: string;
    vendorName: string;
    score: number;
    completedJobs: number;
  }>;
  underperformers: Array<{
    vendorId: string;
    vendorName: string;
    score: number;
    issues: string[];
  }>;
}

// ============================================================================
// KPI Engine Implementation
// ============================================================================

export class KPIEngine {
  constructor(private readonly dataProvider: IKPIDataProvider) {}

  /**
   * Calculate all portfolio-level KPIs
   */
  async calculatePortfolioKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    siteIds?: SiteId[]
  ): Promise<PortfolioSummaryKPIs> {
    const [financial, collection, assetUtilisation, maintenance, satisfaction, vendor] = await Promise.all([
      this.calculateFinancialKPIs(tenantId, period, siteIds),
      this.calculateCollectionKPIs(tenantId, period, siteIds),
      this.calculateAssetUtilisationKPIs(tenantId, period, siteIds),
      this.calculateMaintenanceKPIs(tenantId, period, siteIds),
      this.calculateSatisfactionKPIs(tenantId, period),
      this.calculateVendorKPIs(tenantId, period),
    ]);

    // Calculate overall health score (weighted average of key metrics)
    const healthScore = this.calculateHealthScore({
      utilisationRate: assetUtilisation.physicalUtilisation.current,
      collectionRate: collection.collectionRate.current,
      slaCompliance: maintenance.slaComplianceRate.current,
      satisfaction: satisfaction.overallSatisfaction.current,
    });

    return {
      period,
      tenantId,
      financial,
      collection,
      assetUtilisation,
      maintenance,
      satisfaction,
      vendor,
      healthScore,
    };
  }

  /**
   * Calculate site-level KPIs with ranking
   */
  async calculateSiteKPIs(
    tenantId: TenantId,
    siteId: SiteId,
    period: KPIPeriod
  ): Promise<SiteKPIsDetail> {
    const sites = await this.dataProvider.getSiteList(tenantId);
    const site = sites.find((p) => p.id === siteId);
    if (!site) {
      throw new Error(`Site ${siteId} not found`);
    }

    const [financial, collection, assetUtilisation, maintenance] = await Promise.all([
      this.calculateFinancialKPIs(tenantId, period, [siteId]),
      this.calculateCollectionKPIs(tenantId, period, [siteId]),
      this.calculateAssetUtilisationKPIs(tenantId, period, [siteId]),
      this.calculateMaintenanceKPIs(tenantId, period, [siteId]),
    ]);

    const healthScore = this.calculateHealthScore({
      utilisationRate: assetUtilisation.physicalUtilisation.current,
      collectionRate: collection.collectionRate.current,
      slaCompliance: maintenance.slaComplianceRate.current,
      satisfaction: 80, // Placeholder
    }).current;

    // Calculate ranking among all sites
    const allSiteScores = await this.calculateAllSiteHealthScores(tenantId, period);
    const sortedScores = [...allSiteScores].sort((a, b) => b.score - a.score);
    const ranking = sortedScores.findIndex((p) => p.siteId === siteId) + 1;

    return {
      siteId,
      siteName: site.name,
      period,
      financial,
      collection,
      assetUtilisation,
      maintenance,
      healthScore,
      ranking,
    };
  }

  /**
   * Get KPI alerts based on thresholds
   */
  async getKPIAlerts(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<KPIAlert[]> {
    const kpis = await this.calculatePortfolioKPIs(tenantId, period);
    const alerts: KPIAlert[] = [];

    // Check asset utilisation
    if (kpis.assetUtilisation.physicalUtilisation.current < 85) {
      alerts.push({
        id: `alert-occ-${Date.now()}`,
        kpiName: 'Physical Asset Utilisation',
        currentValue: kpis.assetUtilisation.physicalUtilisation.current,
        threshold: 85,
        thresholdType: 'below',
        severity: kpis.assetUtilisation.physicalUtilisation.current < 75 ? 'critical' : 'warning',
        message: `Physical asset utilisation (${kpis.assetUtilisation.physicalUtilisation.current.toFixed(1)}%) is below target`,
        createdAt: new Date(),
      });
    }

    // Check collection rate
    if (kpis.collection.collectionRate.current < 90) {
      alerts.push({
        id: `alert-col-${Date.now()}`,
        kpiName: 'Collection Rate',
        currentValue: kpis.collection.collectionRate.current,
        threshold: 90,
        thresholdType: 'below',
        severity: kpis.collection.collectionRate.current < 80 ? 'critical' : 'warning',
        message: `Collection rate (${kpis.collection.collectionRate.current.toFixed(1)}%) needs attention`,
        createdAt: new Date(),
      });
    }

    // Check SLA compliance
    if (kpis.maintenance.slaComplianceRate.current < 85) {
      alerts.push({
        id: `alert-sla-${Date.now()}`,
        kpiName: 'SLA Compliance',
        currentValue: kpis.maintenance.slaComplianceRate.current,
        threshold: 85,
        thresholdType: 'below',
        severity: 'warning',
        message: `Maintenance SLA compliance (${kpis.maintenance.slaComplianceRate.current.toFixed(1)}%) is below target`,
        createdAt: new Date(),
      });
    }

    // Check satisfaction
    if (kpis.satisfaction.overallSatisfaction.current < 3.5) {
      alerts.push({
        id: `alert-sat-${Date.now()}`,
        kpiName: 'Customer Satisfaction',
        currentValue: kpis.satisfaction.overallSatisfaction.current,
        threshold: 3.5,
        thresholdType: 'below',
        severity: kpis.satisfaction.overallSatisfaction.current < 3 ? 'critical' : 'warning',
        message: `Customer satisfaction (${kpis.satisfaction.overallSatisfaction.current.toFixed(1)}) needs improvement`,
        createdAt: new Date(),
      });
    }

    // Check churn risk
    if (kpis.satisfaction.predictedChurn > 5) {
      alerts.push({
        id: `alert-churn-${Date.now()}`,
        kpiName: 'Predicted Churn',
        currentValue: kpis.satisfaction.predictedChurn,
        threshold: 5,
        thresholdType: 'above',
        severity: kpis.satisfaction.predictedChurn > 10 ? 'critical' : 'warning',
        message: `${kpis.satisfaction.predictedChurn} tenants at high churn risk`,
        createdAt: new Date(),
      });
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Get benchmark comparisons
   */
  async getBenchmarks(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<KPIBenchmark[]> {
    const kpis = await this.calculatePortfolioKPIs(tenantId, period);

    // Industry benchmarks (in production, these would come from a benchmark database)
    return [
      {
        kpiName: 'Physical Asset Utilisation',
        industryAvg: 92,
        topQuartile: 96,
        bottomQuartile: 85,
        yourValue: kpis.assetUtilisation.physicalUtilisation.current,
        percentile: this.calculatePercentile(kpis.assetUtilisation.physicalUtilisation.current, 85, 96),
      },
      {
        kpiName: 'Collection Rate',
        industryAvg: 95,
        topQuartile: 98,
        bottomQuartile: 88,
        yourValue: kpis.collection.collectionRate.current,
        percentile: this.calculatePercentile(kpis.collection.collectionRate.current, 88, 98),
      },
      {
        kpiName: 'Operating Expense Ratio',
        industryAvg: 45,
        topQuartile: 38,
        bottomQuartile: 55,
        yourValue: kpis.financial.operatingExpenseRatio.current,
        percentile: this.calculatePercentile(55 - kpis.financial.operatingExpenseRatio.current, 0, 17), // Lower is better
      },
      {
        kpiName: 'SLA Compliance',
        industryAvg: 88,
        topQuartile: 95,
        bottomQuartile: 78,
        yourValue: kpis.maintenance.slaComplianceRate.current,
        percentile: this.calculatePercentile(kpis.maintenance.slaComplianceRate.current, 78, 95),
      },
      {
        kpiName: 'Customer Satisfaction',
        industryAvg: 3.8,
        topQuartile: 4.3,
        bottomQuartile: 3.2,
        yourValue: kpis.satisfaction.overallSatisfaction.current,
        percentile: this.calculatePercentile(kpis.satisfaction.overallSatisfaction.current, 3.2, 4.3),
      },
    ];
  }

  // ============================================================================
  // Private Calculation Methods
  // ============================================================================

  private async calculateFinancialKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    siteIds?: SiteId[]
  ): Promise<FinancialKPIs> {
    const data = await this.dataProvider.getFinancialData(tenantId, period, siteIds);
    const c = data.current;
    const p = data.previous;

    const effectiveGrossIncome = c.grossPotentialRoyalty - c.idleCapacity - c.concessions - c.badDebt + c.otherIncome;
    const totalExpenses = c.operatingExpenses + c.capitalExpenditures;
    const noi = effectiveGrossIncome - c.operatingExpenses;
    const prevNoi = p ? (p.grossPotentialRoyalty - p.idleCapacity - p.concessions - p.badDebt + p.otherIncome - p.operatingExpenses) : null;

    return {
      grossPotentialRoyalty: this.createKPIValue(c.grossPotentialRoyalty, p?.grossPotentialRoyalty ?? null),
      effectiveGrossIncome: this.createKPIValue(effectiveGrossIncome, p ? (p.grossPotentialRoyalty - p.idleCapacity - p.concessions - p.badDebt + p.otherIncome) : null),
      totalRevenue: this.createKPIValue(effectiveGrossIncome, p ? (p.grossPotentialRoyalty - p.idleCapacity - p.concessions - p.badDebt + p.otherIncome) : null),
      totalExpenses: this.createKPIValue(totalExpenses, p ? (p.operatingExpenses + p.capitalExpenditures) : null),
      operatingExpenses: this.createKPIValue(c.operatingExpenses, p?.operatingExpenses ?? null),
      netOperatingIncome: this.createKPIValue(noi, prevNoi, data.targets?.noi),
      operatingExpenseRatio: this.createKPIValue(
        effectiveGrossIncome > 0 ? (c.operatingExpenses / effectiveGrossIncome) * 100 : 0,
        p ? ((p.operatingExpenses / (p.grossPotentialRoyalty - p.idleCapacity + p.otherIncome)) * 100) : null,
        data.targets?.expenseRatio
      ),
      debtServiceCoverageRatio: c.debtService ? this.createKPIValue(
        c.debtService > 0 ? noi / c.debtService : 0,
        p?.debtService ? (prevNoi ?? 0) / p.debtService : null
      ) : null,
      capitalExpenditures: this.createKPIValue(c.capitalExpenditures, p?.capitalExpenditures ?? null),
      revenuePerUnit: this.createKPIValue(
        data.totalUnits > 0 ? effectiveGrossIncome / data.totalUnits : 0,
        null
      ),
      expensePerUnit: this.createKPIValue(
        data.totalUnits > 0 ? totalExpenses / data.totalUnits : 0,
        null
      ),
    };
  }

  private async calculateCollectionKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    siteIds?: SiteId[]
  ): Promise<CollectionKPIs> {
    const data = await this.dataProvider.getCollectionData(tenantId, period, siteIds);
    const c = data.current;
    const p = data.previous;

    const collectionRate = c.totalBilled > 0 ? (c.totalCollected / c.totalBilled) * 100 : 0;
    const prevCollectionRate = p && p.totalBilled > 0 ? (p.totalCollected / p.totalBilled) * 100 : null;
    const outstandingRate = c.totalBilled > 0 ? (c.outstanding / c.totalBilled) * 100 : 0;

    return {
      collectionRate: this.createKPIValue(collectionRate, prevCollectionRate, data.targets?.collectionRate),
      totalBilled: this.createKPIValue(c.totalBilled, p?.totalBilled ?? null),
      totalCollected: this.createKPIValue(c.totalCollected, p?.totalCollected ?? null),
      totalOutstanding: this.createKPIValue(c.outstanding, p?.outstanding ?? null),
      outstandingRate: this.createKPIValue(outstandingRate, p ? (p.outstanding / p.totalBilled) * 100 : null, data.targets?.outstandingRate),
      avgDaysToCollect: this.createKPIValue(c.avgDaysToCollect, p?.avgDaysToCollect ?? null),
      badDebtWriteoff: this.createKPIValue(c.badDebtWriteoff, p?.badDebtWriteoff ?? null),
      agingBuckets: c.agingBuckets,
    };
  }

  private async calculateAssetUtilisationKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    siteIds?: SiteId[]
  ): Promise<AssetUtilisationKPIs> {
    const data = await this.dataProvider.getAssetUtilisationData(tenantId, period, siteIds);
    const c = data.current;
    const p = data.previous;

    const physicalUtilisation = c.totalUnits > 0 ? (c.producingUnits / c.totalUnits) * 100 : 0;
    const prevPhysicalUtilisation = p && p.totalUnits > 0 ? (p.producingUnits / p.totalUnits) * 100 : null;
    const turnoverRate = c.totalUnits > 0 ? (c.offboardings / c.totalUnits) * 100 : 0;
    const renewalRate = (c.renewals + c.offboardings) > 0 ? (c.renewals / (c.renewals + c.offboardings)) * 100 : 0;

    return {
      physicalUtilisation: this.createKPIValue(physicalUtilisation, prevPhysicalUtilisation, data.targets?.utilisationRate),
      economicUtilisation: this.createKPIValue(c.economicUtilisationRate, null),
      totalUnits: c.totalUnits,
      producingUnits: c.producingUnits,
      idleUnits: c.totalUnits - c.producingUnits,
      turnoverRate: this.createKPIValue(turnoverRate, p ? (p.offboardings / p.totalUnits) * 100 : null),
      avgIdleDays: this.createKPIValue(c.avgIdleDays, p?.avgIdleDays ?? null),
      newAgreements: this.createKPIValue(c.newAgreements, p?.newAgreements ?? null),
      renewals: this.createKPIValue(c.renewals, p?.renewals ?? null),
      offboardings: this.createKPIValue(c.offboardings, p?.offboardings ?? null),
      renewalRate: this.createKPIValue(renewalRate, null, data.targets?.renewalRate),
      avgAgreementLength: c.avgAgreementLengthMonths,
    };
  }

  private async calculateMaintenanceKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    siteIds?: SiteId[]
  ): Promise<MaintenanceKPIs> {
    const data = await this.dataProvider.getMaintenanceData(tenantId, period, siteIds);
    const c = data.current;
    const p = data.previous;

    const slaComplianceRate = c.completedWorkOrders > 0 ? (c.slaCompliant / c.completedWorkOrders) * 100 : 0;
    const firstTimeFixRate = c.completedWorkOrders > 0 ? (c.firstTimeFixes / c.completedWorkOrders) * 100 : 0;
    const reopenRate = c.completedWorkOrders > 0 ? (c.reopened / c.completedWorkOrders) * 100 : 0;
    const preventiveRatio = c.totalWorkOrders > 0 ? (c.preventive / c.totalWorkOrders) * 100 : 0;
    const emergencyRatio = c.totalWorkOrders > 0 ? (c.emergency / c.totalWorkOrders) * 100 : 0;
    const avgCostPerWorkOrder = c.completedWorkOrders > 0 ? c.totalCost / c.completedWorkOrders : 0;

    return {
      totalWorkOrders: this.createKPIValue(c.totalWorkOrders, p?.totalWorkOrders ?? null),
      completedWorkOrders: this.createKPIValue(c.completedWorkOrders, p?.completedWorkOrders ?? null),
      openWorkOrders: c.openWorkOrders,
      avgResponseTime: this.createKPIValue(c.avgResponseTimeHours, p?.avgResponseTimeHours ?? null, data.targets?.avgResponseTime),
      avgResolutionTime: this.createKPIValue(c.avgResolutionTimeHours, p?.avgResolutionTimeHours ?? null),
      slaComplianceRate: this.createKPIValue(
        slaComplianceRate,
        p ? (p.slaCompliant / p.completedWorkOrders) * 100 : null,
        data.targets?.slaCompliance
      ),
      firstTimeFixRate: this.createKPIValue(firstTimeFixRate, null, data.targets?.firstTimeFixRate),
      reopenRate: this.createKPIValue(reopenRate, null),
      preventiveRatio: this.createKPIValue(preventiveRatio, null),
      emergencyRatio: this.createKPIValue(emergencyRatio, null),
      avgCostPerWorkOrder: this.createKPIValue(avgCostPerWorkOrder, null),
      totalMaintenanceCost: this.createKPIValue(c.totalCost, p?.totalCost ?? null),
      costPerUnit: this.createKPIValue(
        data.totalUnits > 0 ? c.totalCost / data.totalUnits : 0,
        null
      ),
      customerSatisfactionScore: this.createKPIValue(c.avgSatisfaction, p?.avgSatisfaction ?? null),
    };
  }

  private async calculateSatisfactionKPIs(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<BuyerSatisfactionKPIs> {
    const data = await this.dataProvider.getSatisfactionData(tenantId, period);
    const c = data.current;
    const p = data.previous;

    return {
      overallSatisfaction: this.createKPIValue(c.overallScore, p?.overallScore ?? null, data.targets?.overallSatisfaction),
      nps: this.createKPIValue(c.nps, p?.nps ?? null, data.targets?.nps),
      responseRate: this.createKPIValue(c.responseRate, p?.responseRate ?? null),
      maintenanceSatisfaction: this.createKPIValue(c.maintenanceScore, p?.maintenanceScore ?? null),
      communicationSatisfaction: this.createKPIValue(c.communicationScore, p?.communicationScore ?? null),
      valueForMoneySatisfaction: this.createKPIValue(c.valueScore, p?.valueScore ?? null),
      churnRiskScore: this.createKPIValue(c.churnRiskScore, p?.churnRiskScore ?? null),
      predictedChurn: c.predictedChurn,
    };
  }

  private async calculateVendorKPIs(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<VendorPerformanceKPIs> {
    const data = await this.dataProvider.getVendorData(tenantId, period);

    return {
      avgVendorRating: this.createKPIValue(data.avgRating, data.previousAvgRating),
      avgResponseTime: this.createKPIValue(data.avgResponseTimeHours, null),
      avgCompletionTime: this.createKPIValue(data.avgCompletionTimeHours, null),
      slaComplianceRate: this.createKPIValue(data.slaComplianceRate, data.previousSlaComplianceRate),
      reopenRate: this.createKPIValue(data.reopenRate, null),
      topPerformers: data.topPerformers,
      underperformers: data.underperformers,
    };
  }

  private createKPIValue(
    current: number,
    previous: number | null,
    target?: number
  ): KPIValue {
    const change = previous !== null ? current - previous : null;
    const changePercent = previous !== null && previous !== 0 ? ((current - previous) / previous) * 100 : null;
    const trend = change === null ? 'unknown' : change > 0.01 ? 'up' : change < -0.01 ? 'down' : 'stable';
    const targetVariance = target !== undefined ? current - target : undefined;

    return {
      current,
      previous,
      change,
      changePercent,
      trend,
      ...(target !== undefined ? { target } : {}),
      ...(targetVariance !== undefined ? { targetVariance } : {}),
    };
  }

  private calculateHealthScore(metrics: {
    utilisationRate: number;
    collectionRate: number;
    slaCompliance: number;
    satisfaction: number;
  }): KPIValue {
    // Weighted health score calculation
    const weights = {
      utilisation: 0.30,
      collection: 0.30,
      sla: 0.20,
      satisfaction: 0.20,
    };

    // Normalize each metric to 0-100 scale
    const normalizedUtilisation = Math.min(100, metrics.utilisationRate);
    const normalizedCollection = Math.min(100, metrics.collectionRate);
    const normalizedSla = Math.min(100, metrics.slaCompliance);
    const normalizedSatisfaction = (metrics.satisfaction / 5) * 100; // Assuming 5-point scale

    const score =
      normalizedUtilisation * weights.utilisation +
      normalizedCollection * weights.collection +
      normalizedSla * weights.sla +
      normalizedSatisfaction * weights.satisfaction;

    return this.createKPIValue(Math.round(score * 10) / 10, null);
  }

  private calculatePercentile(value: number, bottom: number, top: number): number {
    if (value <= bottom) return 0;
    if (value >= top) return 100;
    return Math.round(((value - bottom) / (top - bottom)) * 100);
  }

  private async calculateAllSiteHealthScores(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<Array<{ siteId: SiteId; score: number }>> {
    const sites = await this.dataProvider.getSiteList(tenantId);
    const scores: Array<{ siteId: SiteId; score: number }> = [];

    for (const site of sites) {
      try {
        const [collection, assetUtilisation, maintenance] = await Promise.all([
          this.calculateCollectionKPIs(tenantId, period, [site.id]),
          this.calculateAssetUtilisationKPIs(tenantId, period, [site.id]),
          this.calculateMaintenanceKPIs(tenantId, period, [site.id]),
        ]);

        const score = this.calculateHealthScore({
          utilisationRate: assetUtilisation.physicalUtilisation.current,
          collectionRate: collection.collectionRate.current,
          slaCompliance: maintenance.slaComplianceRate.current,
          satisfaction: 80, // Placeholder
        }).current;

        scores.push({ siteId: site.id, score });
      } catch (err) {
        // Skip sites with errors; log for observability so silent drops are traceable.
        logger.warn(`[kpi-engine] skipped site ${site.id}`, { value: err instanceof Error ? err.message : String(err) });
      }
    }

    return scores;
  }
}
