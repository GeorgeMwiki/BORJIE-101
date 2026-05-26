/**
 * DocxRealRenderer — implements IDocumentRenderer using the synthesizer
 * as a zero-dependency default, with a pluggable hook for a future
 * docxtemplater upgrade.
 *
 * To switch to docxtemplater:
 *   1. `pnpm add docxtemplater pizzip`
 *   2. Set `DocxRealRenderer.engine = 'docxtemplater'` and provide a
 *      pre-built .docx template under
 *      `services/domain-services/assets/templates/<templateKey>.docx`.
 *
 * Until then the renderer uses `synthesizeDocxFromText` which produces
 * a minimal but valid .docx from the template string body.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
  RendererKind,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';
import { synthesizeDocxFromText } from './docx-fallback-synthesizer.js';

type DocxEngine = 'synthesizer' | 'docxtemplater';

export interface DocxRealRendererOptions {
  readonly engine?: DocxEngine;
  readonly templateLoader?: (templateKey: string) => Promise<Buffer | null>;
}

export class DocxRealRenderer implements IDocumentRenderer {
  readonly kind: RendererKind = 'docxtemplater';
  readonly supportedMimeTypes: readonly RenderedMimeType[] = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  readonly engine: DocxEngine;
  private readonly templateLoader: ((templateKey: string) => Promise<Buffer | null>) | undefined;

  constructor(options: DocxRealRendererOptions = {}) {
    this.engine = options.engine ?? 'synthesizer';
    this.templateLoader = options.templateLoader;
  }

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    if (this.engine === 'docxtemplater') {
      return this.renderWithDocxtemplater(template, inputs);
    }
    return this.renderWithSynthesizer(template, inputs);
  }

  private async renderWithSynthesizer<TInput>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const body = this.templateBodyAsString(template);
    const buffer = synthesizeDocxFromText(
      body,
      inputs as unknown as Readonly<Record<string, unknown>>
    );
    return {
      buffer,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      meta: { engine: 'synthesizer', templateId: template.id },
    };
  }

  private async renderWithDocxtemplater<TInput>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    let PizZipCtor: unknown;
    let DocxtemplaterCtor: unknown;
    try {
      // Dynamic imports so the package compiles without these optional deps.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      PizZipCtor = (await import('pizzip')).default;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      DocxtemplaterCtor = (await import('docxtemplater')).default;
    } catch (err) {
      throw new RendererError(
        'RENDER_FAILED',
        `docxtemplater/pizzip not resolvable at runtime (${err instanceof Error ? err.message : String(err)}). Set engine="synthesizer" or ensure the packages are installed.`
      );
    }

    const templateBuffer = await this.loadTemplateBuffer(template);
    if (!templateBuffer) {
      throw new RendererError(
        'INVALID_TEMPLATE',
        `No .docx template found for key "${template.id}". Use engine="synthesizer" to fall back.`
      );
    }

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
    const zip = new (PizZipCtor as PizZipNew)(templateBuffer);
    const doc = new (DocxtemplaterCtor as DocxtemplaterNew)(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render(inputs as unknown as Record<string, unknown>);
    const buffer: Buffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    return {
      buffer,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      meta: { engine: 'docxtemplater', templateId: template.id },
    };
  }

  private templateBodyAsString<TInput>(template: RenderTemplate<TInput>): string {
    if (typeof template.source === 'string') return template.source;
    if (Buffer.isBuffer(template.source)) return template.source.toString('utf-8');
    throw new RendererError(
      'INVALID_TEMPLATE',
      `DocxRealRenderer synthesizer engine expects string or Buffer source; got ${typeof template.source}`
    );
  }

  private async loadTemplateBuffer<TInput>(
    template: RenderTemplate<TInput>
  ): Promise<Buffer | null> {
    if (Buffer.isBuffer(template.source)) return template.source;
    if (this.templateLoader) return this.templateLoader(template.id);
    return null;
  }
}
