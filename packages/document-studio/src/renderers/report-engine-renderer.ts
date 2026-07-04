/**
 * @borjie/document-studio — REAL renderer backed by @borjie/report-engine.
 *
 * This is the honest, dependency-free document synthesizer that replaces the
 * `STUB:<id>:<format>:...` placeholder bytes the offline stub emits. The
 * report-engine package ships hand-rolled OOXML/PDF synthesizers (no vendor
 * SDK, no browser, no network) that produce GENUINE documents:
 *
 *   - docx → a valid OOXML zip  (magic `PK\x03\x04`)
 *   - pptx → a valid OOXML zip  (magic `PK\x03\x04`)
 *   - pdf  → a valid PDF 1.4    (magic `%PDF`)
 *
 * The studio's `Renderer` port speaks `{ templateRef, format, data }` where
 * `data` is the bound document `view` (arbitrary JSON per doc-type). The
 * report-engine synthesizers speak `{ title, subtitle, sections, brand }`.
 * This adapter is the clean seam between the two: it projects the view into
 * report-engine sections and delegates to the real synthesizer.
 *
 * Two formats report-engine does not natively emit are synthesized here with
 * the SAME dependency-free technique so the renderer covers all five studio
 * formats with real bytes:
 *
 *   - xlsx → a valid OOXML spreadsheet zip (magic `PK\x03\x04`), built from
 *            report-engine's `writeZip` + `escapeXml`.
 *   - html → a real, self-contained HTML document.
 *
 * NOTHING here reads env, opens a socket, spawns a binary, or returns a
 * `STUB:` marker. It is safe to construct in any environment and always
 * produces an openable document.
 */

import {
  renderReportDocx,
  renderReportPptx,
  renderReportPdf,
  writeZip,
  escapeXml,
  type ResolvedReportSection,
  type ReportTableData,
  type ReportKpiGridData,
  type TenantBrand,
} from '@borjie/report-engine';

import {
  MIME_TYPES,
  type DocFormat,
  type Renderer,
  type RendererInput,
  type RendererOutput,
} from '../types.js';

/** Brand applied to every synthesized document (deterministic, no env). */
const DEFAULT_BRAND: TenantBrand = Object.freeze({
  displayName: 'Borjie',
  primaryColor: '#1F3864',
  accentColor: '#C45B12',
  fontFamily: 'Calibri',
});

/**
 * A scalar the section-projection renders inline. Objects/arrays are recursed
 * into their own sections/tables so an arbitrary view still produces a real,
 * information-bearing document (never an empty shell).
 */
type Scalar = string | number | boolean;

function isScalar(v: unknown): v is Scalar {
  return (
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  );
}

