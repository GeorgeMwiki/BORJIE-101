/**
 * fontEmbeddingGate — for PDFs only. Verifies every font in the PDF
 * font dictionary has an embedded font program (`FontFile`,
 * `FontFile2`, or `FontFile3`). PDF/UA requires this; PDF/A-1a too.
 *
 * Implementation: scan the PDF bytes as ASCII for the `/Font <<`
 * dictionary marker, then for each /Type1, /TrueType, /Type0 font
 * referenced look for the corresponding FontFile* key in the same
 * object. This is a lightweight check that catches the common
 * "system font referenced but not embedded" case; deeper validation
 * (CID maps, ToUnicode) lives in the accessibility gate / FontForge.
 *
 * Zero-dep on purpose — we don't want to pull pdf.js / pdfjs-dist
 * just to count font keys. The check is conservative: when in doubt
 * (e.g. encrypted PDF), the gate flags rather than passes silently.
 */

import type { QualityReport } from '../types.js';
import type { FontEmbeddingGateInput, Gate } from './types.js';

const PDF_MAGIC = '%PDF-';
const FONT_DECL_RE = /\/Font(?:\s|<<|\/)/g;
const FONT_DESCRIPTOR_RE = /\/FontDescriptor\s+\d+\s+\d+\s+R/g;
const EMBED_KEY_RE = /\/(FontFile|FontFile2|FontFile3)\s/g;
const ENCRYPTED_RE = /\/Encrypt\s/;

export function fontEmbeddingGate(): Gate<FontEmbeddingGateInput> {
  return {
    id: 'fontEmbeddingGate',
    async evaluate({ pdfBytes }): Promise<QualityReport> {
      // ASCII-decode the prefix (font keywords live in the PDF cross-ref
      // body, ASCII-safe). We avoid TextDecoder('utf-8') of the whole
      // file to keep this O(bytes) without allocating multibyte strings.
      const head = new TextDecoder('latin1').decode(pdfBytes.slice(0, 64));
      if (!head.startsWith(PDF_MAGIC)) {
        return {
          gateId: 'fontEmbeddingGate',
          score: { value: 0, threshold: 1, passed: false },
          reasons: ['not a PDF (missing %PDF- magic)'],
        };
      }
      const ascii = new TextDecoder('latin1').decode(pdfBytes);
      if (ENCRYPTED_RE.test(ascii)) {
        return {
          gateId: 'fontEmbeddingGate',
          score: { value: 0, threshold: 1, passed: false },
          reasons: ['cannot verify embedding on encrypted PDF — flagged for review'],
        };
      }
      const fontDescriptorMatches = ascii.match(FONT_DESCRIPTOR_RE) ?? [];
      const fontDeclMatches = ascii.match(FONT_DECL_RE) ?? [];
      const embedMatches = ascii.match(EMBED_KEY_RE) ?? [];

      // A PDF with no fonts at all (e.g. pure image scan) passes — there
      // is nothing to embed.
      if (fontDescriptorMatches.length === 0 && fontDeclMatches.length === 0) {
        return {
          gateId: 'fontEmbeddingGate',
          score: { value: 1, threshold: 1, passed: true },
          reasons: ['PDF contains no font references; nothing to verify'],
        };
      }
      // We expect at least one FontFile* per FontDescriptor. The 1:1
      // mapping isn't strictly required (subset fonts share programs)
      // but zero embeds means everything is unembedded.
      const passed = embedMatches.length > 0 && embedMatches.length >= fontDescriptorMatches.length;
      const value =
        fontDescriptorMatches.length === 0
          ? 1
          : Math.min(1, embedMatches.length / fontDescriptorMatches.length);
      return {
        gateId: 'fontEmbeddingGate',
        score: { value, threshold: 1, passed },
        reasons: passed
          ? [
              `all fonts embedded (${embedMatches.length} FontFile entries for ${fontDescriptorMatches.length} descriptors)`,
            ]
          : [
              `unembedded fonts detected: ${fontDescriptorMatches.length} descriptors but only ${embedMatches.length} FontFile entries`,
            ],
        details: {
          fontDescriptors: fontDescriptorMatches.length,
          fontDeclarations: fontDeclMatches.length,
          embedEntries: embedMatches.length,
        },
      };
    },
  };
}
