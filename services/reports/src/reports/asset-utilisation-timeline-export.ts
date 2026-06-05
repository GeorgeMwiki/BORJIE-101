/**
 * Asset-utilisation Timeline Export Helper (NEW 22)
 *
 * Renders an asset-utilisation timeline (unit or portfolio) through the
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

export interface AssetUtilisationTimelinePeriodInput {
  readonly customerName: string | null;
  readonly from: string;
  readonly to: string | null;
  readonly status: string;
  readonly royalty: { readonly amount: number; readonly currency: string } | null;
  readonly exitReason: string | null;
}

export interface AssetUtilisationTimelineExportInput {
  readonly unitId: string;
  readonly siteId: string;
  readonly periods: readonly AssetUtilisationTimelinePeriodInput[];
  readonly title?: string;
}

export function buildAssetUtilisationTimelineReport(
  input: AssetUtilisationTimelineExportInput
): { options: ReportGeneratorOptions; data: ReportData } {
  const options: ReportGeneratorOptions = {
    title: input.title ?? `Asset-utilisation timeline — unit ${input.unitId}`,
    subtitle: `Site ${input.siteId}`,
    generatedAt: new Date(),
    metadata: { unitId: input.unitId, siteId: input.siteId },
  };

  const rows: (string | number)[][] = input.periods.map((p) => [
    p.customerName ?? 'Idle',
    p.from,
    p.to ?? 'present',
    p.status,
    p.royalty ? `${p.royalty.amount} ${p.royalty.currency}` : '—',
    p.exitReason ?? '—',
  ]);

  const data: ReportData = {
    sections: [
      {
        title: 'Periods',
        content: `${input.periods.length} asset-utilisation period(s) recorded.`,
        table: {
          headers: ['Buyer', 'From', 'To', 'Status', 'Royalty', 'Exit reason'],
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
