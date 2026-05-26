/**
 * KPI Calculation Engine
 * 
 * Provides comprehensive Key Performance Indicator calculations
 * for property management operations.
 */

import type { TenantId, PropertyId } from '../types/index.js';
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
  grossPotentialRent: KPIValue;
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
  arrearsRate: KPIValue;
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

export interface OccupancyKPIs {
  physicalOccupancy: KPIValue;
  economicOccupancy: KPIValue;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  turnoverRate: KPIValue;
  avgVacancyDays: KPIValue;
  newLeases: KPIValue;
  renewals: KPIValue;
  moveOuts: KPIValue;
  renewalRate: KPIValue;
  avgLeaseLength: number; // months
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

export interface TenantSatisfactionKPIs {
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
  occupancy: OccupancyKPIs;
  maintenance: MaintenanceKPIs;
  satisfaction: TenantSatisfactionKPIs;
  vendor: VendorPerformanceKPIs;
  healthScore: KPIValue; // 0-100
}

export interface PropertyKPIsDetail {
  propertyId: PropertyId;
  propertyName: string;
  period: KPIPeriod;
  financial: FinancialKPIs;
  collection: CollectionKPIs;
  occupancy: OccupancyKPIs;
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
  propertyId?: PropertyId;
  createdAt: Date;
}

// ============================================================================
// Data Provider Interface
// ============================================================================

export interface IKPIDataProvider {
  getFinancialData(tenantId: TenantId, period: KPIPeriod, propertyIds?: PropertyId[]): Promise<RawFinancialData>;
  getCollectionData(tenantId: TenantId, period: KPIPeriod, propertyIds?: PropertyId[]): Promise<RawCollectionData>;
  getOccupancyData(tenantId: TenantId, period: KPIPeriod, propertyIds?: PropertyId[]): Promise<RawOccupancyData>;
  getMaintenanceData(tenantId: TenantId, period: KPIPeriod, propertyIds?: PropertyId[]): Promise<RawMaintenanceData>;
  getSatisfactionData(tenantId: TenantId, period: KPIPeriod): Promise<RawSatisfactionData>;
  getVendorData(tenantId: TenantId, period: KPIPeriod): Promise<RawVendorData>;
  getPropertyList(tenantId: TenantId): Promise<Array<{ id: PropertyId; name: string; units: number }>>;
}

export interface RawFinancialData {
  current: {
    grossPotentialRent: number;
    vacancy: number;
    concessions: number;
    badDebt: number;
    otherIncome: number;
    operatingExpenses: number;
    capitalExpenditures: number;
    debtService?: number;
  };
  previous: {
    grossPotentialRent: number;
    vacancy: number;
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
    arrearsRate: number;
  };
}

export interface RawOccupancyData {
  current: {
    totalUnits: number;
    occupiedUnits: number;
    newLeases: number;
    renewals: number;
    moveOuts: number;
    avgVacancyDays: number;
    avgLeaseLengthMonths: number;
    economicOccupancyRate: number;
  };
  previous: {
    totalUnits: number;
    occupiedUnits: number;
    newLeases: number;
    renewals: number;
    moveOuts: number;
    avgVacancyDays: number;
  } | null;
  targets?: {
    occupancyRate: number;
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
    propertyIds?: PropertyId[]
  ): Promise<PortfolioSummaryKPIs> {
    const [financial, collection, occupancy, maintenance, satisfaction, vendor] = await Promise.all([
      this.calculateFinancialKPIs(tenantId, period, propertyIds),
      this.calculateCollectionKPIs(tenantId, period, propertyIds),
      this.calculateOccupancyKPIs(tenantId, period, propertyIds),
      this.calculateMaintenanceKPIs(tenantId, period, propertyIds),
      this.calculateSatisfactionKPIs(tenantId, period),
      this.calculateVendorKPIs(tenantId, period),
    ]);

    // Calculate overall health score (weighted average of key metrics)
    const healthScore = this.calculateHealthScore({
      occupancyRate: occupancy.physicalOccupancy.current,
      collectionRate: collection.collectionRate.current,
      slaCompliance: maintenance.slaComplianceRate.current,
      satisfaction: satisfaction.overallSatisfaction.current,
    });

    return {
      period,
      tenantId,
      financial,
      collection,
      occupancy,
      maintenance,
      satisfaction,
      vendor,
      healthScore,
    };
  }

