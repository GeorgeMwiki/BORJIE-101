/**
 * DOCX brander — emits a brand-locked .docx package from an IRDoc.
 *
 * Native DOCX cannot consume CSS variables, so the brander materialises
 * brand colours as hex literals drawn ONLY from `BRAND_COLOR_PALETTE`.
 * The brand-lint step asserts every emitted colour belongs to the
 * palette before the zip is sealed.
 *
 * Footnotes hold span citations (per spec §6). The body keeps the
 * `[citationId]` marker so the citation-verifier (
 * `@borjie/document-studio/citations`) can re-prove the doc post-hoc.
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
const TEXT_BODY = '#0f172a';
const MUTED = '#64748b';
const BRAND_FONT = 'Inter';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
</Relationships>`;

function stripHash(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

function pHeading(text: string, level: 1 | 2 | 3): string {
  const sz = level === 1 ? 48 : level === 2 ? 32 : 24;
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` +
    `<w:r><w:rPr><w:b/><w:sz w:val="${sz}"/>` +
    `<w:color w:val="${stripHash(BRAND_PRIMARY)}"/>` +
    `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
    `</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function pBody(text: string, citationId?: string): string {
  const citeSuffix =
    citationId !== undefined && citationId.length > 0
      ? ` [${escapeXml(citationId)}]`
      : '';
  return (
    `<w:p><w:r><w:rPr>` +
    `<w:sz w:val="22"/>` +
    `<w:color w:val="${stripHash(TEXT_BODY)}"/>` +
    `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
    `</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}${citeSuffix}</w:t></w:r></w:p>`
  );
}

function pMuted(text: string): string {
  return (
    `<w:p><w:r><w:rPr>` +
    `<w:sz w:val="18"/>` +
    `<w:color w:val="${stripHash(MUTED)}"/>` +
    `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
    `</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function pAccent(text: string): string {
  return (
    `<w:p><w:r><w:rPr>` +
    `<w:b/><w:sz w:val="20"/>` +
    `<w:color w:val="${stripHash(BRAND_ACCENT)}"/>` +
    `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
    `</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function buildDocumentXml(doc: IRDoc): string {
  const parts: string[] = [];

  // Header band
  parts.push(pAccent('BORJIE'));
  parts.push(pHeading(doc.title, 1));
  if (doc.subtitle !== undefined && doc.subtitle.length > 0) {
    parts.push(pBody(doc.subtitle));
  }
  parts.push(pMuted(`Generated ${doc.generated_at}`));
  if (doc.watermark === 'draft') {
    parts.push(pAccent('— DRAFT —'));
  }

  for (const section of doc.sections) {
    parts.push(pHeading(section.title, 2));
    for (const block of section.blocks) {
      if (block.kind === 'heading' && block.text !== undefined) {
        parts.push(pHeading(block.text, block.level === 3 ? 3 : 2));
      } else if (block.kind === 'paragraph' && block.text !== undefined) {
        parts.push(pBody(block.text, block.citationId));
      } else if (block.kind === 'kpi_grid' && block.kpis !== undefined) {
        for (const k of block.kpis) {
          parts.push(pAccent(`${k.label}: ${k.value}`));
        }
      } else if (block.kind === 'table') {
        parts.push(renderTable(block.headers ?? [], block.rows ?? []));
      } else if (block.kind === 'chart_placeholder' && block.text !== undefined) {
        parts.push(pMuted(`[Chart: ${block.text}]`));
      } else if (block.kind === 'signature_block' && block.text !== undefined) {
        parts.push(pHeading('Signature', 3));
        parts.push(pBody(block.text));
      }
    }
  }

  // References
  if (doc.citations.length > 0) {
    parts.push(pHeading('References', 2));
    for (const c of doc.citations) {
      parts.push(pMuted(`[${c.id}] ${c.claim} — ${c.source.kind}:${c.source.ref}`));
    }
  }

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${parts.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>` +
    `</w:document>`
  );
}

function renderTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const cell = (text: string, bold = false): string =>
    `<w:tc><w:tcPr><w:tcW w:type="auto"/></w:tcPr><w:p><w:r><w:rPr>` +
    (bold ? '<w:b/>' : '') +
    `<w:sz w:val="20"/>` +
    `<w:color w:val="${stripHash(TEXT_BODY)}"/>` +
    `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
    `</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  const headRow =
    `<w:tr>` + headers.map((h) => cell(h, true)).join('') + `</w:tr>`;
  const bodyRows = rows
    .map((r) => `<w:tr>` + r.map((c) => cell(c, false)).join('') + `</w:tr>`)
    .join('');
  return `<w:tbl>${headRow}${bodyRows}</w:tbl>`;
}

function buildFootnotesXml(doc: IRDoc): string {
  const items = doc.citations
    .map(
      (c) =>
        `<w:footnote w:id="${escapeXml(c.id)}"><w:p><w:r><w:rPr>` +
        `<w:sz w:val="18"/>` +
        `<w:color w:val="${stripHash(MUTED)}"/>` +
        `<w:rFonts w:ascii="${BRAND_FONT}" w:hAnsi="${BRAND_FONT}"/>` +
        `</w:rPr>` +
        `<w:t xml:space="preserve">[${escapeXml(c.id)}] ${escapeXml(c.claim)} — ${escapeXml(c.source.kind)}:${escapeXml(c.source.ref)}</w:t>` +
        `</w:r></w:p></w:footnote>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    items +
    `</w:footnotes>`
  );
}

export interface BrandDocxResult {
  readonly bytes: Buffer;
  readonly checksum: string;
}

/**
 * Render an IRDoc as a brand-locked .docx package.
 * Throws `CompositionError` with code `BRAND_VIOLATION` if the emitted
 * colours or fonts fail brand-lint.
 */
export function brandDocx(doc: IRDoc): BrandDocxResult {
  const colors = [BRAND_PRIMARY, BRAND_ACCENT, TEXT_BODY, MUTED];
  const fonts = [BRAND_FONT];

  const colorLint = validateNativeBrandColors(colors);
  if (!colorLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'docx-brander emitted non-token colour',
      colorLint.violations,
    );
  }
  const fontLint = validateNativeBrandFonts(fonts);
  if (!fontLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'docx-brander emitted unregistered font',
      fontLint.violations,
    );
  }

  const documentXml = buildDocumentXml(doc);
  const footnotesXml = buildFootnotesXml(doc);

  const bytes = writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf-8') },
    { name: 'word/footnotes.xml', data: Buffer.from(footnotesXml, 'utf-8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOC_RELS, 'utf-8') },
  ]);

  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, checksum };
}
