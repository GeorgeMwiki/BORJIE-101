/**
 * Repository + event ports. The package depends on these interfaces; the
 * adapter (postgres-backed, in-memory for tests) is wired by the caller.
 * Keeps the package side-effect-free + portable.
 */

import type {
  Document,
  DocumentEntity,
  Extraction,
  Routing,
  SourceChannel,
  ProcessingState,
} from './types.js';

// ─── Document repository ──────────────────────────────────────────────────

export interface CreateDocumentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly uploadedByUserId: string | null;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly sha256: string;
  readonly sourceChannel: SourceChannel | null;
  readonly relatedThreadId: string | null;
}

export interface IDocumentRepository {
  create(input: CreateDocumentInput): Promise<Document>;
  findById(tenantId: string, id: string): Promise<Document | null>;
  findBySha256(tenantId: string, sha256: string): Promise<Document | null>;
  updateState(
    tenantId: string,
    id: string,
    state: ProcessingState,
    extra?: {
      ocrText?: string;
      ocrLanguage?: 'en' | 'sw' | 'mixed';
      pageCount?: number;
      processingError?: string;
    },
  ): Promise<Document>;
}

// ─── Extraction repository ────────────────────────────────────────────────

export interface CreateExtractionInput {
  readonly id: string;
  readonly documentId: string;
  readonly tenantId: string;
  readonly extractionKind: Extraction['extractionKind'];
  readonly key: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly page: number | null;
  readonly bbox: Extraction['bbox'];
  readonly sourceMethod: Extraction['sourceMethod'];
}

export interface IExtractionRepository {
  createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateExtractionInput>,
  ): Promise<ReadonlyArray<Extraction>>;
  findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<Extraction>>;
  findById(tenantId: string, id: string): Promise<Extraction | null>;
}

// ─── Entity repository ────────────────────────────────────────────────────

export interface CreateEntityInput {
  readonly id: string;
  readonly documentId: string;
  readonly tenantId: string;
  readonly extractionId: string;
  readonly resolvedEntityId: string | null;
  readonly resolutionConfidence: number;
  readonly resolutionMethod: DocumentEntity['resolutionMethod'];
  readonly resolutionHitlStatus: DocumentEntity['resolutionHitlStatus'];
}

export interface IEntityRepository {
  createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateEntityInput>,
  ): Promise<ReadonlyArray<DocumentEntity>>;
  findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<DocumentEntity>>;
}

// ─── Routing repository ───────────────────────────────────────────────────

export interface CreateRoutingInput {
  readonly id: string;
  readonly documentId: string;
  readonly tenantId: string;
  readonly targetModule: Routing['targetModule'];
  readonly targetAction: string;
  readonly targetEntityId: string | null;
  readonly status: Routing['status'];
  readonly reasoning: Record<string, unknown> | null;
  readonly hitlRequired: boolean;
}

export interface IRoutingRepository {
  createMany(
    tenantId: string,
    inputs: ReadonlyArray<CreateRoutingInput>,
  ): Promise<ReadonlyArray<Routing>>;
  findByDocument(
    tenantId: string,
    documentId: string,
  ): Promise<ReadonlyArray<Routing>>;
}

// ─── Storage port ─────────────────────────────────────────────────────────

export interface PutObjectInput {
  readonly tenantId: string;
  readonly key: string;
  readonly body: Buffer | string;
  readonly mimeType: string;
}

/**
 * Storage abstraction — Supabase Storage / S3 / etc. wired by the host.
 * We never bake in a storage backend; the caller supplies one.
 */
export interface IDocumentStorage {
  putObject(input: PutObjectInput): Promise<{ readonly storagePath: string }>;
  getObject(
    tenantId: string,
    storagePath: string,
  ): Promise<Buffer>;
}

// ─── Entity resolver port (against core_entity, when it lands) ────────────

export interface EntityCandidate {
  readonly entityId: string;
  readonly displayName: string;
  /** Optional embedding for semantic search. */
  readonly embedding?: ReadonlyArray<number>;
  readonly kind?: string;
}

export interface IEntityResolver {
  /**
   * Look up a candidate by canonical name within the tenant. Used for
   * exact + fuzzy match. Returns up to `limit` candidates ranked by the
   * adapter's own scoring.
   */
  searchByName(
    tenantId: string,
    query: string,
    limit: number,
  ): Promise<ReadonlyArray<EntityCandidate>>;

  /**
   * Find candidates near `embedding`. Adapter may use pgvector / Pinecone /
   * any other store.
   */
  searchByEmbedding(
    tenantId: string,
    embedding: ReadonlyArray<number>,
    limit: number,
  ): Promise<ReadonlyArray<EntityCandidate>>;
}

// ─── Event bus port ───────────────────────────────────────────────────────

export interface PipelineEvent {
  readonly tenantId: string;
  readonly documentId: string;
  readonly stage:
    | 'ingested'
    | 'ocr_done'
    | 'parsed'
    | 'extracted'
    | 'resolved'
    | 'routed'
    | 'done'
    | 'error';
  readonly at: Date;
  readonly metadata?: Record<string, unknown>;
}

export interface IEventBus {
  emit(event: PipelineEvent): Promise<void> | void;
}

// ─── LLM port (Anthropic vision + structured output) ──────────────────────

export interface LlmClassifyInput {
  readonly text: string;
  readonly language?: 'en' | 'sw' | 'mixed';
}

export interface LlmClassifyOutput {
  readonly docType: string;
  readonly confidence: number;
  readonly rationale?: string;
}

export interface LlmExtractInput {
  readonly text: string;
  readonly schema: Record<string, unknown>; // Zod jsonSchema in practice
  readonly language?: 'en' | 'sw' | 'mixed';
}

export interface LlmExtractOutput {
  readonly fields: Record<string, unknown>;
  readonly confidence: number;
}

export interface ILlmClient {
  classify(input: LlmClassifyInput): Promise<LlmClassifyOutput>;
  extract(input: LlmExtractInput): Promise<LlmExtractOutput>;
}
