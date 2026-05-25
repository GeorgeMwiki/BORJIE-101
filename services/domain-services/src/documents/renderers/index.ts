/**
 * Document renderers — barrel export.
 *
 * IDocumentRenderer defines the common contract; concrete renderers:
 *  - TextRenderer              (plain text)
 *  - DocxtemplaterRenderer     (.docx via docxtemplater; synthesizer fallback)
 *  - ReactPdfRenderer          (PDF via @react-pdf/renderer; zero-dep fallback)
 *  - TypstRenderer             (PDF via typst CLI; zero-dep fallback)
 *  - NanoBananaImageryRenderer (MARKETING IMAGERY ONLY; placeholder fallback)
 */

export * from './renderer-interface.js';
export * from './text-renderer.js';
export * from './docxtemplater-renderer.js';
export * from './react-pdf-renderer.js';
export * from './typst-renderer.js';
export * from './nano-banana-imagery-renderer.js';
export * from './renderer-factory.js';
