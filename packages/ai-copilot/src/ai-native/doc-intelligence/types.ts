/**
 * Document entity + obligation extraction types.
 *
 * Works on any uploaded document (PDF, Word, image). The LLM owns:
 *   - language detection (ISO-639-1/-2)
 *   - entity extraction (parties, properties, dates, amounts, ...)
 *   - obligation extraction (who must do what, by when, consequence)
 *   - risk-flag detection (auto-renew, unlimited liability, ambiguous clauses)
 *
 * Every entity and obligation cites a character span into the canonical
 * document text so the UI can highlight "here's the line this came from".
 */

import type { Citation } from '../phl-common/types.js';

export type EntityKind =
  | 'party'
  | 'property'
  | 'unit'
  | 'date'
  | 'amount'
  | 'currency'
  | 'jurisdiction'
  | 'contract_kind'
  | 'reference'
  | 'other';

export interface ExtractedEntity {
  readonly id: string;
  readonly tenantId: string;
  readonly documentId: string;
  readonly entityKind: EntityKind;
  readonly entityValue: string;
  readonly entityRaw?: string;
  readonly normalizedForm: Readonly<Record<string, unknown>>;
  readonly languageCode: string | null;
  readonly spanStart: number | null;
  readonly spanEnd: number | null;
  readonly confidence: number | null;
  readonly embeddingRef: string | null;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly createdAt: string;
}

export interface ExtractedObligation {
  readonly id: string;
  readonly tenantId: string;
  readonly documentId: string;
  readonly obligor: string;
  readonly obligee: string | null;
  readonly actionSummary: string;
  readonly dueDate: string | null; // YYYY-MM-DD
  readonly recurrence: string | null;
  readonly consequenceIfMissed: string | null;
  readonly riskFlags: readonly string[];
  readonly languageCode: string | null;
  readonly spanStart: number | null;
  readonly spanEnd: number | null;
  readonly confidence: number | null;
  readonly modelVersion: string;
  readonly promptHash: string;
  readonly explanation: string | null;
  readonly createdAt: string;
}

export interface ExtractionInput {
  readonly tenantId: string;
  readonly documentId: string;
  readonly canonicalText: string;
  /**
   * Optional hint — if the caller already knows the document language, the
   * LLM can skip detection. MUST NOT default to 'en'.
   */
  readonly languageHint?: string;
  /** Jurisdiction hint — drives "missing standard clauses" risk flags. */
  readonly countryCode?: string;
}

export interface DocIntelligenceLLMOutput {
  readonly detectedLanguage: string; // ISO-639-1/-2
  readonly entities: readonly Omit<
    ExtractedEntity,
    'id' | 'tenantId' | 'documentId' | 'modelVersion' | 'promptHash' | 'createdAt' | 'embeddingRef'
  >[];
  readonly obligations: readonly Omit<
    ExtractedObligation,
    'id' | 'tenantId' | 'documentId' | 'modelVersion' | 'promptHash' | 'createdAt'
  >[];
  readonly modelVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsdMicro: number;
}

export interface DocIntelligenceLLMPort {
  extract(input: {
    readonly text: string;
    readonly languageHint?: string;
    readonly countryCode?: string;
    readonly promptHash: string;
  }): Promise<DocIntelligenceLLMOutput>;
}

export interface SemanticMemoryPort {
  /**
   * Write an entity embedding to the memory layer and return an opaque
   * handle the UI can use to call back. Implementations decide the vector
   * dialect (pgvector, external vector DB, in-memory fallback for tests).
   */
  recordEntityEmbedding(input: {
    readonly tenantId: string;
    readonly documentId: string;
    readonly entityValue: string;
    readonly entityKind: EntityKind;
  }): Promise<{ readonly embeddingRef: string } | null>;
}

export interface DocIntelligenceRepository {
  insertEntities(rows: readonly ExtractedEntity[]): Promise<void>;
  insertObligations(rows: readonly ExtractedObligation[]): Promise<void>;
  listEntities(
    tenantId: string,
    documentId: string,
  ): Promise<readonly ExtractedEntity[]>;
  listObligations(
    tenantId: string,
    documentId: string,
  ): Promise<readonly ExtractedObligation[]>;
}

export interface DocIntelligenceResult {
  readonly documentId: string;
  readonly detectedLanguage: string;
  readonly entities: readonly ExtractedEntity[];
  readonly obligations: readonly ExtractedObligation[];
  readonly citations: readonly Citation[];
  readonly modelVersion: string;
  readonly promptHash: string;
}
