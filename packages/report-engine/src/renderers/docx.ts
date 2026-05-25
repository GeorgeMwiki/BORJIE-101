/**
 * Hand-rolled .docx renderer for the report engine.
 *
 * Why hand-rolled? The repo's existing pattern in
 * `services/domain-services/.../docx-fallback-synthesizer.ts` is to
 * synthesize the minimal OOXML package without pulling in a binary
 * dependency. We follow that pattern here — write the four required
 * parts ([Content_Types].xml, _rels/.rels, word/document.xml,
 * word/_rels/document.xml.rels) and pack them with `ooxml-zip`.
 *
 * Output supports:
 *   - heading + body paragraphs
 *   - simple tables (header row + data rows)
 *   - KPI grid (rendered as a labelled table)
 *   - chart placeholder (rendered as italic note pointing at chart title)
 *
 * The output is a VALID .docx that opens cleanly in Word, LibreOffice,
 * and Google Docs. Visual polish (styles, themes, embedded images) is
 * deliberately deferred — we trade fidelity for zero new deps.
 *
 * If a tenant wants pixel-perfect Word output, the renderer can be
 * upgraded to docxtemplater + a real .docx template; the orchestrator
 * exposes a `renderer` injection point for exactly that.
 */

import type {
  RenderedReportFile,
  ResolvedReportSection,
  TenantBrand,
} from '../types.js';
import { writeZip, escapeXml } from '../ooxml-zip.js';
import { sanitizeFilename } from './pdf.js';

export interface RenderDocxInput {
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly ResolvedReportSection[];
  readonly brand: TenantBrand;
  readonly generatedAt: Date;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function pHeading(text: string, level: 1 | 2 | 3, brand: TenantBrand): string {
  const sz = level === 1 ? 48 : level === 2 ? 32 : 24;
  const color = (brand.primaryColor ?? '#1F3864').replace('#', '');
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:sz w:val="${sz}"/><w:color w:val="${color}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function pBody(text: string): string {
  return (
    `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function pMuted(text: string): string {
  return (
    `<w:p><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="666666"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function tableCell(text: string, opts?: { bold?: boolean }): string {
  const bold = opts?.bold ? '<w:b/>' : '';
  return (
    `<w:tc><w:tcPr><w:tcW w:type="auto"/></w:tcPr><w:p><w:r>` +
    `<w:rPr><w:sz w:val="20"/>${bold}</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

function renderTable(
  headers: readonly string[],
  rows: ReadonlyArray<readonly (string | number)[]>,
): string {
  const tblPr =
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:bottom w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:left w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:right w:val="single" w:sz="4" w:color="CCCCCC"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="EEEEEE"/>' +
    '<w:insideV w:val="single" w:sz="4" w:color="EEEEEE"/>' +
    '</w:tblBorders></w:tblPr>';

  const headerRow =
    '<w:tr>' +
    headers.map((h) => tableCell(h, { bold: true })).join('') +
    '</w:tr>';

  const bodyRows = rows
    .map(
      (r) =>
        '<w:tr>' +
        r.map((cell) => tableCell(String(cell ?? ''))).join('') +
        '</w:tr>',
    )
    .join('');

  return `<w:tbl>${tblPr}${headerRow}${bodyRows}</w:tbl>`;
}

function renderKpiGrid(
  metrics: ReadonlyArray<{
    readonly label: string;
    readonly value: string | number;
    readonly delta?: string;
  }>,
): string {
  const rows = metrics.map((m) => [
    m.label,
    String(m.value),
    m.delta ?? '',
  ]);
  return renderTable(['Metric', 'Value', 'Delta'], rows);
}

function buildDocumentXml(input: RenderDocxInput): string {
  const parts: string[] = [];
  parts.push(pMuted(input.brand.displayName));
  parts.push(pHeading(input.title, 1, input.brand));
  if (input.subtitle) {
    parts.push(pBody(input.subtitle));
  }
  parts.push(
    pMuted(
      `Generated: ${input.generatedAt.toISOString().slice(0, 19).replace('T', ' ')}`,
    ),
  );

  for (const section of input.sections) {
    parts.push(pHeading(section.title, 2, input.brand));
    if (section.kind === 'narrative' && section.narrative) {
      const paragraphs = section.narrative.split(/\n\n+/);
      for (const para of paragraphs) {
        parts.push(pBody(para));
      }
    } else if (section.kind === 'table' && section.table) {
      parts.push(renderTable(section.table.headers, section.table.rows));
    } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
      parts.push(renderKpiGrid(section.kpi_grid.metrics));
    } else if (section.kind === 'chart' && section.chart) {
      parts.push(pMuted(`[Chart: ${section.chart.title ?? 'unnamed'}]`));
    }
  }

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body>` +
    '</w:document>'
  );
}

/** Render the resolved report into a .docx buffer. */
export function renderReportDocx(input: RenderDocxInput): RenderedReportFile {
  const documentXml = buildDocumentXml(input);
  const buffer = writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf-8') },
    {
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(DOC_RELS, 'utf-8'),
    },
  ]);
  return {
    format: 'docx',
    buffer,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filename: `${sanitizeFilename(input.title)}.docx`,
  };
}

// Exported for unit tests so we can assert XML shape without unzipping.
export const __test__ = {
  buildDocumentXml,
  renderTable,
  renderKpiGrid,
  pBody,
  pHeading,
};
