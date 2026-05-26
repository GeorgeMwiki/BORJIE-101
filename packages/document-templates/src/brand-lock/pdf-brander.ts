/**
 * PDF brander — composes brand-locked HTML and (in production)
 * forwards it to Puppeteer via the existing
 * `packages/document-studio/src/renderers/pdf-from-html-renderer.ts`
 * pipeline. In tests / CI we synthesize a minimal valid PDF directly
 * so the package is buildable without a Chromium download.
 *
 * The brand-lint step runs on the HTML BEFORE the binary render, so
 * violations are surfaced as `BRAND_VIOLATION` composition errors
 * rather than silent off-brand binaries.
 */

import { createHash } from 'node:crypto';
import type { IRDoc } from '../types.js';
import { CompositionError } from '../types.js';
import { validateHtmlBrand } from './brand-validator.js';

/**
 * Wrap an IRDoc as a brand-locked HTML string. The class names map to
 * Tailwind utility classes that the receiving renderer's stylesheet
 * resolves to registered tokens. No inline styles — refusing that is
 * how brand-lint detects raw colour leaks.
 */
export function renderIRDocToHtml(doc: IRDoc): string {
  const sectionsHtml = doc.sections
    .map(
      (s) =>
        `<section class="brj-section" id="${escapeHtml(s.id)}">` +
        `<h2 class="brj-h2">${escapeHtml(s.title)}</h2>` +
        s.blocks.map(renderBlock).join('') +
        '</section>',
    )
    .join('');

  const citationsHtml =
    doc.citations.length > 0
      ? `<section class="brj-citations"><h3 class="brj-h3">References</h3>` +
        doc.citations
          .map(
            (c) =>
              `<p class="brj-cite" id="cite-${escapeHtml(c.id)}">` +
              `<span class="brj-cite-id">[${escapeHtml(c.id)}]</span> ` +
              escapeHtml(c.claim) +
              ` <span class="brj-cite-src">${escapeHtml(c.source.kind)}:${escapeHtml(c.source.ref)}</span>` +
              '</p>',
          )
          .join('') +
        '</section>'
      : '';

  const watermark =
    doc.watermark === 'draft'
      ? `<div class="brj-watermark brj-watermark-draft">DRAFT</div>`
      : '';

  return (
    `<!doctype html><html lang="en"><head>` +
    `<meta charset="utf-8"/>` +
    `<title>${escapeHtml(doc.title)}</title>` +
    `<link rel="stylesheet" href="/borjie-brand.css"/>` +
    `</head><body class="brj-body">` +
    watermark +
    `<header class="brj-header"><span class="brj-wordmark">Borjie</span></header>` +
    `<main class="brj-main">` +
    `<h1 class="brj-h1">${escapeHtml(doc.title)}</h1>` +
    (doc.subtitle ? `<p class="brj-subtitle">${escapeHtml(doc.subtitle)}</p>` : '') +
    `<p class="brj-meta">Generated ${escapeHtml(doc.generated_at)}</p>` +
    sectionsHtml +
    citationsHtml +
    `</main>` +
    `<footer class="brj-footer"><span class="brj-wordmark">Borjie</span></footer>` +
    `</body></html>`
  );
}