  /**
   * Calculate property-level KPIs with ranking
   */
  async calculatePropertyKPIs(
    tenantId: TenantId,
    propertyId: PropertyId,
    period: KPIPeriod
  ): Promise<PropertyKPIsDetail> {
    const properties = await this.dataProvider.getPropertyList(tenantId);
    const property = properties.find((p) => p.id === propertyId);
    if (!property) {
      throw new Error(`Property ${propertyId} not found`);
    }

    const [financial, collection, occupancy, maintenance] = await Promise.all([
      this.calculateFinancialKPIs(tenantId, period, [propertyId]),
      this.calculateCollectionKPIs(tenantId, period, [propertyId]),
      this.calculateOccupancyKPIs(tenantId, period, [propertyId]),
      this.calculateMaintenanceKPIs(tenantId, period, [propertyId]),
    ]);

    const healthScore = this.calculateHealthScore({
      occupancyRate: occupancy.physicalOccupancy.current,
      collectionRate: collection.collectionRate.current,
      slaCompliance: maintenance.slaComplianceRate.current,
      satisfaction: 80, // Placeholder
    }).current;

    // Calculate ranking among all properties
    const allPropertyScores = await this.calculateAllPropertyHealthScores(tenantId, period);
    const sortedScores = [...allPropertyScores].sort((a, b) => b.score - a.score);
    const ranking = sortedScores.findIndex((p) => p.propertyId === propertyId) + 1;

    return {
      propertyId,
      propertyName: property.name,
      period,
      financial,
      collection,
      occupancy,
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

    // Check occupancy
    if (kpis.occupancy.physicalOccupancy.current < 85) {
      alerts.push({
        id: `alert-occ-${Date.now()}`,
        kpiName: 'Physical Occupancy',
        currentValue: kpis.occupancy.physicalOccupancy.current,
        threshold: 85,
        thresholdType: 'below',
        severity: kpis.occupancy.physicalOccupancy.current < 75 ? 'critical' : 'warning',
        message: `Physical occupancy (${kpis.occupancy.physicalOccupancy.current.toFixed(1)}%) is below target`,
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
        kpiName: 'Physical Occupancy',
        industryAvg: 92,
        topQuartile: 96,
        bottomQuartile: 85,
        yourValue: kpis.occupancy.physicalOccupancy.current,
        percentile: this.calculatePercentile(kpis.occupancy.physicalOccupancy.current, 85, 96),
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
    propertyIds?: PropertyId[]
  ): Promise<FinancialKPIs> {
    const data = await this.dataProvider.getFinancialData(tenantId, period, propertyIds);
    const c = data.current;
    const p = data.previous;

    const effectiveGrossIncome = c.grossPotentialRent - c.vacancy - c.concessions - c.badDebt + c.otherIncome;
    const totalExpenses = c.operatingExpenses + c.capitalExpenditures;
    const noi = effectiveGrossIncome - c.operatingExpenses;
    const prevNoi = p ? (p.grossPotentialRent - p.vacancy - p.concessions - p.badDebt + p.otherIncome - p.operatingExpenses) : null;

    return {
      grossPotentialRent: this.createKPIValue(c.grossPotentialRent, p?.grossPotentialRent ?? null),
      effectiveGrossIncome: this.createKPIValue(effectiveGrossIncome, p ? (p.grossPotentialRent - p.vacancy - p.concessions - p.badDebt + p.otherIncome) : null),
      totalRevenue: this.createKPIValue(effectiveGrossIncome, p ? (p.grossPotentialRent - p.vacancy - p.concessions - p.badDebt + p.otherIncome) : null),
      totalExpenses: this.createKPIValue(totalExpenses, p ? (p.operatingExpenses + p.capitalExpenditures) : null),
      operatingExpenses: this.createKPIValue(c.operatingExpenses, p?.operatingExpenses ?? null),
      netOperatingIncome: this.createKPIValue(noi, prevNoi, data.targets?.noi),
      operatingExpenseRatio: this.createKPIValue(
        effectiveGrossIncome > 0 ? (c.operatingExpenses / effectiveGrossIncome) * 100 : 0,
        p ? ((p.operatingExpenses / (p.grossPotentialRent - p.vacancy + p.otherIncome)) * 100) : null,
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
    propertyIds?: PropertyId[]
  ): Promise<CollectionKPIs> {
    const data = await this.dataProvider.getCollectionData(tenantId, period, propertyIds);
    const c = data.current;
    const p = data.previous;

    const collectionRate = c.totalBilled > 0 ? (c.totalCollected / c.totalBilled) * 100 : 0;
    const prevCollectionRate = p && p.totalBilled > 0 ? (p.totalCollected / p.totalBilled) * 100 : null;
    const arrearsRate = c.totalBilled > 0 ? (c.outstanding / c.totalBilled) * 100 : 0;

    return {
      collectionRate: this.createKPIValue(collectionRate, prevCollectionRate, data.targets?.collectionRate),
      totalBilled: this.createKPIValue(c.totalBilled, p?.totalBilled ?? null),
      totalCollected: this.createKPIValue(c.totalCollected, p?.totalCollected ?? null),
      totalOutstanding: this.createKPIValue(c.outstanding, p?.outstanding ?? null),
      arrearsRate: this.createKPIValue(arrearsRate, p ? (p.outstanding / p.totalBilled) * 100 : null, data.targets?.arrearsRate),
      avgDaysToCollect: this.createKPIValue(c.avgDaysToCollect, p?.avgDaysToCollect ?? null),
      badDebtWriteoff: this.createKPIValue(c.badDebtWriteoff, p?.badDebtWriteoff ?? null),
      agingBuckets: c.agingBuckets,
    };
  }

  private async calculateOccupancyKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    propertyIds?: PropertyId[]
  ): Promise<OccupancyKPIs> {
    const data = await this.dataProvider.getOccupancyData(tenantId, period, propertyIds);
    const c = data.current;
    const p = data.previous;

    const physicalOccupancy = c.totalUnits > 0 ? (c.occupiedUnits / c.totalUnits) * 100 : 0;
    const prevPhysicalOccupancy = p && p.totalUnits > 0 ? (p.occupiedUnits / p.totalUnits) * 100 : null;
    const turnoverRate = c.totalUnits > 0 ? (c.moveOuts / c.totalUnits) * 100 : 0;
    const renewalRate = (c.renewals + c.moveOuts) > 0 ? (c.renewals / (c.renewals + c.moveOuts)) * 100 : 0;

    return {
      physicalOccupancy: this.createKPIValue(physicalOccupancy, prevPhysicalOccupancy, data.targets?.occupancyRate),
      economicOccupancy: this.createKPIValue(c.economicOccupancyRate, null),
      totalUnits: c.totalUnits,
      occupiedUnits: c.occupiedUnits,
      vacantUnits: c.totalUnits - c.occupiedUnits,
      turnoverRate: this.createKPIValue(turnoverRate, p ? (p.moveOuts / p.totalUnits) * 100 : null),
      avgVacancyDays: this.createKPIValue(c.avgVacancyDays, p?.avgVacancyDays ?? null),
      newLeases: this.createKPIValue(c.newLeases, p?.newLeases ?? null),
      renewals: this.createKPIValue(c.renewals, p?.renewals ?? null),
      moveOuts: this.createKPIValue(c.moveOuts, p?.moveOuts ?? null),
      renewalRate: this.createKPIValue(renewalRate, null, data.targets?.renewalRate),
      avgLeaseLength: c.avgLeaseLengthMonths,
    };
  }

  private async calculateMaintenanceKPIs(
    tenantId: TenantId,
    period: KPIPeriod,
    propertyIds?: PropertyId[]
  ): Promise<MaintenanceKPIs> {
    const data = await this.dataProvider.getMaintenanceData(tenantId, period, propertyIds);
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
  ): Promise<TenantSatisfactionKPIs> {
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
    occupancyRate: number;
    collectionRate: number;
    slaCompliance: number;
    satisfaction: number;
  }): KPIValue {
    // Weighted health score calculation
    const weights = {
      occupancy: 0.30,
      collection: 0.30,
      sla: 0.20,
      satisfaction: 0.20,
    };

    // Normalize each metric to 0-100 scale
    const normalizedOccupancy = Math.min(100, metrics.occupancyRate);
    const normalizedCollection = Math.min(100, metrics.collectionRate);
    const normalizedSla = Math.min(100, metrics.slaCompliance);
    const normalizedSatisfaction = (metrics.satisfaction / 5) * 100; // Assuming 5-point scale

    const score =
      normalizedOccupancy * weights.occupancy +
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

  private async calculateAllPropertyHealthScores(
    tenantId: TenantId,
    period: KPIPeriod
  ): Promise<Array<{ propertyId: PropertyId; score: number }>> {
    const properties = await this.dataProvider.getPropertyList(tenantId);
    const scores: Array<{ propertyId: PropertyId; score: number }> = [];

    for (const property of properties) {
      try {
        const [collection, occupancy, maintenance] = await Promise.all([
          this.calculateCollectionKPIs(tenantId, period, [property.id]),
          this.calculateOccupancyKPIs(tenantId, period, [property.id]),
          this.calculateMaintenanceKPIs(tenantId, period, [property.id]),
        ]);

        const score = this.calculateHealthScore({
          occupancyRate: occupancy.physicalOccupancy.current,
          collectionRate: collection.collectionRate.current,
          slaCompliance: maintenance.slaComplianceRate.current,
          satisfaction: 80, // Placeholder
        }).current;

        scores.push({ propertyId: property.id, score });
      } catch (err) {
        // Skip properties with errors; log for observability so silent drops are traceable.
        logger.warn(`[kpi-engine] skipped property ${property.id}`, { value: err instanceof Error ? err.message : String(err) });
      }
    }

    return scores;
  }
}
