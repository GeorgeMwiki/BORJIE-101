/**
 * Property Report - Property performance
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface PropertyPerformanceItem {
  propertyId: string;
  propertyName: string;
  totalUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  revenue: number;
  expenses: number;
  netOperatingIncome: number;
  collectionRate: number;
}

export interface PropertyReportData {
  dateRange: DateRange;
  properties: PropertyPerformanceItem[];
  portfolioTotal: {
    totalUnits: number;
    occupiedUnits: number;
    occupancyRate: number;
    totalRevenue: number;
    totalExpenses: number;
    netOperatingIncome: number;
    avgCollectionRate: number;
  };
}

export function propertyReportToReportData(
  data: PropertyReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Property Performance',
    table: {
      headers: [
        'Property',
        'Units',
        'Occupied',
        'Occupancy %',
        'Revenue',
        'Expenses',
        'NOI',
        'Collection %',
      ],
      rows: data.properties.map((p) => [
        p.propertyName,
        p.totalUnits,
        p.occupiedUnits,
        `${p.occupancyRate.toFixed(1)}%`,
        p.revenue,
        p.expenses,
        p.netOperatingIncome,
        `${p.collectionRate.toFixed(1)}%`,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Units': data.portfolioTotal.totalUnits,
      'Occupied Units': data.portfolioTotal.occupiedUnits,
      'Portfolio Occupancy': `${data.portfolioTotal.occupancyRate.toFixed(1)}%`,
      'Total Revenue': data.portfolioTotal.totalRevenue,
      'Total Expenses': data.portfolioTotal.totalExpenses,
      'Net Operating Income': data.portfolioTotal.netOperatingIncome,
      'Avg Collection Rate': `${data.portfolioTotal.avgCollectionRate.toFixed(1)}%`,
    },
  };
}
