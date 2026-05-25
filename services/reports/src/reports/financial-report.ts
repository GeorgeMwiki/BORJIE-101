/**
 * Financial Report - Rent roll, income statement, cash flow
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface RentRollItem {
  unitId: string;
  unitName: string;
  propertyName: string;
  monthlyRent: number;
  status: string;
  tenantName?: string;
  leaseEndDate?: Date;
}

export interface IncomeStatementItem {
  category: string;
  amount: number;
  period: string;
}

export interface CashFlowItem {
  date: Date;
  description: string;
  amount: number;
  type: 'inflow' | 'outflow';
}

export interface FinancialReportData {
  rentRoll: {
    units: RentRollItem[];
    totalUnits: number;
    occupiedUnits: number;
    totalMonthlyRent: number;
  };
  incomeStatement: {
    revenue: number;
    expenses: number;
    netOperatingIncome: number;
    breakdown: IncomeStatementItem[];
  };
  cashFlow: {
    openingBalance: number;
    closingBalance: number;
    items: CashFlowItem[];
  };
  dateRange: DateRange;
  period: string;
}

export function financialReportToReportData(
  data: FinancialReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Rent Roll',
    table: {
      headers: ['Unit', 'Property', 'Monthly Rent', 'Status', 'Tenant'],
      rows: data.rentRoll.units.map((u) => [
        u.unitName,
        u.propertyName,
        u.monthlyRent,
        u.status,
        u.tenantName ?? '',
      ]),
    },
  });

  sections.push({
    title: 'Income Statement',
    table: {
      headers: ['Category', 'Amount', 'Period'],
      rows: data.incomeStatement.breakdown.map((b) => [
        b.category,
        b.amount,
        b.period,
      ]),
    },
  });

  sections.push({
    title: 'Cash Flow',
    table: {
      headers: ['Date', 'Description', 'Amount', 'Type'],
      rows: data.cashFlow.items.map((i) => [
        i.date.toISOString().slice(0, 10),
        i.description,
        i.amount,
        i.type,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Units': data.rentRoll.totalUnits,
      'Occupied Units': data.rentRoll.occupiedUnits,
      'Total Monthly Rent': data.rentRoll.totalMonthlyRent,
      'Total Revenue': data.incomeStatement.revenue,
      'Total Expenses': data.incomeStatement.expenses,
      'Net Operating Income': data.incomeStatement.netOperatingIncome,
      'Opening Balance': data.cashFlow.openingBalance,
      'Closing Balance': data.cashFlow.closingBalance,
    },
  };
}
