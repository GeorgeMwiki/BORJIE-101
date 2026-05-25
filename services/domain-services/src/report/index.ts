/**
 * Report domain service.
 * Handles dashboard metrics, financial statements, and PDF export for the BORJIE platform.
 */

import type {
  TenantId,
  UserId,
  PropertyId,
  CustomerId,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// Types
export type ReportType = 
  | 'dashboard' | 'financial_statement' | 'rent_roll'
  | 'occupancy' | 'arrears' | 'maintenance' | 'customer_statement';

export type ReportFormat = 'json' | 'pdf' | 'csv' | 'excel';

export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

// Dashboard Types
export interface DashboardMetrics {
  readonly tenantId: TenantId;
  readonly period: ReportPeriod;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly generatedAt: ISOTimestamp;
  
  // Property metrics
  readonly totalProperties: number;
  readonly totalUnits: number;
  readonly occupiedUnits: number;
  readonly vacantUnits: number;
  readonly occupancyRate: number;
  
  // Financial metrics
  readonly totalRevenue: Money;
  readonly collectedRevenue: Money;
  readonly outstandingReceivables: Money;
  readonly collectionRate: number;
  readonly averageRentPerUnit: Money;
  
  // Customer metrics
  readonly totalCustomers: number;
  readonly activeCustomers: number;
  readonly newCustomersThisPeriod: number;
  readonly churnedCustomersThisPeriod: number;
  
  // Lease metrics
  readonly totalActiveLeases: number;
  readonly leasesExpiringSoon: number;
  readonly renewalRate: number;
  
  // Maintenance metrics
  readonly openWorkOrders: number;
  readonly completedWorkOrdersThisPeriod: number;
  readonly averageResolutionTime: number;
  readonly slaComplianceRate: number;
  
  // Arrears metrics
  readonly customersInArrears: number;
  readonly totalArrearsAmount: Money;
  readonly arrearsAgingBuckets: ArrearsAgingBucket[];
}

export interface ArrearsAgingBucket {
  readonly bucket: '0-30' | '31-60' | '61-90' | '90+';
  readonly count: number;
  readonly amount: Money;
}

// Financial Statement Types
export interface FinancialStatement {
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId | null;
  readonly reportType: 'income_statement' | 'balance_sheet' | 'cash_flow';
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly generatedAt: ISOTimestamp;
  readonly generatedBy: UserId;
  
  readonly income: FinancialLineItem[];
  readonly expenses: FinancialLineItem[];
  readonly netIncome: Money;
  readonly totalIncome: Money;
  readonly totalExpenses: Money;
}

export interface FinancialLineItem {
  readonly category: string;
  readonly description: string;
  readonly amount: Money;
  readonly percentage: number;
}

// Customer Statement Types
export interface CustomerStatement {
  readonly customerId: CustomerId;
  readonly tenantId: TenantId;
  readonly customerName: string;
  readonly customerNumber: string;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly generatedAt: ISOTimestamp;
  
  readonly openingBalance: Money;
  readonly closingBalance: Money;
  readonly totalCharges: Money;
  readonly totalPayments: Money;
  readonly totalCredits: Money;
  
  readonly transactions: StatementTransaction[];
}

export interface StatementTransaction {
  readonly date: ISOTimestamp;
  readonly type: 'charge' | 'payment' | 'credit' | 'adjustment';
  readonly description: string;
  readonly reference: string | null;
  readonly debit: Money | null;
  readonly credit: Money | null;
  readonly balance: Money;
}

// Rent Roll Types
export interface RentRollReport {
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId | null;
  readonly asOfDate: ISOTimestamp;
  readonly generatedAt: ISOTimestamp;
  
  readonly summary: RentRollSummary;
  readonly entries: RentRollEntry[];
}

export interface RentRollSummary {
  readonly totalUnits: number;
  readonly occupiedUnits: number;
  readonly vacantUnits: number;
  readonly totalMonthlyRent: Money;
  readonly collectedRent: Money;
  readonly outstandingRent: Money;
  readonly occupancyRate: number;
}

export interface RentRollEntry {
  readonly propertyName: string;
  readonly unitNumber: string;
  readonly customerName: string | null;
  readonly leaseNumber: string | null;
  readonly leaseStart: ISOTimestamp | null;
  readonly leaseEnd: ISOTimestamp | null;
  readonly monthlyRent: Money;
  readonly amountPaid: Money;
  readonly balance: Money;
  readonly status: 'occupied' | 'vacant' | 'notice';
}

// Error Types
export const ReportServiceError = {
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  PROPERTY_NOT_FOUND: 'PROPERTY_NOT_FOUND',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  REPORT_GENERATION_FAILED: 'REPORT_GENERATION_FAILED',
  PDF_GENERATION_FAILED: 'PDF_GENERATION_FAILED',
  INVALID_REPORT_TYPE: 'INVALID_REPORT_TYPE',
} as const;

export type ReportServiceErrorCode = (typeof ReportServiceError)[keyof typeof ReportServiceError];

export interface ReportServiceErrorResult {
  code: ReportServiceErrorCode;
  message: string;
}

// Input Types
export interface DashboardInput {
  period: ReportPeriod;
  periodStart?: ISOTimestamp;
  periodEnd?: ISOTimestamp;
  propertyIds?: PropertyId[];
}

export interface StatementInput {
  customerId: CustomerId;
  periodStart: ISOTimestamp;
  periodEnd: ISOTimestamp;
}

export interface ExportPdfInput {
  reportType: ReportType;
  reportData: unknown;
  template?: string;
  filename?: string;
}

// Data Provider Interface
export interface ReportDataProvider {
  getPropertyMetrics(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<{
    totalProperties: number; totalUnits: number; occupiedUnits: number; vacantUnits: number;
  }>;
  getFinancialMetrics(tenantId: TenantId, periodStart: ISOTimestamp, periodEnd: ISOTimestamp): Promise<{
    totalRevenue: number; collectedRevenue: number; outstandingReceivables: number; currency: string;
  }>;
  getCustomerMetrics(tenantId: TenantId, periodStart: ISOTimestamp, periodEnd: ISOTimestamp): Promise<{
    totalCustomers: number; activeCustomers: number; newCustomers: number; churnedCustomers: number;
  }>;
  getLeaseMetrics(tenantId: TenantId): Promise<{
    totalActiveLeases: number; leasesExpiringSoon: number; renewalRate: number;
  }>;
  getMaintenanceMetrics(tenantId: TenantId, periodStart: ISOTimestamp, periodEnd: ISOTimestamp): Promise<{
    openWorkOrders: number; completedWorkOrders: number; avgResolutionTime: number; slaComplianceRate: number;
  }>;
  getArrearsMetrics(tenantId: TenantId): Promise<{
    customersInArrears: number; totalArrearsAmount: number; agingBuckets: ArrearsAgingBucket[]; currency: string;
  }>;
  getCustomerTransactions(customerId: CustomerId, tenantId: TenantId, periodStart: ISOTimestamp, periodEnd: ISOTimestamp): Promise<{
    customerName: string; customerNumber: string; transactions: StatementTransaction[];
  }>;
  getRentRollData(tenantId: TenantId, propertyId: PropertyId | null, asOfDate: ISOTimestamp): Promise<RentRollEntry[]>;
}

// PDF Generator Interface
export interface PdfGenerator {
  generate(template: string, data: unknown): Promise<Buffer>;
}

// Domain Events
export interface ReportGeneratedEvent {
  eventId: string;
  eventType: 'ReportGenerated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    reportType: ReportType;
    format: ReportFormat;
    generatedBy: UserId;
  };
}

/**
 * Report management service.
 */
export class ReportService {
  constructor(
    private readonly dataProvider: ReportDataProvider,
    private readonly pdfGenerator: PdfGenerator | null,
    private readonly eventBus: EventBus
  ) {}

  /** Get dashboard metrics */
  async getDashboard(
    tenantId: TenantId,
    input: DashboardInput,
    requestedBy: UserId,
    correlationId: string
  ): Promise<Result<DashboardMetrics, ReportServiceErrorResult>> {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date = now;

    // Use UTC for period boundaries — local-time constructors shift the
    // boundary for non-UTC servers and silently misclassify transactions
    // sitting within a few hours of midnight.
    switch (input.period) {
      case 'daily':
        periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );
        break;
      case 'weekly':
        periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'monthly':
        periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        break;
      case 'quarterly':
        periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
        );
        break;
      case 'yearly':
        periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        break;
      case 'custom':
        if (!input.periodStart || !input.periodEnd) {
          return err({ code: ReportServiceError.INVALID_DATE_RANGE, message: 'Custom period requires start and end dates' });
        }
        periodStart = new Date(input.periodStart);
        periodEnd = new Date(input.periodEnd);
        break;
      default:
        periodStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
    }

    if (periodStart > periodEnd) {
      return err({ code: ReportServiceError.INVALID_DATE_RANGE, message: 'Period start must be before period end' });
    }

    const periodStartISO = periodStart.toISOString();
    const periodEndISO = periodEnd.toISOString();

    try {
      const [propertyMetrics, financialMetrics, customerMetrics, leaseMetrics, maintenanceMetrics, arrearsMetrics] = await Promise.all([
        this.dataProvider.getPropertyMetrics(tenantId, input.propertyIds),
        this.dataProvider.getFinancialMetrics(tenantId, periodStartISO, periodEndISO),
        this.dataProvider.getCustomerMetrics(tenantId, periodStartISO, periodEndISO),
        this.dataProvider.getLeaseMetrics(tenantId),
        this.dataProvider.getMaintenanceMetrics(tenantId, periodStartISO, periodEndISO),
        this.dataProvider.getArrearsMetrics(tenantId),
      ]);

      const currency = financialMetrics.currency || 'USD';
      const occupancyRate = propertyMetrics.totalUnits > 0
        ? Math.round((propertyMetrics.occupiedUnits / propertyMetrics.totalUnits) * 100)
        : 0;
      const collectionRate = financialMetrics.totalRevenue > 0
        ? Math.round((financialMetrics.collectedRevenue / financialMetrics.totalRevenue) * 100)
        : 0;
      const avgRentPerUnit = propertyMetrics.totalUnits > 0
        ? Math.round(financialMetrics.totalRevenue / propertyMetrics.totalUnits)
        : 0;

      const dashboard: DashboardMetrics = {
        tenantId, period: input.period,
        periodStart: periodStartISO, periodEnd: periodEndISO,
        generatedAt: now.toISOString(),
        
        totalProperties: propertyMetrics.totalProperties,
        totalUnits: propertyMetrics.totalUnits,
        occupiedUnits: propertyMetrics.occupiedUnits,
        vacantUnits: propertyMetrics.vacantUnits,
        occupancyRate,
        
        totalRevenue: { amount: financialMetrics.totalRevenue, currency },
        collectedRevenue: { amount: financialMetrics.collectedRevenue, currency },
        outstandingReceivables: { amount: financialMetrics.outstandingReceivables, currency },
        collectionRate,
        averageRentPerUnit: { amount: avgRentPerUnit, currency },
        
        totalCustomers: customerMetrics.totalCustomers,
        activeCustomers: customerMetrics.activeCustomers,
        newCustomersThisPeriod: customerMetrics.newCustomers,
        churnedCustomersThisPeriod: customerMetrics.churnedCustomers,
        
        totalActiveLeases: leaseMetrics.totalActiveLeases,
        leasesExpiringSoon: leaseMetrics.leasesExpiringSoon,
        renewalRate: leaseMetrics.renewalRate,
        
        openWorkOrders: maintenanceMetrics.openWorkOrders,
        completedWorkOrdersThisPeriod: maintenanceMetrics.completedWorkOrders,
        averageResolutionTime: maintenanceMetrics.avgResolutionTime,
        slaComplianceRate: maintenanceMetrics.slaComplianceRate,
        
        customersInArrears: arrearsMetrics.customersInArrears,
        totalArrearsAmount: { amount: arrearsMetrics.totalArrearsAmount, currency: arrearsMetrics.currency },
        arrearsAgingBuckets: arrearsMetrics.agingBuckets,
      };

      const event: ReportGeneratedEvent = {
        eventId: generateEventId(), eventType: 'ReportGenerated',
        timestamp: now.toISOString(), tenantId, correlationId,
        causationId: null, metadata: {},
        payload: { reportType: 'dashboard', format: 'json', generatedBy: requestedBy },
      };
      await this.eventBus.publish(createEventEnvelope(event, tenantId, 'Report'));

      return ok(dashboard);
    } catch (e) {
      return err({ code: ReportServiceError.REPORT_GENERATION_FAILED, message: e instanceof Error ? e.message : 'Failed to generate dashboard' });
    }
  }

  /** Get customer statement */
  async getStatement(
    tenantId: TenantId,
    input: StatementInput,
    requestedBy: UserId,
    correlationId: string
  ): Promise<Result<CustomerStatement, ReportServiceErrorResult>> {
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);

    if (periodStart > periodEnd) {
      return err({ code: ReportServiceError.INVALID_DATE_RANGE, message: 'Period start must be before period end' });
    }

    try {
      const data = await this.dataProvider.getCustomerTransactions(
        input.customerId, tenantId, input.periodStart, input.periodEnd
      );

      // Derive currency from the actual transactions rather than hardcoding.
      // An empty-transaction statement falls back to an empty string so the
      // absence is visible to the UI instead of being silently wrong.
      const firstTxn = data.transactions[0];
      const currency =
        firstTxn?.debit?.currency ?? firstTxn?.credit?.currency ?? '';
      let runningBalance = 0;
      let totalCharges = 0;
      let totalPayments = 0;
      let totalCredits = 0;

      const transactions = data.transactions.map(t => {
        if (t.debit) {
          totalCharges += t.debit.amount;
          runningBalance += t.debit.amount;
        }
        if (t.credit) {
          if (t.type === 'payment') totalPayments += t.credit.amount;
          else totalCredits += t.credit.amount;
          runningBalance -= t.credit.amount;
        }
        return { ...t, balance: { amount: runningBalance, currency } };
      });

      const openingBalance = transactions.length > 0
        ? { amount: transactions[0].balance.amount - (transactions[0].debit?.amount ?? 0) + (transactions[0].credit?.amount ?? 0), currency }
        : { amount: 0, currency };

      const statement: CustomerStatement = {
        customerId: input.customerId, tenantId,
        customerName: data.customerName, customerNumber: data.customerNumber,
        periodStart: input.periodStart, periodEnd: input.periodEnd,
        generatedAt: new Date().toISOString(),
        openingBalance, closingBalance: { amount: runningBalance, currency },
        totalCharges: { amount: totalCharges, currency },
        totalPayments: { amount: totalPayments, currency },
        totalCredits: { amount: totalCredits, currency },
        transactions,
      };

      return ok(statement);
    } catch (e) {
      return err({ code: ReportServiceError.REPORT_GENERATION_FAILED, message: e instanceof Error ? e.message : 'Failed to generate statement' });
    }
  }

  /** Export report as PDF */
  async exportPdf(
    tenantId: TenantId,
    input: ExportPdfInput,
    requestedBy: UserId,
    correlationId: string
  ): Promise<Result<{ buffer: Buffer; filename: string }, ReportServiceErrorResult>> {
    if (!this.pdfGenerator) {
      return err({ code: ReportServiceError.PDF_GENERATION_FAILED, message: 'PDF generator not configured' });
    }

    const templateMap: Record<ReportType, string> = {
      dashboard: 'dashboard-report',
      financial_statement: 'financial-statement',
      rent_roll: 'rent-roll',
      occupancy: 'occupancy-report',
      arrears: 'arrears-report',
      maintenance: 'maintenance-report',
      customer_statement: 'customer-statement',
    };

    const template = input.template ?? templateMap[input.reportType] ?? 'generic-report';
    const filename = input.filename ?? `${input.reportType}-${Date.now()}.pdf`;

    try {
      const buffer = await this.pdfGenerator.generate(template, input.reportData);

      const event: ReportGeneratedEvent = {
        eventId: generateEventId(), eventType: 'ReportGenerated',
        timestamp: new Date().toISOString(), tenantId, correlationId,
        causationId: null, metadata: { filename },
        payload: { reportType: input.reportType, format: 'pdf', generatedBy: requestedBy },
      };
      await this.eventBus.publish(createEventEnvelope(event, tenantId, 'Report'));

      return ok({ buffer, filename });
    } catch (e) {
      return err({ code: ReportServiceError.PDF_GENERATION_FAILED, message: e instanceof Error ? e.message : 'PDF generation failed' });
    }
  }

  /** Get rent roll report */
  async getRentRoll(
    tenantId: TenantId,
    propertyId: PropertyId | null,
    asOfDate: ISOTimestamp,
    requestedBy: UserId,
    correlationId: string
  ): Promise<Result<RentRollReport, ReportServiceErrorResult>> {
    try {
      const entries = await this.dataProvider.getRentRollData(tenantId, propertyId, asOfDate);

      // Derive currency from the actual rent-roll entries rather than
      // hardcoding. Empty-portfolio reports fall back to empty string.
      const firstEntry = entries[0];
      const currency =
        firstEntry?.monthlyRent?.currency ??
        firstEntry?.amountPaid?.currency ??
        firstEntry?.balance?.currency ??
        '';
      const totalUnits = entries.length;
      const occupiedUnits = entries.filter(e => e.status === 'occupied').length;
      const vacantUnits = entries.filter(e => e.status === 'vacant').length;
      const totalMonthlyRent = entries.reduce((sum, e) => sum + e.monthlyRent.amount, 0);
      const collectedRent = entries.reduce((sum, e) => sum + e.amountPaid.amount, 0);
      const outstandingRent = entries.reduce((sum, e) => sum + e.balance.amount, 0);

      const report: RentRollReport = {
        tenantId, propertyId, asOfDate, generatedAt: new Date().toISOString(),
        summary: {
          totalUnits, occupiedUnits, vacantUnits,
          totalMonthlyRent: { amount: totalMonthlyRent, currency },
          collectedRent: { amount: collectedRent, currency },
          outstandingRent: { amount: outstandingRent, currency },
          occupancyRate: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0,
        },
        entries,
      };

      return ok(report);
    } catch (e) {
      return err({ code: ReportServiceError.REPORT_GENERATION_FAILED, message: e instanceof Error ? e.message : 'Failed to generate rent roll' });
    }
  }
}
