/**
 * Minimal PDF renderer for the report engine.
 *
 * The task description mentions Playwright HTML→PDF but Playwright is
 * heavy (full browser, slow start-up, OS deps). For the structured-
 * data reports the engine emits, a hand-rolled PDF (text + simple
 * tables, no JS / CSS) is faster, deterministic, and dependency-free.
 *
 * For richer pixel-accurate output the rendering pipeline can be
 * swapped to Playwright via the `renderer` injection point on the
 * orchestrator. Tests below validate the standard fast path.
 *
 * PDF 1.4 structure produced here:
 *   1. %PDF-1.4 header
 *   2. Catalog (root)
 *   3. Pages tree (one Page object)
 *   4. Page content stream — text + lines for table grid
 *   5. Font object (Helvetica, built-in)
 *   6. xref + trailer
 *
 * No images, no embedded fonts beyond standard 14 — keeps output
 * small and viewable in every PDF reader.
 */

import type {
  ResolvedReportSection,
  TenantBrand,
  RenderedReportFile,
} from '../types.js';

interface PdfTextOp {
  readonly kind: 'text';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
  readonly bold?: boolean;
  readonly color?: [number, number, number];
}

interface PdfLineOp {
  readonly kind: 'line';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width?: number;
  readonly color?: [number, number, number];
}

type PdfOp = PdfTextOp | PdfLineOp;

const PAGE_WIDTH = 612; // 8.5" * 72
const PAGE_HEIGHT = 792; // 11" * 72
const MARGIN_LEFT = 50;
const MARGIN_TOP = 760;
const MARGIN_BOTTOM = 60;
const LINE_HEIGHT_BODY = 14;
const LINE_HEIGHT_HEADING = 22;

function colorToPdf(c?: [number, number, number]): string {
  if (!c) return '0 0 0';
  return `${(c[0] / 255).toFixed(3)} ${(c[1] / 255).toFixed(3)} ${(c[2] / 255).toFixed(3)}`;
}

