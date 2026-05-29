/**
 * Public types for the Company-Brain ingestion service (Wave COMPANY-BRAIN C-1).
 *
 * Companion to:
 *   - services/api-gateway/src/services/brain-ingestion/ingest.ts
 *   - services/api-gateway/src/services/brain-ingestion/parsers/*
 *   - services/api-gateway/src/services/brain-ingestion/embedder.ts
 *   - services/api-gateway/src/services/brain-ingestion/summarizer.ts
 *   - services/api-gateway/src/routes/owner/brain.hono.ts
 *
 * Pure types. No runtime side-effects.
 */

import type { CorpusSourceKind, CorpusUploadStatus } from '@borjie/database';

/** Re-exported so callers don't have to import from two packages. */
export type { CorpusSourceKind, CorpusUploadStatus };

/** Single document — raw bytes or text — flowing through the ingestion pipeline. */
export interface IncomingDoc {
  readonly originalFilename: string;
  readonly sourceKind: CorpusSourceKind;
  readonly mimeType?: string | undefined;
  /** Raw bytes for binary formats (pdf/photo/audio/xlsx). */
  readonly bytes?: Uint8Array | undefined;
  /** Pre-decoded text for text-formats (csv/text/json). */
  readonly text?: string | undefined;
  /** Optional language hint (drives STT + OCR). 'auto' = detect. */
  readonly languageHint?: 'en' | 'sw' | 'auto' | undefined;
  /** Free-form metadata propagated onto corpus_doc_uploads.metadata. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

/** Output of the parser stage — normalized to plain text + structured rows. */
export interface ParsedDoc {
  /** The full extracted text — fed into the chunker + summariser. */
  readonly text: string;
  /** Optional structured table (CSV/XLSX → rows of strings). */
  readonly table?:
    | {
        readonly headers: ReadonlyArray<string>;
        readonly rows: ReadonlyArray<ReadonlyArray<string>>;
      }
    | undefined;
  /** Parser warnings (non-fatal, surfaced in the receipt). */
  readonly warnings: ReadonlyArray<string>;
  /** Detected language ('en' | 'sw' | 'unknown'). */
  readonly detectedLanguage: 'en' | 'sw' | 'unknown';
  /** Parser-emitted facts (e.g. {kind: 'date', value: '2026-05-29'}). */
  readonly extractedFacts: ReadonlyArray<ExtractedFact>;
}

export interface ExtractedFact {
  readonly kind: string;
  readonly value: string;
  readonly confidence: number;
}

/** Output of the chunker. */
export interface TextChunk {
  readonly id: string;
  readonly text: string;
  readonly section: string | null;
  readonly chunkIndex: number;
}

/** Embedded chunk — chunk + 1024-dim vector. */
export interface EmbeddedChunk extends TextChunk {
  readonly embedding: ReadonlyArray<number>;
}

/** Summary digest produced after the embed step. */
export interface Summary {
  readonly summaryMd: string;
  readonly summaryEn: string;
  readonly summarySw: string;
  readonly keyFacts: ReadonlyArray<ExtractedFact>;
}

/** What the caller hands `ingest()`. */
export interface IngestRequest {
  readonly tenantId: string;
  readonly userId: string;
  readonly doc: IncomingDoc;
  readonly storageUrl: string;
  /** When the bytes were uploaded — defaults to now() in the ingest layer. */
  readonly uploadedAtIso?: string | undefined;
}

/** What `ingest()` returns to the chat / cockpit. */
export interface IngestReceipt {
  readonly uploadId: string;
  readonly status: CorpusUploadStatus;
  readonly chunksCount: number;
  readonly entitiesExtracted: number;
  readonly summary: Summary | null;
  readonly warnings: ReadonlyArray<string>;
  /** Five-key snapshot used to render the inline confirmation card. */
  readonly previewEntities: ReadonlyArray<{
    readonly kind: string;
    readonly displayName: string;
  }>;
  readonly errorMessage?: string | undefined;
}
