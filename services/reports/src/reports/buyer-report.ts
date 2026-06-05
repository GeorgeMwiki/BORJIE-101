/**
 * Buyer Report - Buyer list, outstanding royalties, supply-agreement expiry
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface BuyerItem {
  buyerId: string;
  customerName: string;
  unitName: string;
  siteName: string;
  monthlyRoyalty: number;
  status: string;
  supplyStartDate: Date;
  supplyEndDate: Date;
  outstanding: number;
  daysUntilExpiry: number;
}

export interface OutstandingItem {
  buyerId: string;
  customerName: string;
  unitName: string;
  outstanding: number;
  daysOverdue: number;
}

export interface SupplyExpiryItem {
  buyerId: string;
  customerName: string;
  unitName: string;
  supplyEndDate: Date;
  daysUntilExpiry: number;
}

export interface BuyerReportData {
  dateRange: DateRange;
  totalBuyers: number;
  buyers: BuyerItem[];
  outstanding: OutstandingItem[];
  supplyExpiries: SupplyExpiryItem[];
  totalOutstanding: number;
}

export function buyerReportToReportData(
  data: BuyerReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Buyer List',
    table: {
      headers: [
        'Buyer',
        'Unit',
        'Site',
        'Royalty',
        'Status',
        'Supply End',
        'Outstanding',
      ],
      rows: data.buyers.map((t) => [
        t.customerName,
        t.unitName,
        t.siteName,
        t.monthlyRoyalty,
        t.status,
        t.supplyEndDate.toISOString().slice(0, 10),
        t.outstanding,
      ]),
    },
  });

  sections.push({
    title: 'Buyers with Outstanding Royalties',
    table: {
      headers: ['Buyer', 'Unit', 'Outstanding', 'Days Overdue'],
      rows: data.outstanding.map((a) => [
        a.customerName,
        a.unitName,
        a.outstanding,
        a.daysOverdue,
      ]),
    },
  });

  sections.push({
    title: 'Supply-Agreement Expiries',
    table: {
      headers: ['Buyer', 'Unit', 'Supply End', 'Days Until Expiry'],
      rows: data.supplyExpiries.map((l) => [
        l.customerName,
        l.unitName,
        l.supplyEndDate.toISOString().slice(0, 10),
        l.daysUntilExpiry,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Buyers': data.totalBuyers,
      'Buyers with Outstanding Royalties': data.outstanding.length,
      'Supply Agreements Expiring Soon': data.supplyExpiries.length,
      'Total Outstanding': data.totalOutstanding,
    },
  };
}
