/**
 * Financial Report - Royalty roll, income statement, cash flow
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface RoyaltyRollItem {
  unitId: string;
  unitName: string;
  siteName: string;
  monthlyRoyalty: number;
  status: string;
  buyerName?: string;
  supplyEndDate?: Date;
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
  royaltyRoll: {
    units: RoyaltyRollItem[];
    totalUnits: number;
    producingUnits: number;
    totalMonthlyRoyalty: number;
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
    title: 'Royalty Roll',
    table: {
      headers: ['Unit', 'Site', 'Monthly Royalty', 'Status', 'Buyer'],
      rows: data.royaltyRoll.units.map((u) => [
        u.unitName,
        u.siteName,
        u.monthlyRoyalty,
        u.status,
        u.buyerName ?? '',
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
      'Total Units': data.royaltyRoll.totalUnits,
      'Producing Units': data.royaltyRoll.producingUnits,
      'Total Monthly Royalty': data.royaltyRoll.totalMonthlyRoyalty,
      'Total Revenue': data.incomeStatement.revenue,
      'Total Expenses': data.incomeStatement.expenses,
      'Net Operating Income': data.incomeStatement.netOperatingIncome,
      'Opening Balance': data.cashFlow.openingBalance,
      'Closing Balance': data.cashFlow.closingBalance,
    },
  };
}
