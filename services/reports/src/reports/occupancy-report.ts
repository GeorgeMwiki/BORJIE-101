/**
 * Occupancy Report - Occupancy rates, vacancies
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface OccupancyByProperty {
  propertyId: string;
  propertyName: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRate: number;
}

export interface VacancyItem {
  unitId: string;
  unitName: string;
  propertyName: string;
  daysVacant: number;
  monthlyRent: number;
}

export interface OccupancyReportData {
  dateRange: DateRange;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRate: number;
  byProperty: OccupancyByProperty[];
  vacancies: VacancyItem[];
}

export function occupancyReportToReportData(
  data: OccupancyReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Occupancy by Property',
    table: {
      headers: ['Property', 'Total Units', 'Occupied', 'Vacant', 'Occupancy %'],
      rows: data.byProperty.map((p) => [
        p.propertyName,
        p.totalUnits,
        p.occupiedUnits,
        p.vacantUnits,
        `${p.occupancyRate.toFixed(1)}%`,
      ]),
    },
  });

  sections.push({
    title: 'Vacant Units',
    table: {
      headers: ['Unit', 'Property', 'Days Vacant', 'Monthly Rent'],
      rows: data.vacancies.map((v) => [
        v.unitName,
        v.propertyName,
        v.daysVacant,
        v.monthlyRent,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Units': data.totalUnits,
      'Occupied Units': data.occupiedUnits,
      'Vacant Units': data.vacantUnits,
      'Occupancy Rate': `${data.occupancyRate.toFixed(1)}%`,
    },
  };
}