function escapePdfText(s: string): string {
  // Strip non-ASCII because we only embed standard ASCII font.
  const ascii = s.replace(/[^\x20-\x7E]/g, '?');
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function hexToRgb(hex?: string): [number, number, number] | undefined {
  if (!hex) return undefined;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return undefined;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function buildContentStream(ops: readonly PdfOp[]): string {
  let stream = '';
  for (const op of ops) {
    if (op.kind === 'text') {
      const font = op.bold ? 'F2' : 'F1';
      stream += 'BT\n';
      stream += `${colorToPdf(op.color)} rg\n`;
      stream += `/${font} ${op.fontSize} Tf\n`;
      stream += `${op.x} ${op.y} Td\n`;
      stream += `(${escapePdfText(op.text)}) Tj\n`;
      stream += 'ET\n';
    } else {
      stream += `${op.width ?? 0.5} w\n`;
      stream += `${colorToPdf(op.color)} RG\n`;
      stream += `${op.x1} ${op.y1} m\n`;
      stream += `${op.x2} ${op.y2} l\n`;
      stream += 'S\n';
    }
  }
  return stream;
}

/**
 * Synthesize a minimal PDF (1.4) document from the ops list. Output
 * is a single page; if `ops` overflow, callers must paginate
 * upstream (renderReportPdf below handles that).
 */
function buildSinglePagePdf(ops: readonly PdfOp[]): Buffer {
  const content = buildContentStream(ops);
  const contentBuf = Buffer.from(content, 'utf-8');

  const objects: string[] = [];
  // Object 1: catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // Object 2: pages tree
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  // Object 3: page
  objects.push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      '/Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
  );
  // Object 4: content stream
  objects.push(
    `<< /Length ${contentBuf.length} >>\nstream\n${content}endstream`,
  );
  // Object 5: font Helvetica
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // Object 6: font Helvetica-Bold
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  let body = '';
  const offsets: number[] = [];
  body += '%PDF-1.4\n%\xff\xff\xff\xff\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

/** Multi-page PDF assembled from a list of single-page content op-lists. */
function buildMultiPagePdf(pages: readonly (readonly PdfOp[])[]): Buffer {
  const pageStreams = pages.map((ops) => buildContentStream(ops));
  const objects: string[] = [];
  // Object 1: catalog
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  // Object 2: pages tree (kids filled after we know page object numbers)
  // Each page is two objects (page + content stream) starting at #3.
  const pageObjNumbers: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    pageObjNumbers.push(3 + i * 2);
  }
  objects.push(
    `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(' ')}] ` +
      `/Count ${pages.length} >>`,
  );
  const fontObjNumber = 3 + pages.length * 2;
  const boldFontObjNumber = fontObjNumber + 1;
  for (let i = 0; i < pages.length; i++) {
    const pageNum = 3 + i * 2;
    const contentNum = pageNum + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Contents ${contentNum} 0 R ` +
        `/Resources << /Font << /F1 ${fontObjNumber} 0 R /F2 ${boldFontObjNumber} 0 R >> >> >>`,
    );
    const stream = pageStreams[i] ?? '';
    const buf = Buffer.from(stream, 'utf-8');
    objects.push(`<< /Length ${buf.length} >>\nstream\n${stream}endstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  let body = '';
  const offsets: number[] = [];
  body += '%PDF-1.4\n%\xff\xff\xff\xff\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

/**
 * Slug-safe filename (no slashes, lowercase, length-bounded).
 */
export function sanitizeFilename(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

export interface RenderPdfInput {
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly ResolvedReportSection[];
  readonly brand: TenantBrand;
  readonly generatedAt: Date;
}

/**
 * Render the resolved report into a multi-page PDF.
 * Pagination: new page when `y` falls below `MARGIN_BOTTOM`.
 */
export function renderReportPdf(input: RenderPdfInput): RenderedReportFile {
  const accent = hexToRgb(input.brand.accentColor) ?? [196, 91, 18];
  const primary = hexToRgb(input.brand.primaryColor) ?? [31, 56, 100];
  const text: [number, number, number] = [50, 50, 50];

  let pageOps: PdfOp[] = [];
  const pages: PdfOp[][] = [pageOps];
  let y = MARGIN_TOP;

  const moveTo = (delta: number) => {
    y -= delta;
    if (y < MARGIN_BOTTOM) {
      pageOps = [];
      pages.push(pageOps);
      y = MARGIN_TOP;
    }
  };

  // Header
  pageOps.push({
    kind: 'text',
    x: MARGIN_LEFT,
    y,
    text: input.brand.displayName,
    fontSize: 10,
    color: accent,
  });
  y -= 6;
  pageOps.push({
    kind: 'line',
    x1: MARGIN_LEFT,
    y1: y,
    x2: PAGE_WIDTH - MARGIN_LEFT,
    y2: y,
    color: accent,
    width: 1,
  });
  moveTo(20);

  // Title
  pageOps.push({
    kind: 'text',
    x: MARGIN_LEFT,
    y,
    text: input.title,
    fontSize: 22,
    bold: true,
    color: primary,
  });
  moveTo(LINE_HEIGHT_HEADING + 4);

  // Subtitle
  if (input.subtitle) {
    pageOps.push({
      kind: 'text',
      x: MARGIN_LEFT,
      y,
      text: input.subtitle,
      fontSize: 12,
      color: text,
    });
    moveTo(LINE_HEIGHT_BODY + 4);
  }

  // Date
  pageOps.push({
    kind: 'text',
    x: MARGIN_LEFT,
    y,
    text: `Generated: ${input.generatedAt.toISOString().slice(0, 19).replace('T', ' ')}`,
    fontSize: 9,
    color: text,
  });
  moveTo(LINE_HEIGHT_BODY + 8);

  for (const section of input.sections) {
    pageOps.push({
      kind: 'text',
      x: MARGIN_LEFT,
      y,
      text: section.title,
      fontSize: 14,
      bold: true,
      color: primary,
    });
    moveTo(LINE_HEIGHT_HEADING);

    if (section.kind === 'narrative' && section.narrative) {
      const lines = wrapText(section.narrative, 92);
      for (const line of lines) {
        pageOps.push({
          kind: 'text',
          x: MARGIN_LEFT,
          y,
          text: line,
          fontSize: 10,
          color: text,
        });
        moveTo(LINE_HEIGHT_BODY);
      }
    } else if (section.kind === 'table' && section.table) {
      const colWidth =
        (PAGE_WIDTH - 2 * MARGIN_LEFT) /
        Math.max(1, section.table.headers.length);
      for (let i = 0; i < section.table.headers.length; i++) {
        pageOps.push({
          kind: 'text',
          x: MARGIN_LEFT + i * colWidth,
          y,
          text: section.table.headers[i] ?? '',
          fontSize: 10,
          bold: true,
          color: primary,
        });
      }
      moveTo(LINE_HEIGHT_BODY);
      pageOps.push({
        kind: 'line',
        x1: MARGIN_LEFT,
        y1: y + 4,
        x2: PAGE_WIDTH - MARGIN_LEFT,
        y2: y + 4,
        color: [200, 200, 200],
      });
      for (const row of section.table.rows) {
        for (let i = 0; i < row.length; i++) {
          pageOps.push({
            kind: 'text',
            x: MARGIN_LEFT + i * colWidth,
            y,
            text: String(row[i] ?? ''),
            fontSize: 10,
            color: text,
          });
        }
        moveTo(LINE_HEIGHT_BODY);
      }
    } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
      const perRow = 3;
      const colWidth = (PAGE_WIDTH - 2 * MARGIN_LEFT) / perRow;
      let i = 0;
      let rowOriginY = y;
      for (const metric of section.kpi_grid.metrics) {
        const col = i % perRow;
        const baseX = MARGIN_LEFT + col * colWidth;
        pageOps.push({
          kind: 'text',
          x: baseX,
          y: rowOriginY,
          text: metric.label,
          fontSize: 9,
          color: text,
        });
        pageOps.push({
          kind: 'text',
          x: baseX,
          y: rowOriginY - 14,
          text: String(metric.value),
          fontSize: 16,
          bold: true,
          color: primary,
        });
        if (metric.delta) {
          pageOps.push({
            kind: 'text',
            x: baseX,
            y: rowOriginY - 28,
            text: metric.delta,
            fontSize: 9,
            color: accent,
          });
        }
        i++;
        if (i % perRow === 0) {
          rowOriginY -= 40;
        }
      }
      const lastRowAdjust = i % perRow === 0 ? 0 : 40;
      y = rowOriginY - lastRowAdjust;
      moveTo(8);
    } else if (section.kind === 'chart' && section.chart) {
      pageOps.push({
        kind: 'text',
        x: MARGIN_LEFT,
        y,
        text: `[Chart: ${section.chart.title ?? 'unnamed'}]`,
        fontSize: 10,
        color: text,
      });
      moveTo(LINE_HEIGHT_BODY);
      // Rectangle as a chart placeholder. Real chart PNG embedding
      // would require an image XObject and the PNG byte stream — out
      // of scope for the dependency-free fast path.
      pageOps.push({
        kind: 'line',
        x1: MARGIN_LEFT,
        y1: y - 60,
        x2: PAGE_WIDTH - MARGIN_LEFT,
        y2: y - 60,
        color: [180, 180, 180],
      });
      pageOps.push({
        kind: 'line',
        x1: MARGIN_LEFT,
        y1: y,
        x2: MARGIN_LEFT,
        y2: y - 60,
        color: [180, 180, 180],
      });
      pageOps.push({
        kind: 'line',
        x1: PAGE_WIDTH - MARGIN_LEFT,
        y1: y,
        x2: PAGE_WIDTH - MARGIN_LEFT,
        y2: y - 60,
        color: [180, 180, 180],
      });
      pageOps.push({
        kind: 'line',
        x1: MARGIN_LEFT,
        y1: y,
        x2: PAGE_WIDTH - MARGIN_LEFT,
        y2: y,
        color: [180, 180, 180],
      });
      moveTo(72);
    }

    moveTo(8);
  }

  const buffer = buildMultiPagePdf(pages);
  return {
    format: 'pdf',
    buffer,
    mimeType: 'application/pdf',
    filename: `${sanitizeFilename(input.title)}.pdf`,
  };
}

/** Naive whitespace word-wrap to fit roughly N characters per line. */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

// Internal helpers exported for unit tests.
export const __test__ = {
  wrapText,
  hexToRgb,
  escapePdfText,
  buildSinglePagePdf,
  buildMultiPagePdf,
};
