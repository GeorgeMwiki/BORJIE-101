/**
 * Site Report - Site performance
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface SitePerformanceItem {
  siteId: string;
  siteName: string;
  totalUnits: number;
  producingUnits: number;
  assetUtilisationRate: number;
  revenue: number;
  expenses: number;
  netOperatingIncome: number;
  collectionRate: number;
}

export interface SiteReportData {
  dateRange: DateRange;
  sites: SitePerformanceItem[];
  portfolioTotal: {
    totalUnits: number;
    producingUnits: number;
    assetUtilisationRate: number;
    totalRevenue: number;
    totalExpenses: number;
    netOperatingIncome: number;
    avgCollectionRate: number;
  };
}

export function siteReportToReportData(
  data: SiteReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Site Performance',
    table: {
      headers: [
        'Site',
        'Units',
        'Producing',
        'Asset Utilisation %',
        'Revenue',
        'Expenses',
        'NOI',
        'Collection %',
      ],
      rows: data.sites.map((p) => [
        p.siteName,
        p.totalUnits,
        p.producingUnits,
        `${p.assetUtilisationRate.toFixed(1)}%`,
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
      'Producing Units': data.portfolioTotal.producingUnits,
      'Portfolio Asset Utilisation': `${data.portfolioTotal.assetUtilisationRate.toFixed(1)}%`,
      'Total Revenue': data.portfolioTotal.totalRevenue,
      'Total Expenses': data.portfolioTotal.totalExpenses,
      'Net Operating Income': data.portfolioTotal.netOperatingIncome,
      'Avg Collection Rate': `${data.portfolioTotal.avgCollectionRate.toFixed(1)}%`,
    },
  };
}
