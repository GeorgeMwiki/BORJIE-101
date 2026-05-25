/**
 * Analytics and KPI Service
 */

import type { TenantId, PropertyId } from '../types/index.js';

export interface PortfolioKPIs {
  tenantId: TenantId;
  occupancyRate: number;
  collectionRate: number;
  maintenanceCosts: number;
  noi: number;
  totalRevenue: number;
  totalExpenses: number;
}

export interface PropertyKPIs {
  tenantId: TenantId;
  propertyId: PropertyId;
  propertyName: string;
  occupancyRate: number;
  collectionRate: number;
  revenue: number;
  expenses: number;
  noi: number;
}

export interface RevenueAnalytics {
  tenantId: TenantId;
  period: string;
  totalRevenue: number;
  byMonth: Array<{ month: string; revenue: number }>;
  bySource: Record<string, number>;
}

export interface MaintenanceAnalytics {
  tenantId: TenantId;
  period: string;
  totalCost: number;
  totalWorkOrders: number;
  avgResolutionDays: number;
  byCategory: Array<{ category: string; count: number; cost: number }>;
}

export interface TenantChurnAnalytics {
  tenantId: TenantId;
  period: string;
  moveIns: number;
  moveOuts: number;
  churnRate: number;
  avgTenancyMonths: number;
}

export interface ArrearsAgingBucket {
  bucket: string;
  count: number;
  amount: number;
}

export interface ArrearsAgingReport {
  tenantId: TenantId;
  totalArrears: number;
  buckets: ArrearsAgingBucket[];
  byProperty: Array<{ propertyId: string; propertyName: string; amount: number }>;
}

export interface IAnalyticsDataProvider {
  getPortfolioKPIs(tenantId: TenantId): Promise<PortfolioKPIs>;
  getPropertyKPIs(tenantId: TenantId, propertyId: PropertyId): Promise<PropertyKPIs>;
  getRevenueAnalytics(tenantId: TenantId, period: string): Promise<RevenueAnalytics>;
  getMaintenanceAnalytics(tenantId: TenantId, period: string): Promise<MaintenanceAnalytics>;
  getTenantChurnAnalytics(tenantId: TenantId): Promise<TenantChurnAnalytics>;
  getArrearsAgingReport(tenantId: TenantId): Promise<ArrearsAgingReport>;
}

export class AnalyticsService {
  constructor(private readonly dataProvider: IAnalyticsDataProvider) {}

  async getPortfolioKPIs(tenantId: TenantId): Promise<PortfolioKPIs> {
    return this.dataProvider.getPortfolioKPIs(tenantId);
  }

  async getPropertyKPIs(tenantId: TenantId, propertyId: PropertyId): Promise<PropertyKPIs> {
    return this.dataProvider.getPropertyKPIs(tenantId, propertyId);
  }

  async getRevenueAnalytics(tenantId: TenantId, period: string): Promise<RevenueAnalytics> {
    return this.dataProvider.getRevenueAnalytics(tenantId, period);
  }

  async getMaintenanceAnalytics(tenantId: TenantId, period: string): Promise<MaintenanceAnalytics> {
    return this.dataProvider.getMaintenanceAnalytics(tenantId, period);
  }

  async getTenantChurnAnalytics(tenantId: TenantId): Promise<TenantChurnAnalytics> {
    return this.dataProvider.getTenantChurnAnalytics(tenantId);
  }

  async getArrearsAgingReport(tenantId: TenantId): Promise<ArrearsAgingReport> {
    return this.dataProvider.getArrearsAgingReport(tenantId);
  }
}
