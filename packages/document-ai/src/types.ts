/**
 * @borjie/document-ai — public types.
 *
 * Amplification layer on top of @borjie/document-studio.
 * Goal: turn passive PDFs/scans/photos into structured, queryable,
 * citable, signable, multilingual assets.
 *
 * Subsystems (each has its own folder):
 *   1. ocr/             — bytes/photo → ParsedDocument (text + layout)
 *   2. chat-with-doc/   — RAG over single / multi-doc; cited answers
 *   3. form-extraction/ — schema-guided field extraction with confidence
 *   4. multilingual/    — language detection + translation TZ/KE/UG focus
 *   5. e-signature/     — provider-agnostic e-sig (DocuSign/HelloSign/Adobe)
 *   6. accessibility/   — PDF/A and PDF/UA validation + repair
 *
 * This module ships pure contracts. All adapters are factories returning
 * the port interface; no side effects at import time.
 *
 * Research basis:
 *   Docs/DOCUMENT_AI_RESEARCH_2026-05-24.md
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Language codes — ISO 639-1 with TZ/KE/UG specific bias toward Swahili.
// ─────────────────────────────────────────────────────────────────────

export const LANGUAGE_CODES = [
  'en', // English
  'sw', // Swahili (TZ/KE/UG primary)
  'fr', // French (Francophone Africa)
  'ar', // Arabic (Coast / Zanzibar)
  'pt', // Portuguese (Mozambique adjacency)
  'rw', // Kinyarwanda
  'lg', // Luganda (UG)
  'so', // Somali
  'am', // Amharic (regional expansion)
  'yo', // Yoruba (NG expansion)
  'ig', // Igbo (NG expansion)
  'ha', // Hausa (NG expansion)
  'zu', // Zulu (ZA expansion)
  'und', // Undetermined
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && (LANGUAGE_CODES as ReadonlyArray<string>).includes(value);
}

// ─────────────────────────────────────────────────────────────────────
// Layout primitives — coordinate space is normalized [0..1] on each
// page to be resolution-independent. (x,y) is top-left origin.
// ─────────────────────────────────────────────────────────────────────

export const LayoutBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  /** Optional rotation in degrees (positive = clockwise). */
  rotation: z.number().optional(),
});
export type LayoutBox = z.infer<typeof LayoutBoxSchema>;

/**
 * Logical role of a layout block — used by chat-with-doc to scope
 * retrieval, by form-extraction to skip non-content regions, and by
 * accessibility to verify tag structure.
 */
export const BLOCK_ROLES = [
  'paragraph',
  'heading',
  'list_item',
  'table_cell',
  'figure_caption',
  'footer',
  'header',
  'page_number',
  'signature',
  'stamp',
  'handwritten',
  'barcode',
  'qr',
  'unknown',
] as const;
export type BlockRole = (typeof BLOCK_ROLES)[number];

export interface TextBlock {
  readonly id: string;
  readonly text: string;
  readonly bbox: LayoutBox;
  readonly role: BlockRole;
  /** OCR confidence in [0..1]. */
  readonly confidence: number;
  /** Detected language for this block — falls back to page lang. */
  readonly language?: LanguageCode;
}

export interface ExtractedTable {
  readonly id: string;
  readonly bbox: LayoutBox;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  /** Optional header row index (0-based) within `rows`. */
  readonly headerRowIndex?: number;
  readonly confidence: number;
}

export interface DocumentPage {
  readonly pageNumber: number;
  /** Normalized page dimensions in points (1 pt = 1/72"). */
  readonly widthPt: number;
  readonly heightPt: number;
  readonly language: LanguageCode;
  readonly blocks: ReadonlyArray<TextBlock>;
  readonly tables: ReadonlyArray<ExtractedTable>;
  /** Convenience: full page text in reading order. */
  readonly text: string;
}

export interface ParsedDocument {
  readonly id: string;
  readonly sourceMime: string;
  readonly sourceSha256: string;
  readonly pages: ReadonlyArray<DocumentPage>;
  /** Convenience: joined text across pages, separated by form feed. */
  readonly text: string;
  /** Dominant language across pages by character count. */
  readonly dominantLanguage: LanguageCode;
  /** Which adapter produced this document. */
  readonly producedBy: string;
  readonly producedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// OCR configuration — common knobs across adapters.
// ─────────────────────────────────────────────────────────────────────

export interface OCRConfig {
  readonly bytes: Uint8Array;
  readonly mime: string;
  /** Hint languages; OCR engines should still attempt detection. */
  readonly lang?: ReadonlyArray<LanguageCode>;
  /**
   * Layout reconstruction quality:
   *  - 'text-only' — fastest, no bboxes
   *  - 'standard'  — paragraph bboxes + tables (default)
   *  - 'full'      — per-word bboxes + handwriting + signatures + stamps
   */
  readonly layout?: 'text-only' | 'standard' | 'full';
  /** Maximum pages to process; safety guard against huge PDFs. */
  readonly maxPages?: number;
  /** Optional correlation id for tracing. */
  readonly correlationId?: string;
}

export interface OCRPort {
  readonly id: string;
  recognize(config: OCRConfig): Promise<ParsedDocument>;
}

// ─────────────────────────────────────────────────────────────────────
// Chat-with-doc / multi-doc — answers carry citations grounded in the
// page + block they came from so the UI can highlight the source.
// ─────────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatTurn {
  readonly role: ChatRole;
  readonly content: string;
  readonly at?: Date;
}

export interface DocCitation {
  readonly docId: string;
  readonly pageNumber: number;
  /** Block id from `DocumentPage.blocks`. */
  readonly blockId: string;
  /** Quoted span supporting the answer. */
  readonly quote: string;
}

