/**
 * Report Generation Service
 */

import type { TenantId, SiteId, CustomerId, DateRange, ReportFilters } from '../types/index.js';

export interface RoyaltyRollUnit {
  unitId: string;
  unitName: string;
  siteName: string;
  monthlyRoyalty: number;
  status: string;
  buyerName?: string;
  supplyEndDate?: Date;
}

export interface RoyaltyRollReport {
  tenantId: TenantId;
  generatedAt: Date;
  units: RoyaltyRollUnit[];
  totalUnits: number;
  producingUnits: number;
  totalMonthlyRoyalty: number;
}

export interface CollectionReport {
  tenantId: TenantId;
  dateRange: DateRange;
  totalBilled: number;
  totalCollected: number;
  totalOutstanding: number;
  collectionRate: number;
  payments: Array<{ date: Date; amount: number; reference: string; customerName: string }>;
}

export interface AssetUtilisationReport {
  tenantId: TenantId;
  dateRange: DateRange;
  totalUnits: number;
  producingUnits: number;
  availableUnits: number;
  assetUtilisationRate: number;
  bySite: Array<{ siteId: string; siteName: string; totalUnits: number; producingUnits: number; assetUtilisationRate: number }>;
}

export interface MaintenanceReport {
  tenantId: TenantId;
  dateRange: DateRange;
  totalWorkOrders: number;
  completed: number;
  open: number;
  totalCost: number;
  byCategory: Array<{ category: string; count: number; cost: number }>;
  byPriority: Record<string, number>;
}

export interface FinancialSummary {
  tenantId: TenantId;
  period: string;
  totalRevenue: number;
  totalExpenses: number;
  netOperatingIncome: number;
  collectionRate: number;
  breakdown: Record<string, number>;
}

export interface BuyerStatement {
  tenantId: TenantId;
  customerId: CustomerId;
  customerName: string;
  dateRange: DateRange;
  openingBalance: number;
  closingBalance: number;
  totalCharges: number;
  totalPayments: number;
  lineItems: Array<{ date: Date; description: string; debit: number; credit: number; balance: number }>;
}

export interface SitePerformance {
  tenantId: TenantId;
  siteId: SiteId;
  siteName: string;
  dateRange: DateRange;
  revenue: number;
  expenses: number;
  noi: number;
  assetUtilisationRate: number;
  collectionRate: number;
}

export interface IReportDataProvider {
  getUnits(tenantId: TenantId, filters?: ReportFilters): Promise<RoyaltyRollUnit[]>;
  getPayments(tenantId: TenantId, dateRange: DateRange): Promise<CollectionReport['payments']>;
  getAssetUtilisationData(tenantId: TenantId, dateRange: DateRange): Promise<AssetUtilisationReport['bySite']>;
  getMaintenanceData(tenantId: TenantId, dateRange: DateRange): Promise<{
    total: number;
    completed: number;
    open: number;
    totalCost: number;
    byCategory: Array<{ category: string; count: number; cost: number }>;
    byPriority: Record<string, number>;
  }>;
  getFinancialData(tenantId: TenantId, period: string): Promise<FinancialSummary>;
  getCustomerStatementData(tenantId: TenantId, customerId: CustomerId, dateRange: DateRange): Promise<Omit<BuyerStatement, 'tenantId' | 'customerId' | 'dateRange'>>;
  getSitePerformanceData(tenantId: TenantId, siteId: SiteId, dateRange: DateRange): Promise<Omit<SitePerformance, 'tenantId' | 'siteId' | 'dateRange'>>;
}

export class ReportService {
  constructor(private readonly dataProvider: IReportDataProvider) {}

  async generateRoyaltyRollReport(tenantId: TenantId, filters?: ReportFilters): Promise<RoyaltyRollReport> {
    const units = await this.dataProvider.getUnits(tenantId, filters);
    const producingUnits = units.filter((u) => u.status === 'producing' || u.status === 'PRODUCING').length;
    const totalMonthlyRoyalty = units.reduce((sum, u) => sum + u.monthlyRoyalty, 0);
    return { tenantId, generatedAt: new Date(), units, totalUnits: units.length, producingUnits, totalMonthlyRoyalty };
  }

  async generateCollectionReport(tenantId: TenantId, dateRange: DateRange): Promise<CollectionReport> {
    const payments = await this.dataProvider.getPayments(tenantId, dateRange);
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalBilled = totalCollected * 1.1;
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);
    const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
    return { tenantId, dateRange, totalBilled, totalCollected, totalOutstanding, collectionRate, payments };
  }

  async generateAssetUtilisationReport(tenantId: TenantId, dateRange: DateRange): Promise<AssetUtilisationReport> {
    const bySite = await this.dataProvider.getAssetUtilisationData(tenantId, dateRange);
    const totalUnits = bySite.reduce((sum, p) => sum + p.totalUnits, 0);
    const producingUnits = bySite.reduce((sum, p) => sum + p.producingUnits, 0);
    const availableUnits = totalUnits - producingUnits;
    const assetUtilisationRate = totalUnits > 0 ? (producingUnits / totalUnits) * 100 : 0;
    return { tenantId, dateRange, totalUnits, producingUnits, availableUnits, assetUtilisationRate, bySite };
  }

  async generateMaintenanceReport(tenantId: TenantId, dateRange: DateRange): Promise<MaintenanceReport> {
    const data = await this.dataProvider.getMaintenanceData(tenantId, dateRange);
    return { tenantId, dateRange, totalWorkOrders: data.total, completed: data.completed, open: data.open, totalCost: data.totalCost, byCategory: data.byCategory, byPriority: data.byPriority };
  }

  async generateFinancialSummary(tenantId: TenantId, period: string): Promise<FinancialSummary> {
    return this.dataProvider.getFinancialData(tenantId, period);
  }

  async generateBuyerStatement(tenantId: TenantId, customerId: CustomerId, dateRange: DateRange): Promise<BuyerStatement> {
    const data = await this.dataProvider.getCustomerStatementData(tenantId, customerId, dateRange);
    return { tenantId, customerId, dateRange, ...data };
  }

  async generateSitePerformance(tenantId: TenantId, siteId: SiteId, dateRange: DateRange): Promise<SitePerformance> {
    const data = await this.dataProvider.getSitePerformanceData(tenantId, siteId, dateRange);
    return { tenantId, siteId, dateRange, ...data };
  }
}
