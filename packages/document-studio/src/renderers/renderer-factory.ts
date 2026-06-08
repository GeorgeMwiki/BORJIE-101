/**
 * @borjie/document-studio — renderer factory.
 *
 * Maps an `(engineHint, format)` pair to a concrete `Renderer`. This is
 * the coverage layer the spec asks for:
 *
 *   - PDF        → Typst (regulator/legal default) OR Puppeteer (HTML→PDF
 *                  pixel-perfect fallback) OR Carbone (Office→PDF).
 *   - DOCX/XLSX  → Carbone (one Office template → many formats).
 *   - PPTX       → Carbone.
 *   - HTML       → Carbone (or pass-through).
 *
 * The factory holds ONE instance of each renderer (constructed by the
 * caller so envs/stubs are injectable) and routes by hint+format. It
 * NEVER reads env itself — the renderers do that lazily; the factory is
 * pure routing so it is exhaustively testable.
 */

import type { DocFormat, Renderer } from '../types.js';
import type { EngineHint } from '../registry/doc-type.js';
import { CarboneRenderer } from './carbone-renderer.js';
import { TypstRenderer } from './typst-renderer.js';
import { PdfFromHtmlRenderer } from './pdf-from-html-renderer.js';

/**
 * The three renderer ports the factory routes between. Inject these so
 * production wires real URLs/binaries and tests wire stubs.
 */
export interface RendererSet {
  readonly typst: Renderer;
  readonly carbone: Renderer;
  readonly htmlPdf: Renderer;
}

/**
 * Build a default renderer set. With no options every renderer resolves
 * to its stub when no transport (URL/binary) is configured, so this is
 * safe to construct in any environment. Pass options to force stubs or
 * inject explicit transports.
 */
export function createDefaultRendererSet(options?: {
  readonly typstServerUrl?: string;
  readonly carboneUrl?: string;
  readonly useStub?: boolean;
}): RendererSet {
  const useStub = options?.useStub === true;
  return {
    typst: new TypstRenderer({
      ...(options?.typstServerUrl !== undefined
        ? { typstServerUrl: options.typstServerUrl, typstBinary: '' }
        : {}),
      ...(useStub ? { useStub: true } : {}),
    }),
    carbone: new CarboneRenderer({
      ...(options?.carboneUrl !== undefined
        ? { carboneUrl: options.carboneUrl }
        : {}),
      ...(useStub ? { useStub: true } : {}),
    }),
    htmlPdf: new PdfFromHtmlRenderer({
      ...(useStub ? { useStub: true } : {}),
    }),
  };
}

export interface RendererFactory {
  /**
   * Pick the renderer for an `(engineHint, format)`. Throws on an
   * unsupported combination (e.g. Typst cannot emit XLSX) so the caller
   * surfaces a precise error rather than a silent wrong-format render.
   */
  getRenderer(engineHint: EngineHint, format: DocFormat): Renderer;
}

/** Formats Carbone can produce from one Office template. */
const CARBONE_FORMATS: ReadonlySet<DocFormat> = new Set<DocFormat>([
  'docx',
  'pdf',
  'pptx',
  'xlsx',
  'html',
]);

/**
 * Build the factory over a renderer set. The routing rules:
 *
 *   typst    → only `pdf` (regulator/legal default).
 *   carbone  → docx | pdf | pptx | xlsx | html (multi-format Office).
 *   html-pdf → only `pdf` (HTML→PDF pixel-perfect tail).
 */
export function createRendererFactory(set: RendererSet): RendererFactory {
  return {
    getRenderer(engineHint, format) {
      switch (engineHint) {
        case 'typst': {
          if (format !== 'pdf') {
            throw new Error(
              `renderer-factory: typst engine emits pdf only; got '${format}'. ` +
                "Use engineHint 'carbone' for docx/xlsx/pptx/html.",
            );
          }
          return set.typst;
        }
        case 'carbone': {
          if (!CARBONE_FORMATS.has(format)) {
            throw new Error(
              `renderer-factory: carbone cannot emit '${format}'`,
            );
          }
          return set.carbone;
        }
        case 'html-pdf': {
          if (format !== 'pdf') {
            throw new Error(
              `renderer-factory: html-pdf engine emits pdf only; got '${format}'`,
            );
          }
          return set.htmlPdf;
        }
        default: {
          // Exhaustiveness guard — a new EngineHint must add a case.
          const never: never = engineHint;
          throw new Error(`renderer-factory: unknown engineHint '${String(never)}'`);
        }
      }
    },
  };
}
