/**
 * Tenant Report - Tenant list, arrears, lease expiry
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface TenantItem {
  tenantId: string;
  customerName: string;
  unitName: string;
  propertyName: string;
  monthlyRent: number;
  status: string;
  leaseStartDate: Date;
  leaseEndDate: Date;
  arrears: number;
  daysUntilExpiry: number;
}

export interface ArrearsItem {
  tenantId: string;
  customerName: string;
  unitName: string;
  arrears: number;
  daysOverdue: number;
}

export interface LeaseExpiryItem {
  tenantId: string;
  customerName: string;
  unitName: string;
  leaseEndDate: Date;
  daysUntilExpiry: number;
}

export interface TenantReportData {
  dateRange: DateRange;
  totalTenants: number;
  tenants: TenantItem[];
  arrears: ArrearsItem[];
  leaseExpiries: LeaseExpiryItem[];
  totalArrears: number;
}

export function tenantReportToReportData(
  data: TenantReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Tenant List',
    table: {
      headers: [
        'Tenant',
        'Unit',
        'Property',
        'Rent',
        'Status',
        'Lease End',
        'Arrears',
      ],
      rows: data.tenants.map((t) => [
        t.customerName,
        t.unitName,
        t.propertyName,
        t.monthlyRent,
        t.status,
        t.leaseEndDate.toISOString().slice(0, 10),
        t.arrears,
      ]),
    },
  });

  sections.push({
    title: 'Tenants in Arrears',
    table: {
      headers: ['Tenant', 'Unit', 'Arrears', 'Days Overdue'],
      rows: data.arrears.map((a) => [
        a.customerName,
        a.unitName,
        a.arrears,
        a.daysOverdue,
      ]),
    },
  });

  sections.push({
    title: 'Lease Expiries',
    table: {
      headers: ['Tenant', 'Unit', 'Lease End', 'Days Until Expiry'],
      rows: data.leaseExpiries.map((l) => [
        l.customerName,
        l.unitName,
        l.leaseEndDate.toISOString().slice(0, 10),
        l.daysUntilExpiry,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Tenants': data.totalTenants,
      'Tenants in Arrears': data.arrears.length,
      'Leases Expiring Soon': data.leaseExpiries.length,
      'Total Arrears': data.totalArrears,
    },
  };
}
