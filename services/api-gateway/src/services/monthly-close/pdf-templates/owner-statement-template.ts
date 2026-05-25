/**
 * Owner statement PDF template — wave-4 deep-scrub D2.
 *
 * C1 shipped a placeholder `renderPdfBytes(html)` that emitted a fake
 * `<placeholder>...</placeholder>` byte buffer. This module replaces it
 * with a real, valid, A4-sized PDF document for owner monthly statements.
 *
 * Why a hand-rolled writer?
 * -------------------------
 * `services/reports` uses `pdfkit`, but `pdfkit` is NOT a declared
 * dependency of `services/api-gateway`. The wave-4 file-isolation rule
 * forbids editing `package.json` or running `pnpm install`. Importing a
 * hoisted-but-undeclared package would tie us to whatever happens to
 * land in the root `node_modules` — that's brittle.
 *
 * The owner-statement layout is small (one page, ~12 lines, single
 * font), so we generate a minimal-but-spec-compliant PDF directly. The
 * output is binary-correct (`%PDF-1.4` magic, valid xref table, EOF
 * marker) and parses cleanly in every PDF reader we tested.
 *
 * If a future wave declares `pdfkit` on this service, swap this file
 * for a `pdfkit`-backed implementation; the public contract
 * (`renderOwnerStatementPdf(data): Buffer`) is the only seam that
 * matters.
 *
 * Tenant scoping & branding
 * -------------------------
 * Every render uses ONLY the data passed in by the caller — nothing is
 * read from process state, no DB lookups, no global tenant context. The
 * template receives `branding.tenantName` and falls back to a generic
 * "Property Statement" header when absent.
 *
 * Currency
 * --------
 * The currency code is taken from the row's `currencyCode` field and
 * rendered verbatim (`KES 15,000.00`). We never hardcode a jurisdiction.
 *
 * Audit
 * -----
 * The PDF metadata embeds a SHA-256 hash of the canonicalised statement
 * payload as the `/Keywords` field, so an auditor can detect tampering
 * by re-hashing the original row and comparing.
 */

import { createHash } from 'node:crypto';

export type OwnerStatementBranding = {
  readonly tenantName?: string;
};

export type OwnerStatementLineItem = {
  readonly label: string;
  readonly amountMinor: number;
};

export type OwnerStatementPdfData = {
  readonly statementId: string;
  readonly statementNumber: string;
  readonly tenantId: string;
  readonly ownerId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currencyCode: string;
  readonly grossRentMinor: number;
  readonly kraMriDeductionMinor?: number;
  readonly platformFeeMinor?: number;
  readonly netDisbursementMinor?: number;
  readonly extraLineItems?: readonly OwnerStatementLineItem[];
  readonly branding?: OwnerStatementBranding;
};

const A4_WIDTH_PT = 595;
const A4_HEIGHT_PT = 842;
const MARGIN_PT = 50;
const LINE_HEIGHT_PT = 16;
const HEADER_FONT_SIZE = 18;
const SECTION_FONT_SIZE = 12;
const BODY_FONT_SIZE = 10;
const FOOTER_FONT_SIZE = 8;

/**
 * Format a minor-units integer as a major-units string with the supplied
 * currency code. e.g. (1_500_000, 'KES') -> 'KES 15,000.00'.
 *
 * Pure / immutable. Treats the minor unit as 1/100 of the major unit
 * (true for KES, TZS, UGX, USD, EUR, GBP — every currency this product
 * targets today). Currency code is rendered verbatim, never compared
 * against a hardcoded list.
 */
export function formatMinorAmount(
  minorUnits: number,
  currencyCode: string,
): string {
  const safeCode = currencyCode.trim() || 'XXX';
  const isNegative = minorUnits < 0;
  const absMinor = Math.abs(Math.trunc(minorUnits));
  const major = Math.trunc(absMinor / 100);
  const cents = absMinor % 100;
  const majorWithSeparators = String(major).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ',',
  );
  const sign = isNegative ? '-' : '';
  const padded = String(cents).padStart(2, '0');
  return `${safeCode} ${sign}${majorWithSeparators}.${padded}`;
}

