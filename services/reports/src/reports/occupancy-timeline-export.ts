/**
 * Occupancy Timeline Export Helper (NEW 22)
 *
 * Renders an occupancy timeline (unit or portfolio) through the
 * existing reports generators — PDF via PdfGenerator (tabular), PNG via
 * InteractiveHtmlGenerator (headless-browser pipeline supplied by
 * infra).
 *
 * This helper is pure: it shapes domain data into the generator-neutral
 * ReportData structure. Callers (api-gateway / report scheduler) pick
 * which generator to invoke.
 */

import type {
  ReportData,
  ReportGeneratorOptions,
} from '../generators/generator.interface.js';

export interface OccupancyTimelinePeriodInput {
  readonly customerName: string | null;
  readonly from: string;
  readonly to: string | null;
  readonly status: string;
  readonly rent: { readonly amount: number; readonly currency: string } | null;
  readonly exitReason: string | null;
}

export interface OccupancyTimelineExportInput {
  readonly unitId: string;
  readonly propertyId: string;
  readonly periods: readonly OccupancyTimelinePeriodInput[];
  readonly title?: string;
}

export function buildOccupancyTimelineReport(
  input: OccupancyTimelineExportInput
): { options: ReportGeneratorOptions; data: ReportData } {
  const options: ReportGeneratorOptions = {
    title: input.title ?? `Occupancy timeline — unit ${input.unitId}`,
    subtitle: `Property ${input.propertyId}`,
    generatedAt: new Date(),
    metadata: { unitId: input.unitId, propertyId: input.propertyId },
  };

  const rows: (string | number)[][] = input.periods.map((p) => [
    p.customerName ?? 'Vacant',
    p.from,
    p.to ?? 'present',
    p.status,
    p.rent ? `${p.rent.amount} ${p.rent.currency}` : '—',
    p.exitReason ?? '—',
  ]);

  const data: ReportData = {
    sections: [
      {
        title: 'Periods',
        content: `${input.periods.length} occupancy period(s) recorded.`,
        table: {
          headers: ['Tenant', 'From', 'To', 'Status', 'Rent', 'Exit reason'],
          rows,
        },
      },
    ],
    summary: {
      'Total periods': input.periods.length,
    },
  };

  return { options, data };
}
