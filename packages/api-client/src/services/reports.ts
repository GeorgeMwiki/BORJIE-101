/**
 * Reports API Service
 * Reports generation
 */

import { getApiClient, ApiResponse } from '../client';

export interface FinancialReportSummary {
  totalInvoiced: number;
  totalCollected: number;
  totalOutstanding: number;
  collectionRate: number;
}

export interface FinancialReport {
  summary: FinancialReportSummary;
  monthlyTrend: Array<{
    month: string;
    invoiced: number;
    collected: number;
  }>;
  arrearsAging: {
    current: number;
    overdue: number;
  };
}

export interface OccupancyReportSummary {
  totalUnits: number;
  occupiedUnits: number;
  availableUnits: number;
  maintenanceUnits: number;
  occupancyRate: number;
}

export interface OccupancyReport {
  summary: OccupancyReportSummary;
  byProperty: Array<{
    id: string;
    name: string;
    totalUnits: number;
    occupiedUnits: number;
    occupancyRate: number;
  }>;
  leaseExpiry: {
    next30Days: number;
    next60Days: number;
  };
}

export interface MaintenanceReportSummary {
  total: number;
  completed: number;
  open: number;
  completionRate: number;
  avgResolutionTimeHours: number;
  totalCost: number;
}

export interface MaintenanceReport {
  summary: MaintenanceReportSummary;
  byCategory: Array<{ category: string; count: number }>;
  byPriority: {
    emergency: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface StatementReport {
  period: { start: string; end: string };
  income: {
    rentBilled: number;
    collected: number;
    outstanding: number;
  };
  expenses: {
    maintenance: number;
    total: number;
  };
  netOperatingIncome: number;
  entries: Array<{
    date: string;
    type: 'income' | 'expense';
    description: string;
    amount: number;
  }>;
}

export interface ExportReportResponse {
  message: string;
  downloadUrl: string;
  expiresAt: string;
}

export type ReportFormat = 'csv' | 'pdf';

export const reportsService = {
  /**
   * Get financial report
   */
  async getFinancial(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<ApiResponse<FinancialReport>> {
    const searchParams: Record<string, string> = {};
    if (params?.startDate) searchParams.startDate = params.startDate;
    if (params?.endDate) searchParams.endDate = params.endDate;
    return getApiClient().get<FinancialReport>('/reports/financial', searchParams);
  },

  /**
   * Get occupancy report
   */
  async getOccupancy(): Promise<ApiResponse<OccupancyReport>> {
    return getApiClient().get<OccupancyReport>('/reports/occupancy');
  },

  /**
   * Get maintenance report
   */
  async getMaintenance(): Promise<ApiResponse<MaintenanceReport>> {
    return getApiClient().get<MaintenanceReport>('/reports/maintenance');
  },

  /**
   * Get owner statement
   */
  async getStatements(params?: {
    period?: 'current_month' | 'last_month' | 'quarter' | 'year';
  }): Promise<ApiResponse<StatementReport>> {
    const searchParams: Record<string, string> = {};
    if (params?.period) searchParams.period = params.period;
    return getApiClient().get<StatementReport>('/reports/statements', searchParams);
  },

  /**
   * Export report
   */
  async export(
    type: string,
    params?: { format?: ReportFormat }
  ): Promise<ApiResponse<ExportReportResponse>> {
    const searchParams: Record<string, string> = {};
    if (params?.format) searchParams.format = params.format;
    return getApiClient().get<ExportReportResponse>(
      `/reports/export/${encodeURIComponent(type)}`,
      searchParams
    );
  },
};
