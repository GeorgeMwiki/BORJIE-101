/**
 * Renderer Factory
 *
 * Selects the appropriate renderer for a given renderer kind / output type.
 * Enforces the guardrail that Nano Banana can ONLY be used for marketing
 * imagery, never for documents.
 */

import type { IDocumentRenderer, RendererKind } from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';
import { TextRenderer } from './text-renderer.js';
import { DocxtemplaterRenderer } from './docxtemplater-renderer.js';
import { ReactPdfRenderer } from './react-pdf-renderer.js';
import { TypstRenderer } from './typst-renderer.js';
import { NanoBananaImageryRenderer } from './nano-banana-imagery-renderer.js';

/** Output contexts — documents vs imagery are strictly separated. */
export type RendererContext = 'document' | 'marketing-imagery';

export interface RendererSelection {
  readonly kind: RendererKind;
  readonly context: RendererContext;
}

const DOCUMENT_KINDS: readonly RendererKind[] = ['text', 'docxtemplater', 'react-pdf', 'typst'];
const IMAGERY_KINDS: readonly RendererKind[] = ['nano-banana'];

export class RendererFactory {
  private readonly registry: Readonly<Record<RendererKind, IDocumentRenderer>>;

  constructor(overrides?: Partial<Record<RendererKind, IDocumentRenderer>>) {
    this.registry = Object.freeze({
      text: new TextRenderer(),
      docxtemplater: new DocxtemplaterRenderer(),
      'react-pdf': new ReactPdfRenderer(),
      typst: new TypstRenderer(),
      'nano-banana': new NanoBananaImageryRenderer(),
      ...(overrides ?? {}),
    });
  }

  /**
   * Get a renderer for a given kind, enforcing context guardrails:
   *  - kind='nano-banana' ONLY allowed when context='marketing-imagery'
   *  - all other kinds ONLY allowed when context='document'
   */
  get(selection: RendererSelection): IDocumentRenderer {
    const { kind, context } = selection;

    if (context === 'document' && !DOCUMENT_KINDS.includes(kind)) {
      throw new RendererError(
        'INVALID_TEMPLATE',
        `Renderer kind '${kind}' is not permitted for documents. Use one of: ${DOCUMENT_KINDS.join(', ')}.`
      );
    }
    if (context === 'marketing-imagery' && !IMAGERY_KINDS.includes(kind)) {
      throw new RendererError(
        'INVALID_TEMPLATE',
        `Renderer kind '${kind}' is not a marketing-imagery renderer.`
      );
    }

    const renderer = this.registry[kind];
    if (!renderer) {
      throw new RendererError('INVALID_TEMPLATE', `No renderer registered for kind '${kind}'.`);
    }
    return renderer;
  }

  listDocumentRenderers(): readonly IDocumentRenderer[] {
    return DOCUMENT_KINDS.map((k) => this.registry[k]);
  }

  listImageryRenderers(): readonly IDocumentRenderer[] {
    return IMAGERY_KINDS.map((k) => this.registry[k]);
  }
}