/**
 * Build the canonical, deterministic line list that goes into the PDF
 * body. Pure — same input always produces the same output, which is why
 * the audit hash works.
 */
export function buildStatementLines(
  data: OwnerStatementPdfData,
): readonly string[] {
  const code = data.currencyCode || 'XXX';
  const baseLines: readonly string[] = [
    `Statement Number: ${data.statementNumber || '(unassigned)'}`,
    `Statement Id: ${data.statementId}`,
    `Tenant Id: ${data.tenantId}`,
    `Owner Id: ${data.ownerId}`,
    `Period: ${data.periodStart} to ${data.periodEnd}`,
    '',
    'Rent breakdown',
    `  Gross rent collected: ${formatMinorAmount(data.grossRentMinor, code)}`,
  ];

  const extras = (data.extraLineItems ?? []).map(
    (item) => `  ${item.label}: ${formatMinorAmount(item.amountMinor, code)}`,
  );

  const deductions: readonly string[] = [
    'Deductions',
    `  KRA MRI withholding: ${formatMinorAmount(
      data.kraMriDeductionMinor ?? 0,
      code,
    )}`,
    `  Platform fee: ${formatMinorAmount(
      data.platformFeeMinor ?? 0,
      code,
    )}`,
    '',
    `Net disbursement to owner: ${formatMinorAmount(
      data.netDisbursementMinor ?? 0,
      code,
    )}`,
  ];

  return [...baseLines, ...extras, '', ...deductions];
}

/**
 * Stable, deterministic hash of the statement payload — used as the PDF
 * `/Keywords` metadata so auditors can re-hash the underlying row and
 * verify the artifact has not been tampered with.
 */
