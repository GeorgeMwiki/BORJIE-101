/**
 * Report Generation Service
 */

import type { TenantId, PropertyId, CustomerId, DateRange, ReportFilters } from '../types/index.js';

export interface RentRollUnit {
  unitId: string;
  unitName: string;
  propertyName: string;
  monthlyRent: number;
  status: string;
  tenantName?: string;
  leaseEndDate?: Date;
}

export interface RentRollReport {
  tenantId: TenantId;
  generatedAt: Date;
  units: RentRollUnit[];
  totalUnits: number;
  occupiedUnits: number;
  totalMonthlyRent: number;
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

export interface OccupancyReport {
  tenantId: TenantId;
  dateRange: DateRange;
  totalUnits: number;
  occupiedUnits: number;
  availableUnits: number;
  occupancyRate: number;
  byProperty: Array<{ propertyId: string; propertyName: string; totalUnits: number; occupiedUnits: number; occupancyRate: number }>;
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

export interface TenantStatement {
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

export interface PropertyPerformance {
  tenantId: TenantId;
  propertyId: PropertyId;
  propertyName: string;
  dateRange: DateRange;
  revenue: number;
  expenses: number;
  noi: number;
  occupancyRate: number;
  collectionRate: number;
}

export interface IReportDataProvider {
  getUnits(tenantId: TenantId, filters?: ReportFilters): Promise<RentRollUnit[]>;
  getPayments(tenantId: TenantId, dateRange: DateRange): Promise<CollectionReport['payments']>;
  getOccupancyData(tenantId: TenantId, dateRange: DateRange): Promise<OccupancyReport['byProperty']>;
  getMaintenanceData(tenantId: TenantId, dateRange: DateRange): Promise<{
    total: number;
    completed: number;
    open: number;
    totalCost: number;
    byCategory: Array<{ category: string; count: number; cost: number }>;
    byPriority: Record<string, number>;
  }>;
  getFinancialData(tenantId: TenantId, period: string): Promise<FinancialSummary>;
  getCustomerStatementData(tenantId: TenantId, customerId: CustomerId, dateRange: DateRange): Promise<Omit<TenantStatement, 'tenantId' | 'customerId' | 'dateRange'>>;
  getPropertyPerformanceData(tenantId: TenantId, propertyId: PropertyId, dateRange: DateRange): Promise<Omit<PropertyPerformance, 'tenantId' | 'propertyId' | 'dateRange'>>;
}

export class ReportService {
  constructor(private readonly dataProvider: IReportDataProvider) {}

  async generateRentRollReport(tenantId: TenantId, filters?: ReportFilters): Promise<RentRollReport> {
    const units = await this.dataProvider.getUnits(tenantId, filters);
    const occupiedUnits = units.filter((u) => u.status === 'occupied' || u.status === 'OCCUPIED').length;
    const totalMonthlyRent = units.reduce((sum, u) => sum + u.monthlyRent, 0);
    return { tenantId, generatedAt: new Date(), units, totalUnits: units.length, occupiedUnits, totalMonthlyRent };
  }

  async generateCollectionReport(tenantId: TenantId, dateRange: DateRange): Promise<CollectionReport> {
    const payments = await this.dataProvider.getPayments(tenantId, dateRange);
    const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalBilled = totalCollected * 1.1;
    const totalOutstanding = Math.max(0, totalBilled - totalCollected);
    const collectionRate = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;
    return { tenantId, dateRange, totalBilled, totalCollected, totalOutstanding, collectionRate, payments };
  }

  async generateOccupancyReport(tenantId: TenantId, dateRange: DateRange): Promise<OccupancyReport> {
    const byProperty = await this.dataProvider.getOccupancyData(tenantId, dateRange);
    const totalUnits = byProperty.reduce((sum, p) => sum + p.totalUnits, 0);
    const occupiedUnits = byProperty.reduce((sum, p) => sum + p.occupiedUnits, 0);
    const availableUnits = totalUnits - occupiedUnits;
    const occupancyRate = totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0;
    return { tenantId, dateRange, totalUnits, occupiedUnits, availableUnits, occupancyRate, byProperty };
  }

  async generateMaintenanceReport(tenantId: TenantId, dateRange: DateRange): Promise<MaintenanceReport> {
    const data = await this.dataProvider.getMaintenanceData(tenantId, dateRange);
    return { tenantId, dateRange, totalWorkOrders: data.total, completed: data.completed, open: data.open, totalCost: data.totalCost, byCategory: data.byCategory, byPriority: data.byPriority };
  }

  async generateFinancialSummary(tenantId: TenantId, period: string): Promise<FinancialSummary> {
    return this.dataProvider.getFinancialData(tenantId, period);
  }

  async generateTenantStatement(tenantId: TenantId, customerId: CustomerId, dateRange: DateRange): Promise<TenantStatement> {
    const data = await this.dataProvider.getCustomerStatementData(tenantId, customerId, dateRange);
    return { tenantId, customerId, dateRange, ...data };
  }

  async generatePropertyPerformance(tenantId: TenantId, propertyId: PropertyId, dateRange: DateRange): Promise<PropertyPerformance> {
    const data = await this.dataProvider.getPropertyPerformanceData(tenantId, propertyId, dateRange);
    return { tenantId, propertyId, dateRange, ...data };
  }
}
