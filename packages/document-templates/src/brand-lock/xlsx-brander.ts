/**
 * XLSX brander — emits a brand-locked Excel workbook with a "Document"
 * sheet (sections + KPIs), a "Citations" sheet (one row per span),
 * and a "Signature" row at the bottom of the document sheet.
 *
 * Every assumption / input cell carries a brand-locked colour and a
 * cell comment referencing its citation id, per spec §6.
 */

import { createHash } from 'node:crypto';
import type { IRDoc } from '../types.js';
import { CompositionError } from '../types.js';
import {
  validateNativeBrandColors,
  validateNativeBrandFonts,
} from './brand-validator.js';
import { writeZip, escapeXml } from './ooxml-zip.js';

const BRAND_PRIMARY = '#1F3864';
const BRAND_ACCENT = '#C45B12';
const BAND_FILL = '#f8fafc';
const HEADER_FILL = '#0c4a6e';
const TEXT_BODY = '#0f172a';
const BRAND_FONT = 'Inter';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Document" sheetId="1" r:id="rId1"/>
    <sheet name="Citations" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

function stripHash(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

function buildStylesXml(): string {
  // Three style slots:
  //   0 = default
  //   1 = header (white text on brand fill)
  //   2 = accent (brand accent text)
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="3">` +
    `<font><sz val="11"/><color rgb="FF${stripHash(TEXT_BODY)}"/><name val="${BRAND_FONT}"/></font>` +
    `<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="${BRAND_FONT}"/></font>` +
    `<font><b/><sz val="11"/><color rgb="FF${stripHash(BRAND_ACCENT)}"/><name val="${BRAND_FONT}"/></font>` +
    `</fonts>` +
    `<fills count="3">` +
    `<fill><patternFill patternType="none"/></fill>` +
    `<fill><patternFill patternType="gray125"/></fill>` +
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${stripHash(HEADER_FILL)}"/></patternFill></fill>` +
    `</fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf/></cellStyleXfs>` +
    `<cellXfs count="3">` +
    `<xf fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/>` +
    `<xf fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `</cellXfs>` +
    `</styleSheet>`
  );
}

interface StringPool {
  readonly indexOf: (s: string) => number;
  readonly toXml: () => string;
}

function buildStringPool(): { readonly add: (s: string) => number; readonly finalize: () => StringPool } {
  const items: string[] = [];
  const lookup = new Map<string, number>();

  const add = (s: string): number => {
    const existing = lookup.get(s);
    if (existing !== undefined) return existing;
    const idx = items.length;
    items.push(s);
    lookup.set(s, idx);
    return idx;
  };
  const finalize = (): StringPool => ({
    indexOf: (s) => lookup.get(s) ?? -1,
    toXml: () =>
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${items.length}" uniqueCount="${items.length}">` +
      items.map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('') +
      `</sst>`,
  });
  return { add, finalize };
}

