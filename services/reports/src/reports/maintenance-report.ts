/**
 * Maintenance Report - Work orders, costs, SLA compliance
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface WorkOrderItem {
  workOrderId: string;
  unitName: string;
  propertyName: string;
  category: string;
  priority: string;
  status: string;
  cost: number;
  createdAt: Date;
  completedAt?: Date;
  resolutionDays?: number;
  slaMet: boolean;
}

export interface MaintenanceByCategory {
  category: string;
  count: number;
  cost: number;
}

export interface MaintenanceReportData {
  dateRange: DateRange;
  totalWorkOrders: number;
  completed: number;
  open: number;
  totalCost: number;
  slaComplianceRate: number;
  avgResolutionDays: number;
  byCategory: MaintenanceByCategory[];
  workOrders: WorkOrderItem[];
}

export function maintenanceReportToReportData(
  data: MaintenanceReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Work Orders',
    table: {
      headers: [
        'ID',
        'Unit',
        'Property',
        'Category',
        'Priority',
        'Status',
        'Cost',
        'SLA Met',
      ],
      rows: data.workOrders.map((w) => [
        w.workOrderId.slice(0, 8),
        w.unitName,
        w.propertyName,
        w.category,
        w.priority,
        w.status,
        w.cost,
        w.slaMet ? 'Yes' : 'No',
      ]),
    },
  });

  sections.push({
    title: 'Cost by Category',
    table: {
      headers: ['Category', 'Count', 'Cost'],
      rows: data.byCategory.map((c) => [c.category, c.count, c.cost]),
    },
  });

  return {
    sections,
    summary: {
      'Total Work Orders': data.totalWorkOrders,
      'Completed': data.completed,
      'Open': data.open,
      'Total Cost': data.totalCost,
      'SLA Compliance': `${data.slaComplianceRate.toFixed(1)}%`,
      'Avg Resolution Days': data.avgResolutionDays.toFixed(1),
    },
  };
}
