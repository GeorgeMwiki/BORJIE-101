/**
 * Asset-utilisation Report - production rates, idle capacity
 */

import type { ReportData } from '../generators/generator.interface.js';
import type { DateRange } from './report-types.js';

export interface AssetUtilisationBySite {
  siteId: string;
  siteName: string;
  totalUnits: number;
  producingUnits: number;
  idleUnits: number;
  assetUtilisationRate: number;
}

export interface IdleUnitItem {
  unitId: string;
  unitName: string;
  siteName: string;
  daysIdle: number;
  monthlyRoyalty: number;
}

export interface AssetUtilisationReportData {
  dateRange: DateRange;
  totalUnits: number;
  producingUnits: number;
  idleUnits: number;
  assetUtilisationRate: number;
  bySite: AssetUtilisationBySite[];
  idleCapacity: IdleUnitItem[];
}

export function assetUtilisationReportToReportData(
  data: AssetUtilisationReportData
): ReportData {
  const sections: ReportData['sections'] = [];

  sections.push({
    title: 'Asset Utilisation by Site',
    table: {
      headers: ['Site', 'Total Units', 'Producing', 'Idle', 'Asset Utilisation %'],
      rows: data.bySite.map((p) => [
        p.siteName,
        p.totalUnits,
        p.producingUnits,
        p.idleUnits,
        `${p.assetUtilisationRate.toFixed(1)}%`,
      ]),
    },
  });

  sections.push({
    title: 'Idle Units',
    table: {
      headers: ['Unit', 'Site', 'Days Idle', 'Monthly Royalty'],
      rows: data.idleCapacity.map((v) => [
        v.unitName,
        v.siteName,
        v.daysIdle,
        v.monthlyRoyalty,
      ]),
    },
  });

  return {
    sections,
    summary: {
      'Total Units': data.totalUnits,
      'Producing Units': data.producingUnits,
      'Idle Units': data.idleUnits,
      'Asset Utilisation Rate': `${data.assetUtilisationRate.toFixed(1)}%`,
    },
  };
}