/** Humanize a camelCase / snake_case key into a Title-Case label. */
function humanize(key: string): string {
  const spaced = key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Project an array of uniform objects into a report table (header row from the
 * union of keys, one row per element). Returns `null` when the array is not a
 * clean array-of-objects (the caller then recurses element-by-element).
 */
function arrayToTable(arr: readonly unknown[]): ReportTableData | null {
  if (arr.length === 0) return null;
  const objects = arr.filter(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === 'object' && !Array.isArray(e),
  );
  if (objects.length !== arr.length) return null;

  const headerSet = new Set<string>();
  for (const obj of objects) {
    for (const k of Object.keys(obj)) headerSet.add(k);
  }
  const headers = [...headerSet];
  const rows = objects.map((obj) =>
    headers.map((h) => {
      const cell = obj[h];
      return isScalar(cell) ? String(cell) : JSON.stringify(cell ?? '');
    }),
  );
  return { headers: headers.map(humanize), rows };
}

/** A flat object of scalars → a two-column key/value KPI-style table. */
function scalarObjectToTable(
  obj: Record<string, unknown>,
): ReportTableData | null {
  const entries = Object.entries(obj).filter(([, v]) => isScalar(v));
  if (entries.length === 0) return null;
  return {
    headers: ['Field', 'Value'],
    rows: entries.map(([k, v]) => [humanize(k), String(v)]),
  };
}

/**
 * Walk a bound `view` object into report-engine sections. Every nested object
 * becomes a section; every array-of-objects becomes a table; scalar leaves are
 * collected into a summary table. This keeps the real document faithful to the
 * view regardless of which doc-type produced it (open-ended registry).
 */
function projectViewToSections(view: unknown): ResolvedReportSection[] {
  const sections: ResolvedReportSection[] = [];

  if (!view || typeof view !== 'object') {
    // A bare scalar / null view still yields a real, non-empty document.
    sections.push({
      section_id: 'body',
      title: 'Document',
      kind: 'narrative',
      narrative: String(view ?? ''),
    });
    return sections;
  }

  const record = view as Record<string, unknown>;
  const scalarFields: Record<string, unknown> = {};
  let idx = 0;

  for (const [key, value] of Object.entries(record)) {
    if (isScalar(value)) {
      scalarFields[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const table = arrayToTable(value);
      if (table) {
        sections.push({
          section_id: `arr_${idx++}`,
          title: humanize(key),
          kind: 'table',
          table,
        });
      } else {
        // Non-uniform array: render each entry's JSON as narrative lines.
        sections.push({
          section_id: `arr_${idx++}`,
          title: humanize(key),
          kind: 'narrative',
          narrative: value
            .map((e) => (isScalar(e) ? String(e) : JSON.stringify(e)))
            .join('\n'),
        });
      }
      continue;
    }
    if (value && typeof value === 'object') {
      const table = scalarObjectToTable(value as Record<string, unknown>);
      sections.push({
        section_id: `obj_${idx++}`,
        title: humanize(key),
        kind: table ? 'table' : 'narrative',
        ...(table ? { table } : { narrative: JSON.stringify(value) }),
      });
    }
  }

  // Prepend the collected scalar summary so top-level fields lead the doc.
  const summary = scalarObjectToTable(scalarFields);
  if (summary) {
    sections.unshift({
      section_id: 'summary',
      title: 'Summary',
      kind: 'kpi_grid',
      kpi_grid: scalarSummaryGrid(scalarFields),
    });
  }

  if (sections.length === 0) {
    sections.push({
      section_id: 'body',
      title: 'Document',
      kind: 'narrative',
      narrative: JSON.stringify(view),
    });
  }
  return sections;
}

/** Scalar fields → a KPI grid (label/value) for a rich header block. */
function scalarSummaryGrid(
  scalarFields: Record<string, unknown>,
): ReportKpiGridData {
  return {
    metrics: Object.entries(scalarFields).map(([k, v]) => ({
      label: humanize(k),
      value: String(v),
    })),
  };
}

/** Derive a human title from the view or templateRef. */
function deriveTitle(view: unknown, templateRef: string): string {
  if (view && typeof view === 'object') {
    const rec = view as Record<string, unknown>;
    for (const key of ['title', 'documentTitle', 'heading', 'name']) {
      const v = rec[key];
      if (typeof v === 'string' && v.trim().length > 0) return v;
    }
    const labels = rec['labels'];
    if (labels && typeof labels === 'object') {
      const t = (labels as Record<string, unknown>)['title'];
      if (typeof t === 'string' && t.trim().length > 0) return t;
    }
  }
  // Fall back to the template stem: `offtake-settlement/template.xlsx` → title.
  const stem = templateRef.split('/')[0] ?? templateRef;
  return humanize(stem.replace(/\.[a-z]+$/i, ''));
}

// ── Real XLSX synthesizer (dependency-free OOXML spreadsheet) ─────────────

/** Column letter for a zero-based column index (0→A, 26→AA). */
function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** One `<row>` of inline-string cells. */
function xlsxRow(rowIndex: number, cells: readonly string[]): string {
  const cellXml = cells
    .map((cell, col) => {
      const ref = `${colLetter(col)}${rowIndex}`;
      return (
        `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">` +
        `${escapeXml(cell)}</t></is></c>`
      );
    })
    .join('');
  return `<row r="${rowIndex}">${cellXml}</row>`;
}

/**
 * Flatten the projected sections into worksheet rows: a title row, then each
 * section's heading + its rows (tables/kpi/narrative), so an offtake worksheet
 * lands as a real, openable .xlsx.
 */
function sectionsToSheetRows(
  title: string,
  sections: readonly ResolvedReportSection[],
): string[][] {
  const rows: string[][] = [[title]];
  for (const section of sections) {
    rows.push([]); // spacer
    rows.push([section.title]);
    if (section.kind === 'table' && section.table) {
      rows.push([...section.table.headers]);
      for (const r of section.table.rows) rows.push(r.map((c) => String(c)));
    } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
      for (const m of section.kpi_grid.metrics) {
        rows.push([m.label, String(m.value), m.delta ?? '']);
      }
    } else if (section.kind === 'narrative' && section.narrative) {
      for (const line of section.narrative.split(/\r?\n/)) rows.push([line]);
    }
  }
  return rows;
}

const XLSX_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const XLSX_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const XLSX_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

const XLSX_WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

/** Synthesize a real .xlsx from the projected sections. */
function renderXlsx(title: string, sections: readonly ResolvedReportSection[]): Uint8Array {
  const sheetRows = sectionsToSheetRows(title, sections);
  const rowsXml = sheetRows
    .map((cells, i) => xlsxRow(i + 1, cells))
    .join('');
  const sheetXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml}</sheetData>` +
    '</worksheet>';

  return new Uint8Array(
    writeZip([
      { name: '[Content_Types].xml', data: Buffer.from(XLSX_CONTENT_TYPES, 'utf-8') },
      { name: '_rels/.rels', data: Buffer.from(XLSX_ROOT_RELS, 'utf-8') },
      { name: 'xl/workbook.xml', data: Buffer.from(XLSX_WORKBOOK, 'utf-8') },
      { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(XLSX_WORKBOOK_RELS, 'utf-8') },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheetXml, 'utf-8') },
    ]),
  );
}

// ── Real HTML synthesizer ─────────────────────────────────────────────────

function renderHtml(title: string, sections: readonly ResolvedReportSection[]): Uint8Array {
  const body = sections
    .map((section) => {
      let inner = `<h2>${escapeXml(section.title)}</h2>`;
      if (section.kind === 'table' && section.table) {
        const head = section.table.headers
          .map((h) => `<th>${escapeXml(h)}</th>`)
          .join('');
        const rows = section.table.rows
          .map(
            (r) =>
              `<tr>${r.map((c) => `<td>${escapeXml(String(c))}</td>`).join('')}</tr>`,
          )
          .join('');
        inner += `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
      } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
        inner += section.kpi_grid.metrics
          .map(
            (m) =>
              `<p><strong>${escapeXml(m.label)}:</strong> ${escapeXml(String(m.value))}</p>`,
          )
          .join('');
      } else if (section.kind === 'narrative' && section.narrative) {
        inner += section.narrative
          .split(/\r?\n/)
          .map((line) => `<p>${escapeXml(line)}</p>`)
          .join('');
      }
      return `<section>${inner}</section>`;
    })
    .join('');

  const html =
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
    `<title>${escapeXml(title)}</title></head>` +
    `<body><h1>${escapeXml(title)}</h1>${body}</body></html>`;
  return new TextEncoder().encode(html);
}

