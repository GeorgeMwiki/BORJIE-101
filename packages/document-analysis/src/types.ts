/**
 * @borjie/document-analysis — types + Zod schemas.
 *
 * Mirrors the SQL shape from migrations 0211-0214. These are the public
 * runtime contracts of the document-analysis pipeline. Every persistence
 * boundary validates against the schemas here so the JSONB columns can
 * never be corrupted by a sloppy producer.
 */

import { z } from 'zod';

// ─── documents (0211) ─────────────────────────────────────────────────────

export const ProcessingStateSchema = z.enum([
  'pending',
  'ocr_done',
  'parsed',
  'extracted',
  'routed',
  'done',
  'error',
]);
export type ProcessingState = z.infer<typeof ProcessingStateSchema>;

export const SourceChannelSchema = z.enum([
  'web_upload',
  'whatsapp_attach',
  'email',
  'agent',
]);
export type SourceChannel = z.infer<typeof SourceChannelSchema>;

export const OcrLanguageSchema = z.enum(['en', 'sw', 'mixed']);
export type OcrLanguage = z.infer<typeof OcrLanguageSchema>;

export const DocumentSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  uploadedByUserId: z.string().nullable(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storagePath: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 hex chars'),
  pageCount: z.number().int().nonnegative().nullable(),
  ocrText: z.string().nullable(),
  ocrLanguage: OcrLanguageSchema.nullable(),
  processingState: ProcessingStateSchema,
  processingError: z.string().nullable(),
  sourceChannel: SourceChannelSchema.nullable(),
  relatedThreadId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type Document = z.infer<typeof DocumentSchema>;

// ─── document_extractions (0212) ──────────────────────────────────────────

export const ExtractionKindSchema = z.enum([
  'doc_type',
  'entity',
  'amount',
  'date',
  'address',
  'signature',
  'stamp',
  'photo_region',
  'table_row',
  'clause',
]);
export type ExtractionKind = z.infer<typeof ExtractionKindSchema>;

export const SourceMethodSchema = z.enum([
  'ocr',
  'layout',
  'llm_extract',
  'rule',
]);
export type SourceMethod = z.infer<typeof SourceMethodSchema>;

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().nonnegative(),
  h: z.number().nonnegative(),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const ExtractionSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  tenantId: z.string().min(1),
  extractionKind: ExtractionKindSchema,
  key: z.string().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().nonnegative().nullable(),
  bbox: BBoxSchema.nullable(),
  sourceMethod: SourceMethodSchema,
  createdAt: z.date(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// ─── document_entities (0213) ─────────────────────────────────────────────

export const ResolutionMethodSchema = z.enum([
  'exact_match',
  'fuzzy',
  'embedding',
  'hitl_confirmed',
]);
export type ResolutionMethod = z.infer<typeof ResolutionMethodSchema>;

export const HitlStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type HitlStatus = z.infer<typeof HitlStatusSchema>;

export const DocumentEntitySchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  tenantId: z.string().min(1),
  extractionId: z.string().min(1),
  resolvedEntityId: z.string().nullable(),
  resolutionConfidence: z.number().min(0).max(1),
  resolutionMethod: ResolutionMethodSchema,
  resolutionHitlStatus: HitlStatusSchema.nullable(),
  createdAt: z.date(),
});
export type DocumentEntity = z.infer<typeof DocumentEntitySchema>;

// ─── document_routing (0214) ──────────────────────────────────────────────

export const TargetModuleSchema = z.enum([
  'estate',
  'finance',
  'compliance',
  'hr',
  'legal',
  'crm',
  'inventory',
]);
export type TargetModule = z.infer<typeof TargetModuleSchema>;

export const RoutingStatusSchema = z.enum([
  'pending',
  'applied',
  'rejected',
  'error',
]);
export type RoutingStatus = z.infer<typeof RoutingStatusSchema>;

export const RoutingSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  tenantId: z.string().min(1),
  targetModule: TargetModuleSchema,
  targetAction: z.string().min(1),
  targetEntityId: z.string().nullable(),
  status: RoutingStatusSchema,
  reasoning: z.record(z.unknown()).nullable(),
  hitlRequired: z.boolean(),
  appliedAt: z.date().nullable(),
  createdAt: z.date(),
});
export type Routing = z.infer<typeof RoutingSchema>;

// ─── Doc taxonomy ─────────────────────────────────────────────────────────

export const DocTypeSchema = z.enum([
  'lease_application',
  'lease_contract',
  'payment_receipt',
  'national_id',
  'condition_survey',
  'complaint_letter',
  'renewal_request',
  'termination_notice',
  'vendor_invoice',
  'unknown',
]);
export type DocType = z.infer<typeof DocTypeSchema>;

// ─── Ingest input ────────────────────────────────────────────────────────

export const IngestInputSchema = z.object({
  tenantId: z.string().min(1),
  uploadedByUserId: z.string().nullable().optional(),
  filename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  /**
   * The file content. Either a Buffer (binary) or a string (plain text /
   * already-OCRed). The ingest layer computes sha256 and persists.
   */
  content: z.union([z.instanceof(Buffer), z.string()]),
  sourceChannel: SourceChannelSchema.optional(),
  relatedThreadId: z.string().nullable().optional(),
});
export type IngestInput = z.infer<typeof IngestInputSchema>;

// ─── Threshold knobs ──────────────────────────────────────────────────────

/**
 * Confidence thresholds used across the pipeline. Centralised so they
 * are testable and tunable from a single place.
 */
export const THRESHOLDS = Object.freeze({
  /** Below this, an extraction is HITL-flagged. */
  HITL_EXTRACTION: 0.7,
  /** Below this, entity resolution is HITL-flagged. */
  HITL_RESOLUTION: 0.75,
  /** At or above this, routing auto-applies. */
  AUTO_APPLY_ROUTING: 0.8,
  /** Doc-classifier minimum to be considered confident. */
  DOC_TYPE_CONFIDENT: 0.55,
});
