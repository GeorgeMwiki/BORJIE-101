/**
 * DOCX Templater Renderer
 *
 * Produces a .docx by loading a Buffer template (passed via
 * `template.source`) through PizZip + docxtemplater (already declared in
 * package.json). If no Buffer is supplied the renderer synthesizes a
 * minimal valid .docx from the template string using the shared
 * `synthesizeDocxFromText` helper — this keeps the factory usable in
 * development without pre-built templates.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';
import { synthesizeDocxFromText } from './docx-fallback-synthesizer.js';

export class DocxtemplaterRenderer implements IDocumentRenderer {
  readonly kind = 'docxtemplater' as const;
  readonly supportedMimeTypes: readonly RenderedMimeType[] = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const mimeType =
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;

    // Buffer template → real docxtemplater render.
    if (Buffer.isBuffer(template.source)) {
      let PizZipCtor: unknown;
      let DocxtemplaterCtor: unknown;
      try {
        // Dynamic imports so the module loads even if the optional deps
        // are hoisted out at runtime; docxtemplater + pizzip are declared
        // in domain-services/package.json.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        PizZipCtor = (await import('pizzip')).default;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        DocxtemplaterCtor = (await import('docxtemplater')).default;
      } catch (err) {
        throw new RendererError(
          'RENDER_FAILED',
          `docxtemplater/pizzip not resolvable at runtime: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      try {
        interface PizZipInstance {
          generate(opts: { type: 'nodebuffer'; compression: 'DEFLATE' }): Buffer;
        }
        interface DocxtemplaterInstance {
          render(data: Record<string, unknown>): void;
          getZip(): PizZipInstance;
        }
        type PizZipNew = new (buffer: Buffer) => PizZipInstance;
        type DocxtemplaterNew = new (
          zip: PizZipInstance,
          opts: { paragraphLoop?: boolean; linebreaks?: boolean }
        ) => DocxtemplaterInstance;
        const zip = new (PizZipCtor as PizZipNew)(template.source);
        const doc = new (DocxtemplaterCtor as DocxtemplaterNew)(zip, {
          paragraphLoop: true,
          linebreaks: true,
        });
        doc.render(inputs as unknown as Record<string, unknown>);
        const buffer: Buffer = doc
          .getZip()
          .generate({ type: 'nodebuffer', compression: 'DEFLATE' });
        return {
          buffer,
          mimeType,
          meta: { engine: 'docxtemplater', templateId: template.id },
        };
      } catch (err) {
        throw new RendererError(
          'RENDER_FAILED',
          `docxtemplater render failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // String template → synthesize a minimal valid .docx.
    if (typeof template.source === 'string') {
      const buffer = synthesizeDocxFromText(
        template.source,
        inputs as unknown as Readonly<Record<string, unknown>>
      );
      return {
        buffer,
        mimeType,
        meta: { engine: 'synthesizer', templateId: template.id },
      };
    }

    throw new RendererError(
      'INVALID_TEMPLATE',
      `DocxtemplaterRenderer expects Buffer (docx template) or string (synthesized body); got ${typeof template.source}`
    );
  }
}
