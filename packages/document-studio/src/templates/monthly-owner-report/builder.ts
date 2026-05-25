/**
 * Monthly Owner Report — builder.
 *
 * Validates request data, looks up the Carbone template path, fans out
 * to the Carbone renderer for DOCX + PDF, and returns the raw
 * artefacts. Citation enrichment + WORM logging happen one layer up
 * in `studio.generate()`.
 */

import {
  MIME_TYPES,
  type DocFormat,
  type RenderedArtifact,
  type Renderer,
} from '../../types.js';
import { sha256Hex } from '../../citations/citation-verifier.js';
import {
  MonthlyOwnerReportDataSchema,
  type MonthlyOwnerReportData,
} from './data-schema.js';

export const MONTHLY_OWNER_REPORT_TEMPLATE_REF =
  'monthly-owner-report/template.docx';

export const MONTHLY_OWNER_REPORT_DEFAULT_FORMATS: ReadonlyArray<DocFormat> =
  Object.freeze(['docx', 'pdf']);

export interface MonthlyOwnerReportBuildInput {
  readonly data: unknown;
  readonly formats?: ReadonlyArray<DocFormat>;
  readonly renderer: Renderer;
}

export async function buildMonthlyOwnerReport(
  input: MonthlyOwnerReportBuildInput,
): Promise<ReadonlyArray<RenderedArtifact>> {
  const data: MonthlyOwnerReportData =
    MonthlyOwnerReportDataSchema.parse(input.data);
  const formats =
    input.formats && input.formats.length > 0
      ? input.formats
      : MONTHLY_OWNER_REPORT_DEFAULT_FORMATS;

  const artifacts: RenderedArtifact[] = [];
  for (const format of formats) {
    if (format !== 'docx' && format !== 'pdf') {
      throw new Error(
        `Monthly owner report supports docx|pdf only; got ${format}`,
      );
    }
    const rendered = await input.renderer.render({
      templateRef: MONTHLY_OWNER_REPORT_TEMPLATE_REF,
      format,
      data,
    });
    artifacts.push({
      format,
      mimeType: rendered.mimeType ?? MIME_TYPES[format],
      buffer: rendered.buffer,
      sha256: sha256Hex(rendered.buffer),
    });
  }
  return artifacts;
}