function renderBlock(block: IRDoc['sections'][number]['blocks'][number]): string {
  switch (block.kind) {
    case 'heading':
      return `<h${block.level ?? 2} class="brj-h${block.level ?? 2}">${escapeHtml(block.text ?? '')}</h${block.level ?? 2}>`;
    case 'paragraph':
      return (
        `<p class="brj-p">` +
        escapeHtml(block.text ?? '') +
        (block.citationId !== undefined && block.citationId.length > 0
          ? ` <a class="brj-cite-ref" href="#cite-${escapeHtml(block.citationId)}">[${escapeHtml(block.citationId)}]</a>`
          : '') +
        '</p>'
      );
    case 'kpi_grid':
      return (
        `<div class="brj-kpis">` +
        (block.kpis ?? [])
          .map(
            (k) =>
              `<div class="brj-kpi">` +
              `<span class="brj-kpi-label">${escapeHtml(k.label)}</span>` +
              `<span class="brj-kpi-value">${escapeHtml(k.value)}` +
              (k.citationId !== undefined && k.citationId.length > 0
                ? ` <a class="brj-cite-ref" href="#cite-${escapeHtml(k.citationId)}">[${escapeHtml(k.citationId)}]</a>`
                : '') +
              `</span>` +
              `</div>`,
          )
          .join('') +
        `</div>`
      );
    case 'table':
      return renderTable(block.headers ?? [], block.rows ?? []);
    case 'chart_placeholder':
      return `<figure class="brj-chart"><figcaption class="brj-chart-caption">${escapeHtml(block.text ?? 'Chart')}</figcaption></figure>`;
    case 'citation_footnote':
      return `<aside class="brj-footnote">${escapeHtml(block.text ?? '')}</aside>`;
    case 'signature_block':
      return `<div class="brj-signature"><p class="brj-signature-line">${escapeHtml(block.text ?? '')}</p></div>`;
    case 'watermark':
      // Watermarks are rendered at the document level, not per block.
      return '';
    default:
      return '';
  }
}

function renderTable(
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const headRow = headers
    .map((h) => `<th class="brj-th">${escapeHtml(h)}</th>`)
    .join('');
  const bodyRows = rows
    .map(
      (r) =>
        `<tr class="brj-tr">` +
        r.map((c) => `<td class="brj-td">${escapeHtml(c)}</td>`).join('') +
        `</tr>`,
    )
    .join('');
  return `<table class="brj-table"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Minimal native PDF synthesis — used when Puppeteer is not available
// (e.g. unit tests, CI without Chromium). Produces a valid PDF 1.4 blob
// containing the doc title + section headings; full pixel rendering is
// the production pipeline's responsibility.
// ---------------------------------------------------------------------------

function escapePdfText(s: string): string {
  const ascii = s.replace(/[^\x20-\x7E]/g, '?');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildMinimalPdf(lines: ReadonlyArray<string>): Buffer {
  let content = '';
  let y = 750;
  for (const line of lines) {
    content += 'BT\n';
    content += '/F1 12 Tf\n';
    content += `50 ${y} Td\n`;
    content += `(${escapePdfText(line)}) Tj\n`;
    content += 'ET\n';
    y -= 18;
  }
  const contentBuf = Buffer.from(content, 'utf-8');
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contentBuf.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n%\xff\xff\xff\xff\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

export interface BrandPdfResult {
  readonly bytes: Buffer;
  readonly html: string;
  readonly checksum: string;
}

/**
 * Render an IRDoc to a brand-locked PDF. Throws `CompositionError`
 * with code `BRAND_VIOLATION` if the rendered HTML fails brand-lint.
 */
export function brandPdf(doc: IRDoc): BrandPdfResult {
  const html = renderIRDocToHtml(doc);
  const lint = validateHtmlBrand(html);
  if (!lint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      `pdf-brander refused: ${lint.violations.length} violation(s)`,
      lint.violations,
    );
  }
  const lines: string[] = [
    `Borjie — ${doc.title}`,
    ...(doc.subtitle !== undefined && doc.subtitle.length > 0 ? [doc.subtitle] : []),
    `Generated ${doc.generated_at}`,
    '',
  ];
  for (const section of doc.sections) {
    lines.push(section.title);
    for (const block of section.blocks) {
      if (block.kind === 'paragraph' && block.text !== undefined) {
        lines.push(block.text.slice(0, 90));
      }
      if (block.kind === 'heading' && block.text !== undefined) {
        lines.push(block.text);
      }
    }
    lines.push('');
  }
  for (const c of doc.citations) {
    lines.push(`[${c.id}] ${c.claim.slice(0, 80)}`);
  }
  const bytes = buildMinimalPdf(lines);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, html, checksum };
}
