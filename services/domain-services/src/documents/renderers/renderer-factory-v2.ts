/**
 * Factory v2 — returns working renderer instances for every RendererKind.
 * Upgrades the existing factory without breaking it: the old factory stays
 * in place for any caller that needs the original semantics; new callers
 * can import from here to get working docx + pdf out of the box.
 *
 * Guardrail preserved:
 *   - `nano-banana` is imagery-only; requesting it with context='document' throws
 *   - `docxtemplater` / `react-pdf` / `text` are document-only; requesting them
 *     with context='marketing-imagery' throws
 */

import type { IDocumentRenderer, RendererKind } from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';
import { DocxRealRenderer } from './docx-real-renderer.js';
import { PdfRealRenderer } from './pdf-real-renderer.js';
import { TextRenderer } from './text-renderer.js';
import { TypstRenderer } from './typst-renderer.js';
import { NanoBananaImageryRenderer } from './nano-banana-imagery-renderer.js';

export type RendererContext = 'document' | 'marketing-imagery';

export interface RendererFactoryV2Options {
  readonly docxEngine?: 'synthesizer' | 'docxtemplater';
  readonly pdfEngine?: 'builtin' | 'react-pdf';
}

const IMAGERY_ONLY: readonly RendererKind[] = ['nano-banana'];
const DOCUMENT_KINDS: readonly RendererKind[] = [
  'text',
  'docxtemplater',
  'react-pdf',
  'typst',
];

export function getRenderer(
  kind: RendererKind,
  context: RendererContext,
  opts: RendererFactoryV2Options = {}
): IDocumentRenderer {
  assertGuardrail(kind, context);
  switch (kind) {
    case 'text':
      return new TextRenderer();
    case 'docxtemplater':
      return new DocxRealRenderer({ engine: opts.docxEngine ?? 'synthesizer' });
    case 'react-pdf':
      return new PdfRealRenderer({ engine: opts.pdfEngine ?? 'builtin' });
    case 'typst':
      // TypstRenderer degrades to the zero-dep PDF encoder when the
      // typst binary is unavailable at runtime.
      return new TypstRenderer();
    case 'nano-banana':
      // Only reachable for context='marketing-imagery' (guardrail above);
      // NanoBananaImageryRenderer itself emits imagery mime types only.
      return new NanoBananaImageryRenderer();
    default: {
      const exhaustive: never = kind;
      throw new RendererError('INVALID_TEMPLATE', `Unknown renderer kind: ${String(exhaustive)}`);
    }
  }
}

function assertGuardrail(kind: RendererKind, context: RendererContext): void {
  if (context === 'document' && IMAGERY_ONLY.includes(kind)) {
    throw new RendererError(
      'INVALID_TEMPLATE',
      `Renderer "${kind}" is imagery-only and cannot be used for documents.`
    );
  }
  if (context === 'marketing-imagery' && DOCUMENT_KINDS.includes(kind)) {
    throw new RendererError(
      'INVALID_TEMPLATE',
      `Renderer "${kind}" is document-only and cannot be used for marketing imagery.`
    );
  }
}
