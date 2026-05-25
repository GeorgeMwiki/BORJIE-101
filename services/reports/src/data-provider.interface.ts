/**
 * Data provider interface for report generation
 * Implement this to fetch data from your domain/database
 */

import type { FinancialReportData } from './reports/financial-report.js';
import type { OccupancyReportData } from './reports/occupancy-report.js';
import type { MaintenanceReportData } from './reports/maintenance-report.js';
import type { TenantReportData } from './reports/tenant-report.js';
import type { PropertyReportData } from './reports/property-report.js';
import type { ReportParams } from './reports/report-types.js';

export interface IReportDataProvider {
  getFinancialData(
    tenantId: string,
    params: ReportParams
  ): Promise<FinancialReportData>;

  getOccupancyData(
    tenantId: string,
    params: ReportParams
  ): Promise<OccupancyReportData>;

  getMaintenanceData(
    tenantId: string,
    params: ReportParams
  ): Promise<MaintenanceReportData>;

  getTenantData(tenantId: string, params: ReportParams): Promise<TenantReportData>;

  getPropertyData(
    tenantId: string,
    params: ReportParams
  ): Promise<PropertyReportData>;
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
      rentRoll: {
        units: [],
        totalUnits: 0,
        occupiedUnits: 0,
        totalMonthlyRent: 0,
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

  async getOccupancyData(
    _tenantId: string,
    params: ReportParams
  ): Promise<OccupancyReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      totalUnits: 0,
      occupiedUnits: 0,
      vacantUnits: 0,
      occupancyRate: 0,
      byProperty: [],
      vacancies: [],
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

  async getTenantData(
    _tenantId: string,
    params: ReportParams
  ): Promise<TenantReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      totalTenants: 0,
      tenants: [],
      arrears: [],
      leaseExpiries: [],
      totalArrears: 0,
    };
  }

  async getPropertyData(
    _tenantId: string,
    params: ReportParams
  ): Promise<PropertyReportData> {
    const dateRange = params.dateRange ?? this.defaultDateRange();
    return {
      dateRange,
      properties: [],
      portfolioTotal: {
        totalUnits: 0,
        occupiedUnits: 0,
        occupancyRate: 0,
        totalRevenue: 0,
        totalExpenses: 0,
        netOperatingIncome: 0,
        avgCollectionRate: 0,
      },
    };
  }
}
