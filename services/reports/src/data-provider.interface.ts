/**
 * Data provider interface for report generation
 * Implement this to fetch data from your domain/database
 */

import type { FinancialReportData } from './reports/financial-report.js';
import type { AssetUtilisationReportData } from './reports/asset-utilisation-report.js';
import type { MaintenanceReportData } from './reports/maintenance-report.js';
import type { BuyerReportData } from './reports/buyer-report.js';
import type { SiteReportData } from './reports/site-report.js';
import type { ReportParams } from './reports/report-types.js';

export interface IReportDataProvider {
  getFinancialData(
    tenantId: string,
    params: ReportParams
  ): Promise<FinancialReportData>;

  getAssetUtilisationData(
    tenantId: string,
    params: ReportParams
  ): Promise<AssetUtilisationReportData>;

  getMaintenanceData(
    tenantId: string,
    params: ReportParams
  ): Promise<MaintenanceReportData>;

  getBuyerData(tenantId: string, params: ReportParams): Promise<BuyerReportData>;

  getSiteData(
    tenantId: string,
    params: ReportParams
  ): Promise<SiteReportData>;
}

/**
 * Mock data provider for testing - returns empty/default data
 */
export class MockReportDataProvider implements IReportDataProvider {
  private defaultDateRange() {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now),
    };
  }

  async getFinancialData(
    _tenantId: string,
    params: ReportParams
  ): Promise<FinancialReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      royaltyRoll: {
        units: [],
        totalUnits: 0,
        producingUnits: 0,
        totalMonthlyRoyalty: 0,
      },
      incomeStatement: {
        revenue: 0,
        expenses: 0,
        netOperatingIncome: 0,
        breakdown: [],
      },
      cashFlow: {
        openingBalance: 0,
        closingBalance: 0,
        items: [],
      },
      dateRange,
      period: params.period ?? 'monthly',
    };
  }

  async getAssetUtilisationData(
    _tenantId: string,
    params: ReportParams
  ): Promise<AssetUtilisationReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      totalUnits: 0,
      producingUnits: 0,
      idleUnits: 0,
      assetUtilisationRate: 0,
      bySite: [],
      idleCapacity: [],
    };
  }

  async getMaintenanceData(
    _tenantId: string,
    params: ReportParams
  ): Promise<MaintenanceReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      totalWorkOrders: 0,
      completed: 0,
      open: 0,
      totalCost: 0,
      slaComplianceRate: 0,
      avgResolutionDays: 0,
      byCategory: [],
      workOrders: [],
    };
  }

  async getBuyerData(
    _tenantId: string,
    params: ReportParams
  ): Promise<BuyerReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      totalBuyers: 0,
      buyers: [],
      outstanding: [],
      supplyExpiries: [],
      totalOutstanding: 0,
    };
  }

  async getSiteData(
    _tenantId: string,
    params: ReportParams
  ): Promise<SiteReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      sites: [],
      portfolioTotal: {
        totalUnits: 0,
        producingUnits: 0,
        assetUtilisationRate: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        netOperatingIncome: 0,
        avgCollectionRate: 0,
      },
    };
  }
}
