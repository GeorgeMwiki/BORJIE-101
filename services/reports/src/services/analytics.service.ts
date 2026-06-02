/**
 * Analytics and KPI Service
 */

import type { TenantId, SiteId } from '../types/index.js';

export interface PortfolioKPIs {
  tenantId: TenantId;
  assetUtilisationRate: number;
  collectionRate: number;
  maintenanceCosts: number;
  noi: number;
  totalRevenue: number;
  totalExpenses: number;
}

export interface SiteKPIs {
  tenantId: TenantId;
  siteId: SiteId;
  siteName: string;
  assetUtilisationRate: number;
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

export interface BuyerChurnAnalytics {
  tenantId: TenantId;
  period: string;
  onboarded: number;
  offboarded: number;
  churnRate: number;
  avgRelationshipMonths: number;
}

export interface OutstandingAgingBucket {
  bucket: string;
  count: number;
  amount: number;
}

export interface OutstandingAgingReport {
  tenantId: TenantId;
  totalOutstanding: number;
  buckets: OutstandingAgingBucket[];
  bySite: Array<{ siteId: string; siteName: string; amount: number }>;
}

export interface IAnalyticsDataProvider {
  getPortfolioKPIs(tenantId: TenantId): Promise<PortfolioKPIs>;
  getSiteKPIs(tenantId: TenantId, siteId: SiteId): Promise<SiteKPIs>;
  getRevenueAnalytics(tenantId: TenantId, period: string): Promise<RevenueAnalytics>;
  getMaintenanceAnalytics(tenantId: TenantId, period: string): Promise<MaintenanceAnalytics>;
  getBuyerChurnAnalytics(tenantId: TenantId): Promise<BuyerChurnAnalytics>;
  getOutstandingAgingReport(tenantId: TenantId): Promise<OutstandingAgingReport>;
}

export class AnalyticsService {
  constructor(private readonly dataProvider: IAnalyticsDataProvider) {}

  async getPortfolioKPIs(tenantId: TenantId): Promise<PortfolioKPIs> {
    return this.dataProvider.getPortfolioKPIs(tenantId);
  }

  async getSiteKPIs(tenantId: TenantId, siteId: SiteId): Promise<SiteKPIs> {
    return this.dataProvider.getSiteKPIs(tenantId, siteId);
  }

  async getRevenueAnalytics(tenantId: TenantId, period: string): Promise<RevenueAnalytics> {
    return this.dataProvider.getRevenueAnalytics(tenantId, period);
  }

  async getMaintenanceAnalytics(tenantId: TenantId, period: string): Promise<MaintenanceAnalytics> {
    return this.dataProvider.getMaintenanceAnalytics(tenantId, period);
  }

  async getBuyerChurnAnalytics(tenantId: TenantId): Promise<BuyerChurnAnalytics> {
    return this.dataProvider.getBuyerChurnAnalytics(tenantId);
  }

  async getOutstandingAgingReport(tenantId: TenantId): Promise<OutstandingAgingReport> {
    return this.dataProvider.getOutstandingAgingReport(tenantId);
  }
}
