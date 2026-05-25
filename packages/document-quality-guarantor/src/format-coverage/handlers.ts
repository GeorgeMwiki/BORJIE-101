/**
 * Built-in handlers for the 17 formats the spec requires.
 *
 * Each handler declares mime types + a preferred engine chain. The
 * orchestrators consume `engineChain` to pick which adapter to call
 * first; the chain is intentionally ordered "best fidelity → fastest
 * fallback → universal fallback (Pandoc)."
 *
 * Engine identifiers below match the conventional ids we expect the
 * concrete adapters to expose. They are *labels*; the orchestrator
 * is happy to receive engines with these ids and skip those it can't
 * find in the injected registry.
 */

import type { FormatHandler } from '../types.js';

export const BUILT_IN_HANDLERS: ReadonlyArray<FormatHandler> = Object.freeze([
  {
    format: 'pdf',
    direction: 'both',
    mimeTypes: Object.freeze([
      'application/pdf',
      'application/x-pdf',
      'application/pdf+a',
      'application/pdf+ua',
    ]),
    engineChain: Object.freeze(['typst', 'carbone', 'puppeteer', 'pandoc']),
  },
  {
    format: 'docx',
    direction: 'both',
    mimeTypes: Object.freeze([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]),
    engineChain: Object.freeze(['carbone', 'docxtemplater', 'libreoffice-headless', 'mammoth']),
  },
  {
    format: 'xlsx',
    direction: 'both',
    mimeTypes: Object.freeze([
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
    engineChain: Object.freeze(['exceljs', 'carbone', 'libreoffice-headless']),
  },
  {
    format: 'pptx',
    direction: 'both',
    mimeTypes: Object.freeze([
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]),
    engineChain: Object.freeze(['pptxgenjs', 'carbone', 'libreoffice-headless']),
  },
  {
    format: 'odt',
    direction: 'both',
    mimeTypes: Object.freeze(['application/vnd.oasis.opendocument.text']),
    engineChain: Object.freeze(['libreoffice-headless', 'pandoc']),
  },
  {
    format: 'ods',
    direction: 'both',
    mimeTypes: Object.freeze(['application/vnd.oasis.opendocument.spreadsheet']),
    engineChain: Object.freeze(['libreoffice-headless', 'pandoc']),
  },
  {
    format: 'odp',
    direction: 'both',
    mimeTypes: Object.freeze(['application/vnd.oasis.opendocument.presentation']),
    engineChain: Object.freeze(['libreoffice-headless', 'pandoc']),
  },
  {
    format: 'rtf',
    direction: 'both',
    mimeTypes: Object.freeze(['application/rtf', 'text/rtf']),
    engineChain: Object.freeze(['pandoc', 'libreoffice-headless']),
  },
  {
    format: 'html',
    direction: 'both',
    mimeTypes: Object.freeze(['text/html', 'application/xhtml+xml']),
    engineChain: Object.freeze(['puppeteer', 'pandoc']),
  },
  {
    format: 'md',
    direction: 'both',
    mimeTypes: Object.freeze(['text/markdown', 'text/x-markdown']),
    engineChain: Object.freeze(['pandoc', 'marked']),
  },
  {
    format: 'txt',
    direction: 'both',
    mimeTypes: Object.freeze(['text/plain']),
    engineChain: Object.freeze(['native', 'pandoc']),
  },
  {
    format: 'csv',
    direction: 'both',
    mimeTypes: Object.freeze(['text/csv', 'application/csv']),
    engineChain: Object.freeze(['native', 'exceljs', 'pandoc']),
  },
  {
    format: 'json',
    direction: 'both',
    mimeTypes: Object.freeze(['application/json']),
    engineChain: Object.freeze(['native']),
  },
  {
    format: 'eml',
    direction: 'both',
    mimeTypes: Object.freeze(['message/rfc822', 'message/eml']),
    engineChain: Object.freeze(['mailparser', 'pandoc']),
  },
  {
    format: 'msg',
    direction: 'intake',
    mimeTypes: Object.freeze([
      'application/vnd.ms-outlook',
      'application/x-msg',
    ]),
    engineChain: Object.freeze(['msgreader', 'libreoffice-headless']),
  },
  {
    format: 'epub',
    direction: 'both',
    mimeTypes: Object.freeze(['application/epub+zip']),
    engineChain: Object.freeze(['epub-gen', 'pandoc']),
  },
  {
    format: 'image',
    direction: 'intake',
    mimeTypes: Object.freeze([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/tiff',
    ]),
    engineChain: Object.freeze(['tesseract', 'paddleocr', 'claude-vision']),
  },
]);