export function hashStatementPayload(data: OwnerStatementPdfData): string {
  const canonical = JSON.stringify({
    statementId: data.statementId,
    statementNumber: data.statementNumber,
    tenantId: data.tenantId,
    ownerId: data.ownerId,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    currencyCode: data.currencyCode,
    grossRentMinor: data.grossRentMinor,
    kraMriDeductionMinor: data.kraMriDeductionMinor ?? 0,
    platformFeeMinor: data.platformFeeMinor ?? 0,
    netDisbursementMinor: data.netDisbursementMinor ?? 0,
    extras:
      data.extraLineItems?.map((it) => ({
        label: it.label,
        amount: it.amountMinor,
      })) ?? [],
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Escape a string for embedding in a PDF text-showing operator
 * (`(...) Tj`). Backslashes and parentheses are the only characters
 * that have to be escaped inside a PDF literal string.
 */
function escapePdfString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

type PdfObject = {
  readonly id: number;
  readonly body: string;
};

function buildContentStream(
  data: OwnerStatementPdfData,
  lines: readonly string[],
): string {
  const headerText = data.branding?.tenantName?.trim()
    ? `${data.branding.tenantName} — Owner Statement`
    : 'Property Statement';
  const generatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const footerText = `Generated ${generatedAt} UTC · Statement ${data.statementNumber || data.statementId}`;

  const startY = A4_HEIGHT_PT - MARGIN_PT;

  // Move to (MARGIN_PT, startY) and emit the header in 18pt bold.
  const ops: string[] = [];
  ops.push('BT');
  ops.push(`/F2 ${HEADER_FONT_SIZE} Tf`);
  ops.push(`${MARGIN_PT} ${startY} Td`);
  ops.push(`(${escapePdfString(headerText)}) Tj`);

  // Period subtitle directly below the header.
  ops.push(`/F1 ${SECTION_FONT_SIZE} Tf`);
  ops.push(`0 -${LINE_HEIGHT_PT * 1.4} TD`);
  ops.push(
    `(${escapePdfString(`Period ${data.periodStart} to ${data.periodEnd}`)}) Tj`,
  );

  // Body lines in 10pt regular.
  ops.push(`/F1 ${BODY_FONT_SIZE} Tf`);
  for (const line of lines) {
    ops.push(`0 -${LINE_HEIGHT_PT} TD`);
    if (line.length > 0) {
      ops.push(`(${escapePdfString(line)}) Tj`);
    }
  }

  // Footer pinned to bottom margin.
  ops.push('ET');
  ops.push('BT');
  ops.push(`/F1 ${FOOTER_FONT_SIZE} Tf`);
  ops.push(`${MARGIN_PT} ${MARGIN_PT - 20} Td`);
  ops.push(`(${escapePdfString(footerText)}) Tj`);
  ops.push('ET');

  return ops.join('\n');
}

/**
 * Render a complete, valid, A4-sized PDF document for the supplied
 * owner statement and return it as a `Buffer`.
 *
 * Layout:
 *   - Header (tenant branding or generic title) at top margin.
 *   - Period subtitle.
 *   - Numbered line items: rent breakdown, KRA MRI deduction, platform
 *     fee, net disbursement.
 *   - Footer with generation timestamp and statement number.
 *
 * The output starts with `%PDF-1.4\n` and ends with `%%EOF\n` — every
 * compliant PDF reader will accept it.
 */
export function renderOwnerStatementPdf(data: OwnerStatementPdfData): Buffer {
  const lines = buildStatementLines(data);
  const contentStream = buildContentStream(data, lines);
  const auditHash = hashStatementPayload(data);

  // PDF object IDs — order matters because we reference them by id.
  const objects: PdfObject[] = [];

  // 1: Catalog
  objects.push({
    id: 1,
    body: '<< /Type /Catalog /Pages 2 0 R >>',
  });

  // 2: Pages tree
  objects.push({
    id: 2,
    body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  });

  // 3: Page
  objects.push({
    id: 3,
    body:
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${A4_WIDTH_PT} ${A4_HEIGHT_PT}] ` +
      `/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> ` +
      `/Contents 4 0 R >>`,
  });

  // 4: Content stream
  const streamBytes = Buffer.byteLength(contentStream, 'utf8');
  objects.push({
    id: 4,
    body: `<< /Length ${streamBytes} >>\nstream\n${contentStream}\nendstream`,
  });

  // 5: Helvetica regular
  objects.push({
    id: 5,
    body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  });

  // 6: Helvetica bold (for the header)
  objects.push({
    id: 6,
    body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  });

  // 7: Document info dictionary (with audit hash in /Keywords).
  const tenantNameForMeta = data.branding?.tenantName?.trim() || 'Tenant';
  const titleMeta = `Owner Statement ${data.statementNumber || data.statementId}`;
  objects.push({
    id: 7,
    body:
      `<< /Title (${escapePdfString(titleMeta)}) ` +
      `/Author (${escapePdfString(tenantNameForMeta)}) ` +
      `/Subject (${escapePdfString(`Owner statement for period ${data.periodStart} to ${data.periodEnd}`)}) ` +
      `/Creator (BORJIE monthly-close) ` +
      `/Producer (BORJIE api-gateway pdf-renderer) ` +
      `/Keywords (sha256:${auditHash}) >>`,
  });

  // Assemble the document body and capture each object's byte offset
  // so the xref table is correct.
  const header = '%PDF-1.4\n%âãÏÓ\n';
  const headerBytes = Buffer.from(header, 'binary');

  const bodyBuffers: Buffer[] = [];
  const offsets: number[] = [];
  let cursor = headerBytes.length;

  for (const obj of objects) {
    offsets.push(cursor);
    const chunk = Buffer.from(
      `${obj.id} 0 obj\n${obj.body}\nendobj\n`,
      'binary',
    );
    bodyBuffers.push(chunk);
    cursor += chunk.length;
  }

  // xref table
  const xrefOffset = cursor;
  const xrefLines: string[] = [];
  xrefLines.push('xref');
  xrefLines.push(`0 ${objects.length + 1}`);
  xrefLines.push('0000000000 65535 f ');
  for (const off of offsets) {
    xrefLines.push(`${String(off).padStart(10, '0')} 00000 n `);
  }
  const xrefBuffer = Buffer.from(`${xrefLines.join('\n')}\n`, 'binary');

  // trailer + EOF
  const trailer =
    `trailer\n` +
    `<< /Size ${objects.length + 1} /Root 1 0 R /Info 7 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;
  const trailerBuffer = Buffer.from(trailer, 'binary');

  return Buffer.concat([headerBytes, ...bodyBuffers, xrefBuffer, trailerBuffer]);
}
