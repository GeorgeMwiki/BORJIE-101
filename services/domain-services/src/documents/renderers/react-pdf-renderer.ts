/**
 * React PDF Renderer
 *
 * Wraps `@react-pdf/renderer` (already declared in package.json). The
 * renderer accepts either:
 *   - a pre-built React element as `template.source` → renderToBuffer()
 *   - a string body → a plain single-page PDF built with the in-repo
 *     `buildSimplePdf` helper (shared with PdfRealRenderer) so the
 *     renderer is always callable even when React/JSX is not available.
 *
 * Dynamic import keeps the package boundary loose: if @react-pdf/renderer
 * fails to resolve, we degrade to the simple encoder rather than throwing.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';

export class ReactPdfRenderer implements IDocumentRenderer {
  readonly kind = 'react-pdf' as const;
  readonly supportedMimeTypes: readonly RenderedMimeType[] = ['application/pdf'];

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    // React element path — requires @react-pdf/renderer at runtime.
    if (
      template.source &&
      typeof template.source === 'object' &&
      !Buffer.isBuffer(template.source)
    ) {
      try {
        // Dynamic import so the module loads without the peer being
        // present in every deployment; declared in package.json.
        const pdf = (await import('@react-pdf/renderer')) as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderToBuffer?: (element: any) => Promise<Buffer>;
        };
        if (!pdf.renderToBuffer) {
          throw new Error('renderToBuffer not exported by @react-pdf/renderer');
        }
        const buffer = await pdf.renderToBuffer(
          template.source as unknown as Record<string, unknown>
        );
        return {
          buffer,
          mimeType: 'application/pdf',
          meta: { engine: 'react-pdf', templateId: template.id },
        };
      } catch (err) {
        throw new RendererError(
          'RENDER_FAILED',
          `react-pdf render failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Fallback path — string/Buffer source rendered via the zero-dep
    // single-page encoder.
    const body = this.templateBodyAsString(template);
    const interpolated = interpolate(body, inputs as unknown as Readonly<Record<string, unknown>>);
    const buffer = buildSimplePdf(interpolated);
    return {
      buffer,
      mimeType: 'application/pdf',
      pageCount: 1,
      meta: { engine: 'builtin', templateId: template.id },
    };
  }

  private templateBodyAsString<TInput>(template: RenderTemplate<TInput>): string {
    if (typeof template.source === 'string') return template.source;
    if (Buffer.isBuffer(template.source)) return template.source.toString('utf-8');
    throw new RendererError(
      'INVALID_TEMPLATE',
      `ReactPdfRenderer fallback expects string or Buffer; got ${typeof template.source}`
    );
  }
}

function interpolate(body: string, inputs: Readonly<Record<string, unknown>>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const val = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[part];
      }
      return undefined;
    }, inputs);
    return val == null ? `{{${key}}}` : String(val);
  });
}

// Minimal zero-dep A4 PDF encoder — matches PdfRealRenderer's helper so
// both renderers produce interchangeable output for the fallback path.
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