export interface ChatAnswer {
  readonly answer: string;
  readonly citations: ReadonlyArray<DocCitation>;
  /** Estimated answer confidence [0..1]. */
  readonly confidence: number;
  readonly tokensUsed?: number;
}

export interface MultiDocAnswer extends ChatAnswer {
  /** Per-document contribution score [0..1], stable order matches input. */
  readonly perDocContribution: ReadonlyArray<{
    readonly docId: string;
    readonly score: number;
  }>;
  /** True when the answer required cross-doc synthesis. */
  readonly crossDocSynthesis: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Form extraction — schema-guided structured field extraction.
// ─────────────────────────────────────────────────────────────────────

export interface FormField<TValue = unknown> {
  readonly name: string;
  readonly value: TValue;
  /** Extraction confidence [0..1]. */
  readonly confidence: number;
  /** Where in the doc the value came from. */
  readonly source: DocCitation | null;
  /**
   * `'extracted'` — found in the document.
   * `'inferred'` — derived from context (e.g. computed total).
   * `'missing'`  — not found; value is the schema default.
   */
  readonly origin: 'extracted' | 'inferred' | 'missing';
}

// ─────────────────────────────────────────────────────────────────────
// E-signature — provider-agnostic port with jurisdiction metadata.
// ─────────────────────────────────────────────────────────────────────

export const ESIGN_JURISDICTIONS = [
  'US_ESIGN', // US ESIGN Act (15 USC §7001) + UETA
  'EU_eIDAS_SES', // Simple Electronic Signature
  'EU_eIDAS_AES', // Advanced Electronic Signature
  'EU_eIDAS_QES', // Qualified Electronic Signature (highest)
  'UK_eIDAS', // UK eIDAS Regulations 2016
  'AfCFTA', // African Continental Free Trade Area — Pan-African
  'TZ_ETA2015', // Tanzania Electronic Transactions Act 2015
  'KE_KICA2020', // Kenya Information & Communications Act (2020 amendments)
  'UG_ETA2011', // Uganda Electronic Transactions Act 2011
  'NG_ETB2024', // Nigeria Electronic Transactions Bill 2024
  'INTERNAL_ONLY', // Non-binding — pdf-lib fallback
] as const;
export type ESignJurisdiction = (typeof ESIGN_JURISDICTIONS)[number];

export interface Signer {
  readonly email: string;
  readonly name: string;
  /** Order in which signers sign; 0 = signs first. */
  readonly order: number;
  /** Optional role label (e.g. 'tenant', 'landlord', 'witness'). */
  readonly role?: string;
}

export interface SignatureRequest {
  readonly requestId: string;
  readonly docId: string;
  readonly signers: ReadonlyArray<Signer>;
  readonly jurisdiction: ESignJurisdiction;
  readonly expiresAt: Date;
  readonly providerRef: string;
  readonly createdAt: Date;
}

export const SIGNATURE_STATUSES = [
  'pending',
  'partially_signed',
  'completed',
  'declined',
  'expired',
  'error',
] as const;
export type SignatureStatusCode = (typeof SIGNATURE_STATUSES)[number];

export interface SignatureStatus {
  readonly requestId: string;
  readonly status: SignatureStatusCode;
  readonly signedBy: ReadonlyArray<string>;
  readonly declinedBy: ReadonlyArray<string>;
  readonly lastEventAt: Date;
}

export interface SignaturePortConfig {
  readonly doc: { readonly id: string; readonly bytes: Uint8Array; readonly mime: string };
  readonly signers: ReadonlyArray<Signer>;
  readonly expiresAt: Date;
  readonly jurisdiction: ESignJurisdiction;
  readonly subject?: string;
  readonly message?: string;
}

export interface ESignaturePort {
  readonly id: string;
  readonly supportedJurisdictions: ReadonlyArray<ESignJurisdiction>;
  requestSignature(config: SignaturePortConfig): Promise<SignatureRequest>;
  pollStatus(requestId: string): Promise<SignatureStatus>;
  downloadSigned(requestId: string): Promise<Uint8Array>;
}

// ─────────────────────────────────────────────────────────────────────
// Accessibility — PDF/A and PDF/UA conformance reports.
// ─────────────────────────────────────────────────────────────────────

export const ACCESSIBILITY_SEVERITIES = ['info', 'warning', 'error'] as const;
export type AccessibilitySeverity = (typeof ACCESSIBILITY_SEVERITIES)[number];

export interface AccessibilityIssue {
  readonly rule: string;
  readonly severity: AccessibilitySeverity;
  readonly message: string;
  readonly pageNumber?: number;
}

export interface ValidationReport {
  readonly standard: 'PDF/A-1b' | 'PDF/A-2b' | 'PDF/A-3b' | 'PDF/UA-1' | 'PDF/UA-2';
  readonly conformant: boolean;
  readonly issues: ReadonlyArray<AccessibilityIssue>;
  readonly checkedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// Brain port — minimum surface this package depends on from ai-copilot.
// Defined here so the package compiles without a circular import.
// ─────────────────────────────────────────────────────────────────────

export interface BrainPort {
  /**
   * Single-shot completion. Returns text + best-effort token usage.
   * Implementations should be deterministic when `temperature: 0` is
   * passed via `options`.
   */
  complete(prompt: string, options?: { readonly temperature?: number; readonly maxTokens?: number }): Promise<{
    readonly text: string;
    readonly tokensUsed?: number;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Embedder port — used by chat-with-doc for retrieval.
// ─────────────────────────────────────────────────────────────────────

export interface EmbedderPort {
  embed(texts: ReadonlyArray<string>): Promise<ReadonlyArray<ReadonlyArray<number>>>;
}
