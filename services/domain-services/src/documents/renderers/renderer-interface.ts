/**
 * Document Renderer Interface
 *
 * Defines a common surface for all renderers that transform a template +
 * input data into a rendered output artifact (buffer + mime type).
 *
 * Supported renderer kinds:
 *  - `text`            plain text (default, implemented)
 *  - `docxtemplater`   .docx output (stub — KI-015 tracks the dep install)
 *  - `react-pdf`       PDF via @react-pdf/renderer (stub)
 *  - `typst`           Typst → PDF (stub — requires Typst binary)
 *  - `nano-banana`     MARKETING IMAGERY ONLY — never documents
 *
 * Kept small and immutable per project coding-style rules.
 */

export type RendererKind =
  | 'text'
  | 'docxtemplater'
  | 'react-pdf'
  | 'typst'
  | 'nano-banana';

/** Supported rendered output mime types. */
export type RenderedMimeType =
  | 'text/plain'
  | 'text/html'
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'image/png'
  | 'image/jpeg';

export interface RenderTemplate<TInput = Record<string, unknown>> {
  readonly id: string;
  readonly version: string;
  /** Template source — string, buffer, or structured descriptor (renderer-specific). */
  readonly source: string | Buffer | Record<string, unknown>;
  /** Validator invoked on inputs prior to render. */
  readonly validate?: (input: unknown) => TInput;
}

export interface RenderResult {
  readonly buffer: Buffer;
  readonly mimeType: RenderedMimeType;
  readonly pageCount?: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface IDocumentRenderer {
  readonly kind: RendererKind;
  readonly supportedMimeTypes: readonly RenderedMimeType[];
  render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult>;
}

export class RendererError extends Error {
  constructor(
    readonly code: 'NOT_IMPLEMENTED' | 'INVALID_TEMPLATE' | 'INVALID_INPUT' | 'RENDER_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'RendererError';
  }
}
