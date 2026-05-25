/**
 * PdfRealRenderer — implements IDocumentRenderer producing PDF output.
 *
 * Strategy: use a tiny built-in text-to-PDF encoder as the zero-dependency
 * default. Can upgrade to @react-pdf/renderer later without changing callers:
 *   1. `pnpm add @react-pdf/renderer react`
 *   2. Construct with `new PdfRealRenderer({ engine: 'react-pdf' })`
 *      and pass a React element as `template.source`.
 *
 * The built-in encoder lays out `{{key}}`-interpolated text as a single-page
 * A4 PDF using the PDF 1.4 format with the standard Helvetica font.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
  RendererKind,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';

type PdfEngine = 'builtin' | 'react-pdf';

export interface PdfRealRendererOptions {
  readonly engine?: PdfEngine;
}

export class PdfRealRenderer implements IDocumentRenderer {
  readonly kind: RendererKind = 'react-pdf';
  readonly supportedMimeTypes: readonly RenderedMimeType[] = ['application/pdf'];

  readonly engine: PdfEngine;

  constructor(options: PdfRealRendererOptions = {}) {
    this.engine = options.engine ?? 'builtin';
  }

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    if (this.engine === 'react-pdf') {
      return this.renderWithReactPdf(template, inputs);
    }
    return this.renderWithBuiltin(template, inputs);
  }

  private async renderWithBuiltin<TInput>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const body = this.templateBodyAsString(template);
    const rendered = body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
      const val = key.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
          return (acc as Record<string, unknown>)[part];
        }
        return undefined;
      }, inputs as unknown as Readonly<Record<string, unknown>>);
      return val == null ? `{{${key}}}` : String(val);
    });
    const buffer = buildSimplePdf(rendered);
    return {
      buffer,
      mimeType: 'application/pdf',
      pageCount: 1,
      meta: { engine: 'builtin', templateId: template.id },
    };
  }

  private async renderWithReactPdf<TInput>(
    template: RenderTemplate<TInput>,
    _inputs: TInput
  ): Promise<RenderResult> {
    let pdf: unknown;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      pdf = await import('@react-pdf/renderer');
    } catch (err) {
      throw new RendererError(
        'RENDER_FAILED',
        `@react-pdf/renderer not resolvable at runtime (${err instanceof Error ? err.message : String(err)}). Use engine="builtin" or ensure the package is installed.`
      );
    }
    if (!template.source || typeof template.source !== 'object') {
      throw new RendererError(
        'INVALID_TEMPLATE',
        'react-pdf engine expects a React element as template.source'
      );
    }
    interface ReactPdfModule {
      renderToBuffer(element: unknown): Promise<Buffer>;
    }
    const { renderToBuffer } = pdf as ReactPdfModule;
    const buffer: Buffer = await renderToBuffer(template.source);
    return {
      buffer,
      mimeType: 'application/pdf',
      meta: { engine: 'react-pdf', templateId: template.id },
    };
  }

  private templateBodyAsString<TInput>(template: RenderTemplate<TInput>): string {
    if (typeof template.source === 'string') return template.source;
    if (Buffer.isBuffer(template.source)) return template.source.toString('utf-8');
    throw new RendererError(
      'INVALID_TEMPLATE',
      `PdfRealRenderer builtin engine expects string or Buffer source; got ${typeof template.source}`
    );
  }
}

/**
 * Build a minimal single-page A4 PDF from plain text.
 * A4 = 595 x 842 points. Font = Helvetica 11pt. Margin = 72pt.
 * No external deps.
 */
function buildSimplePdf(text: string): Buffer {
  const lines = wrapLines(text, 90);
  const lineHeight = 14;
  const startY = 770;
  const marginX = 72;

  let contentStream = 'BT\n/F1 11 Tf\n';
  contentStream += `${marginX} ${startY} Td\n`;
  lines.forEach((line, idx) => {
    if (idx > 0) contentStream += `0 -${lineHeight} Td\n`;
    contentStream += `(${escapePdfString(line)}) Tj\n`;
  });
  contentStream += 'ET';

  const contentBuffer = Buffer.from(contentStream, 'latin1');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${contentBuffer.length} >>\nstream\n${contentStream}\nendstream`,
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  offsets.forEach((off) => {
    body += `${off.toString().padStart(10, '0')} 00000 n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length <= maxChars) {
      out.push(rawLine);
      continue;
    }
    const words = rawLine.split(/\s+/);
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxChars) {
        if (current) out.push(current);
        current = w;
      } else {
        current = (current ? current + ' ' : '') + w;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
