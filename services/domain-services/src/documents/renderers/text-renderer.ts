/**
 * Text Renderer — adapter over the existing string-based templates
 * (lease-agreement, rent-receipt, etc.) that just interpolate data
 * into a plain text artifact.
 *
 * This keeps backwards compatibility with existing template functions
 * while exposing them through the IDocumentRenderer contract.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';

export interface TextRenderTemplateSource<TInput> {
  readonly generate: (input: TInput) => string;
}

export class TextRenderer implements IDocumentRenderer {
  readonly kind = 'text' as const;
  readonly supportedMimeTypes: readonly RenderedMimeType[] = ['text/plain'];

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const src = template.source as TextRenderTemplateSource<TInput> | string;

    if (!src || (typeof src !== 'string' && typeof (src as TextRenderTemplateSource<TInput>).generate !== 'function')) {
      throw new RendererError(
        'INVALID_TEMPLATE',
        `TextRenderer requires a string or { generate: (input) => string } template (template id=${template.id})`
      );
    }

    const validated = template.validate ? template.validate(inputs) : inputs;

    let content: string;
    try {
      content = typeof src === 'string'
        ? interpolate(src, validated as Record<string, unknown>)
        : src.generate(validated);
    } catch (e) {
      throw new RendererError(
        'RENDER_FAILED',
        e instanceof Error ? e.message : 'text render failed'
      );
    }

    const buffer = Buffer.from(content, 'utf-8');
    return {
      buffer,
      mimeType: 'text/plain',
      meta: {
        templateId: template.id,
        templateVersion: template.version,
        length: content.length,
      },
    };
  }
}

/** Minimal `{{token}}` interpolation for string templates. */
function interpolate(src: string, data: Record<string, unknown>): string {
  return src.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const parts = key.split('.');
    let cursor: unknown = data;
    for (const p of parts) {
      if (cursor && typeof cursor === 'object' && p in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[p];
      } else {
        return '';
      }
    }
    return cursor === undefined || cursor === null ? '' : String(cursor);
  });
}