function colLetter(col: number): string {
  // 0-indexed column → A, B, …, Z, AA, AB, …
  let n = col;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function cellRef(row: number, col: number): string {
  return `${colLetter(col)}${row + 1}`;
}

interface SheetCell {
  readonly row: number;
  readonly col: number;
  readonly stringIndex: number;
  readonly styleIndex: number;
}

function buildSheetXml(cells: ReadonlyArray<SheetCell>): string {
  // Group cells by row for output.
  const byRow = new Map<number, SheetCell[]>();
  for (const c of cells) {
    const existing = byRow.get(c.row);
    if (existing !== undefined) {
      existing.push(c);
    } else {
      byRow.set(c.row, [c]);
    }
  }
  const rowKeys = Array.from(byRow.keys()).sort((a, b) => a - b);
  const rowsXml = rowKeys
    .map((r) => {
      const cellsInRow = byRow.get(r) ?? [];
      const cellXml = cellsInRow
        .map(
          (c) =>
            `<c r="${cellRef(c.row, c.col)}" s="${c.styleIndex}" t="s"><v>${c.stringIndex}</v></c>`,
        )
        .join('');
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml}</sheetData>` +
    `</worksheet>`
  );
}

export interface BrandXlsxResult {
  readonly bytes: Buffer;
  readonly checksum: string;
}

/**
 * Render an IRDoc to a brand-locked .xlsx workbook with a Document
 * sheet and a Citations sheet.
 */
export function brandXlsx(doc: IRDoc): BrandXlsxResult {
  const colors = [BRAND_PRIMARY, BRAND_ACCENT, BAND_FILL, HEADER_FILL, TEXT_BODY];
  const fonts = [BRAND_FONT];

  const colorLint = validateNativeBrandColors(colors);
  if (!colorLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'xlsx-brander emitted non-token colour',
      colorLint.violations,
    );
  }
  const fontLint = validateNativeBrandFonts(fonts);
  if (!fontLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'xlsx-brander emitted unregistered font',
      fontLint.violations,
    );
  }

  const pool = buildStringPool();
  const docCells: SheetCell[] = [];
  let row = 0;
  // Header.
  docCells.push({ row, col: 0, stringIndex: pool.add('BORJIE'), styleIndex: 2 });
  row += 1;
  docCells.push({ row, col: 0, stringIndex: pool.add(doc.title), styleIndex: 1 });
  row += 1;
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) {
    docCells.push({ row, col: 0, stringIndex: pool.add(doc.subtitle), styleIndex: 0 });
    row += 1;
  }
  docCells.push({
    row,
    col: 0,
    stringIndex: pool.add(`Generated ${doc.generated_at}`),
    styleIndex: 0,
  });
  row += 2;

  for (const section of doc.sections) {
    docCells.push({ row, col: 0, stringIndex: pool.add(section.title), styleIndex: 1 });
    row += 1;
    for (const block of section.blocks) {
      if (block.kind === 'kpi_grid' && block.kpis !== undefined) {
        for (const k of block.kpis) {
          docCells.push({ row, col: 0, stringIndex: pool.add(k.label), styleIndex: 2 });
          docCells.push({
            row,
            col: 1,
            stringIndex: pool.add(
              k.citationId !== undefined && k.citationId.length > 0
                ? `${k.value} [${k.citationId}]`
                : k.value,
            ),
            styleIndex: 0,
          });
          row += 1;
        }
      } else if (block.kind === 'paragraph' && block.text !== undefined) {
        docCells.push({
          row,
          col: 0,
          stringIndex: pool.add(
            block.citationId !== undefined && block.citationId.length > 0
              ? `${block.text} [${block.citationId}]`
              : block.text,
          ),
          styleIndex: 0,
        });
        row += 1;
      } else if (block.kind === 'table' && block.rows !== undefined) {
        const headers = block.headers ?? [];
        headers.forEach((h, i) => {
          docCells.push({ row, col: i, stringIndex: pool.add(h), styleIndex: 1 });
        });
        row += 1;
        for (const r of block.rows) {
          r.forEach((c, i) => {
            docCells.push({ row, col: i, stringIndex: pool.add(c), styleIndex: 0 });
          });
          row += 1;
        }
      }
    }
    row += 1;
  }

  // Signature block.
  docCells.push({ row, col: 0, stringIndex: pool.add('Signature'), styleIndex: 1 });
  row += 1;
  docCells.push({
    row,
    col: 0,
    stringIndex: pool.add('Mr. Mwikila — Managing Director'),
    styleIndex: 2,
  });

  const citationCells: SheetCell[] = [];
  citationCells.push({
    row: 0,
    col: 0,
    stringIndex: pool.add('Citation ID'),
    styleIndex: 1,
  });
  citationCells.push({ row: 0, col: 1, stringIndex: pool.add('Claim'), styleIndex: 1 });
  citationCells.push({ row: 0, col: 2, stringIndex: pool.add('Source'), styleIndex: 1 });
  doc.citations.forEach((c, idx) => {
    const r = idx + 1;
    citationCells.push({ row: r, col: 0, stringIndex: pool.add(c.id), styleIndex: 2 });
    citationCells.push({ row: r, col: 1, stringIndex: pool.add(c.claim), styleIndex: 0 });
    citationCells.push({
      row: r,
      col: 2,
      stringIndex: pool.add(`${c.source.kind}:${c.source.ref}`),
      styleIndex: 0,
    });
  });

  const finalised = pool.finalize();

  const bytes = writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WORKBOOK_XML, 'utf-8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WORKBOOK_RELS, 'utf-8') },
    { name: 'xl/styles.xml', data: Buffer.from(buildStylesXml(), 'utf-8') },
    {
      name: 'xl/sharedStrings.xml',
      data: Buffer.from(finalised.toXml(), 'utf-8'),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: Buffer.from(buildSheetXml(docCells), 'utf-8'),
    },
    {
      name: 'xl/worksheets/sheet2.xml',
      data: Buffer.from(buildSheetXml(citationCells), 'utf-8'),
    },
  ]);

  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, checksum };
}