/**
 * The real, dependency-free renderer. One instance covers every engine hint
 * (typst/carbone/html-pdf) because the underlying synthesizers are format-
 * driven, not engine-driven — the factory routes engine→renderer, and this
 * renderer honours the requested `format` with genuine bytes.
 */
export class ReportEngineRenderer implements Renderer {
  public readonly id: string;
  private readonly brand: TenantBrand;

  constructor(options?: { readonly id?: string; readonly brand?: TenantBrand }) {
    this.id = options?.id ?? 'report-engine';
    this.brand = options?.brand ?? DEFAULT_BRAND;
  }

  async render<TData>(input: RendererInput<TData>): Promise<RendererOutput> {
    const format = input.format;
    const title = deriveTitle(input.data, input.templateRef);
    const sections = projectViewToSections(input.data);
    const generatedAt = new Date(0); // deterministic — reproducible sha256.

    switch (format) {
      case 'docx': {
        const file = renderReportDocx({
          title,
          sections,
          brand: this.brand,
          generatedAt,
        });
        return { buffer: new Uint8Array(file.buffer), mimeType: MIME_TYPES.docx };
      }
      case 'pptx': {
        const file = renderReportPptx({
          title,
          sections,
          brand: this.brand,
          generatedAt,
        });
        return { buffer: new Uint8Array(file.buffer), mimeType: MIME_TYPES.pptx };
      }
      case 'pdf': {
        const file = renderReportPdf({
          title,
          sections,
          brand: this.brand,
          generatedAt,
        });
        return { buffer: new Uint8Array(file.buffer), mimeType: MIME_TYPES.pdf };
      }
      case 'xlsx': {
        return { buffer: renderXlsx(title, sections), mimeType: MIME_TYPES.xlsx };
      }
      case 'html': {
        return { buffer: renderHtml(title, sections), mimeType: MIME_TYPES.html };
      }
      default: {
        // Exhaustiveness guard — a new DocFormat must add a case here.
        const never: never = format;
        return {
          buffer: new Uint8Array(0),
          mimeType: 'application/json',
          error: {
            code: 'unsupported_format',
            message: `report-engine renderer: unsupported format '${String(never)}'`,
            origin: this.id,
          },
        };
      }
    }
  }
}

/** MIME map re-export kept local so the switch reads cleanly. */
export const REPORT_ENGINE_RENDERER_FORMATS: ReadonlyArray<DocFormat> = [
  'docx',
  'pdf',
  'pptx',
  'xlsx',
  'html',
];
