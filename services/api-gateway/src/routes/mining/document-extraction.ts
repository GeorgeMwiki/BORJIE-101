/**
 * document-extraction — synchronous, schema-guided field extraction for
 * uploaded documents.
 *
 * This is the wiring that turns the orphan `extractFormFields`
 * (`@borjie/document-ai/form-extraction`) into a real upload-time
 * capability:  upload → structured fields → persisted in `ocr_extractions`
 * → retrievable.
 *
 * Design notes / hard-rule compliance
 * -----------------------------------
 *  - Heuristic-only by default. We call `extractFormFields` WITHOUT a
 *    `brain` port so extraction is deterministic, fast enough to run
 *    inline in the request, and — critically — performs ZERO LLM egress.
 *    Because nothing leaves the process, the `pii-tokenise` egress control
 *    that `extractFormFields` applies before a brain call is a no-op here;
 *    matching the existing discipline (tokenisation guards egress, not
 *    at-rest storage). The LLM-augmented (brain) path is a deliberate
 *    follow-up that belongs in the async OCR worker — see the module that
 *    consumes this for the precise gap note.
 *
 *  - Real text source. At `/upload` time the document BINARY is not yet in
 *    object storage (the route only mints a presigned PUT). The real,
 *    available synchronous text is the caller-supplied `textSample` (the
 *    same first ≤4 KB the classifier already consumes). We extract over
 *    that. Full-document OCR text is the job of the async worker; until
 *    that lands, text-sample extraction is the honest synchronous slice.
 *
 *  - Persistence. Fields land in the canonical `ocr_extractions` table
 *    (`extracted_fields` + `confidence_scores` + `overall_confidence` +
 *    `raw_text`), and `document_uploads.ocr_extraction_id` is updated to
 *    point at the new row. Both tables are tenant-scoped via FORCE RLS
 *    (bound by `databaseMiddleware`); we also pass `tenantId` explicitly on
 *    writes/reads as belt-and-braces.
 *
 *  - Schemas. The pre-shipped Zod schemas cover lease / bank / id /
 *    invoice / receipt / utility-bill. Mining-specific documents (licence,
 *    royalty return, accountant export) have no bespoke schema yet, so they
 *    fall through to a GENERIC `Label: value` extractor. Bespoke mining
 *    schemas are a tracked follow-up.
 */

import { randomUUID } from 'node:crypto';
import {
  extractFormFields,
  type NamedSchema,
  leaseAgreementSchema,
  bankStatementSchema,
  idCardSchema,
  invoiceSchema,
  receiptSchema,
  utilityBillSchema,
} from '@borjie/document-ai/form-extraction';
import {
  buildPage,
  buildParsedDocument,
  type FormField,
  type ParsedDocument,
  type TextBlock,
} from '@borjie/document-ai';

// ---------------------------------------------------------------------------
// Schema selection
// ---------------------------------------------------------------------------

/**
 * Pick the best pre-shipped schema for a classified document, or `null`
 * when none fits (→ generic extraction).
 *
 * `documentType` is the `document_type` enum already derived in the upload
 * route; `kind` is the lightweight classifier kind. We key primarily off
 * `documentType` because it is the more specific signal.
 */
export function selectSchemaForDocument(input: {
  readonly documentType: string;
  readonly kind?: string;
}): NamedSchema | null {
  switch (input.documentType) {
    case 'lease_agreement':
      return leaseAgreementSchema;
    case 'bank_statement':
      return bankStatementSchema;
    case 'national_id':
    case 'passport':
    case 'driving_license':
      return idCardSchema;
    case 'receipt':
      return receiptSchema;
    case 'utility_bill':
      return utilityBillSchema;
    default:
      break;
  }
  // Secondary signal: an "invoice"-flavoured kind with no specific type.
  if (input.kind === 'invoice') return invoiceSchema;
  return null;
}

// ---------------------------------------------------------------------------
// Text → ParsedDocument
// ---------------------------------------------------------------------------

/**
 * Build a minimal single-page `ParsedDocument` from raw text. Each
 * non-empty line becomes a paragraph block so the heuristic extractor's
 * line-oriented keyword matcher can find `Label: value` pairs. Confidence
 * is fixed at 0.9 because text-sample text is exact (not OCR-noisy).
 */
export async function parsedDocumentFromText(input: {
  readonly documentId: string;
  readonly text: string;
  readonly sourceMime: string;
}): Promise<ParsedDocument> {
  const lines = input.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const blocks: ReadonlyArray<TextBlock> = lines.map((line, idx) => ({
    id: `b${idx}`,
    text: line,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    role: 'paragraph',
    confidence: 0.9,
  }));

  const page = buildPage({ pageNumber: 1, blocks });
  return buildParsedDocument({
    id: input.documentId,
    sourceMime: input.sourceMime,
    // The bytes aren't available synchronously; hash the text so the doc
    // still carries a stable, non-empty sha for citations.
    sourceBytes: new TextEncoder().encode(input.text),
    pages: [page],
    producedBy: 'text-sample',
  });
}

// ---------------------------------------------------------------------------
// Generic (schema-less) extraction
// ---------------------------------------------------------------------------

/**
 * Generic `Label: value` extractor for documents with no pre-shipped
 * schema (e.g. a mining licence or an accountant export). Mirrors the
 * heuristic matcher in `@borjie/document-ai` but is schema-free: any line
 * shaped `Some Label: some value` becomes a field keyed by a snake_cased
 * label. Lines without a colon, or with an empty value, are skipped.
 */
export function extractGenericFields(text: string): FormField[] {
  const out: FormField[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const colon = line.indexOf(':');
    if (colon <= 0) continue;

    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    // Guard: label must be a short, word-ish caption; value non-empty.
    if (label.length === 0 || label.length > 64) continue;
    if (value.length === 0 || value.length > 512) continue;
    if (!/[a-z]/i.test(label)) continue;

    const name = snakeCase(label);
    if (name.length === 0 || seen.has(name)) continue;
    seen.add(name);

    out.push({
      name,
      value,
      confidence: 0.7,
      source: null,
      origin: 'extracted',
    });
  }
  return out;
}

function snakeCase(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

// ---------------------------------------------------------------------------
// Orchestration: text → FormField[] → flat maps for persistence
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  /** All fields the extractor produced (schema or generic). */
  readonly fields: ReadonlyArray<FormField>;
  /** The schema id used, or `'generic'` when no schema matched. */
  readonly schemaId: string;
  /** `extracted_fields` jsonb payload — name → value (omits missing). */
  readonly extractedFields: Readonly<Record<string, unknown>>;
  /** `confidence_scores` jsonb payload — name → confidence (omits missing). */
  readonly confidenceScores: Readonly<Record<string, number>>;
  /** Mean confidence across non-missing fields, in [0,1]; 0 when none. */
  readonly overallConfidence: number;
}

/**
 * Run schema-guided (or generic) extraction over a document's text and
 * return both the rich `FormField[]` and the flat jsonb-ready maps the
 * `ocr_extractions` row needs. Heuristic-only — no brain port.
 */
export async function runFormExtraction(input: {
  readonly documentId: string;
  readonly text: string;
  readonly sourceMime: string;
  readonly documentType: string;
  readonly kind?: string;
}): Promise<ExtractionResult> {
  const schema = selectSchemaForDocument({
    documentType: input.documentType,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
  });

  let fields: ReadonlyArray<FormField>;
  let schemaId: string;

  if (schema) {
    const doc = await parsedDocumentFromText({
      documentId: input.documentId,
      text: input.text,
      sourceMime: input.sourceMime,
    });
    // Heuristic-only: no `brain` → zero LLM egress, deterministic output.
    fields = await extractFormFields({ doc, schema });
    schemaId = schema.id;
  } else {
    fields = extractGenericFields(input.text);
    schemaId = 'generic';
  }

  const found = fields.filter(
    (f) => f.origin !== 'missing' && f.value !== undefined && f.value !== null,
  );

  const extractedFields: Record<string, unknown> = {};
  const confidenceScores: Record<string, number> = {};
  for (const f of found) {
    extractedFields[f.name] = f.value;
    confidenceScores[f.name] = f.confidence;
  }

  const overallConfidence =
    found.length > 0
      ? found.reduce((sum, f) => sum + f.confidence, 0) / found.length
      : 0;

  return {
    fields,
    schemaId,
    extractedFields,
    confidenceScores,
    overallConfidence,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers (pure value-builders so the route stays thin and the
// shapes are unit-testable without a live db).
// ---------------------------------------------------------------------------

export interface OcrExtractionInsert {
  readonly id: string;
  readonly tenantId: string;
  readonly documentUploadId: string;
  readonly ocrProvider: string;
  readonly providerResponse: Readonly<Record<string, unknown>>;
  readonly extractedFields: Readonly<Record<string, unknown>>;
  readonly confidenceScores: Readonly<Record<string, number>>;
  readonly overallConfidence: string;
  readonly rawText: string;
  readonly validationStatus: string;
  readonly processingStartedAt: Date;
  readonly processingCompletedAt: Date;
  readonly processingDurationMs: number;
}

/** Drizzle `decimal` columns round-trip as strings. */
function confidenceToDecimalString(value: number): string {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped.toFixed(4);
}

/**
 * Build the `ocr_extractions` insert payload from an extraction result.
 * Pure — no I/O — so the persistence shape can be asserted in tests.
 */
export function buildOcrExtractionInsert(input: {
  readonly tenantId: string;
  readonly documentUploadId: string;
  readonly result: ExtractionResult;
  readonly rawText: string;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly extractionId?: string;
}): OcrExtractionInsert {
  return {
    id: input.extractionId ?? randomUUID(),
    tenantId: input.tenantId,
    documentUploadId: input.documentUploadId,
    ocrProvider: `heuristic-text-sample:${input.result.schemaId}`,
    providerResponse: { schemaId: input.result.schemaId, mode: 'heuristic' },
    extractedFields: input.result.extractedFields,
    confidenceScores: input.result.confidenceScores,
    overallConfidence: confidenceToDecimalString(input.result.overallConfidence),
    rawText: input.rawText,
    validationStatus: 'extracted',
    processingStartedAt: input.startedAt,
    processingCompletedAt: input.completedAt,
    processingDurationMs: Math.max(
      0,
      input.completedAt.getTime() - input.startedAt.getTime(),
    ),
  };
}
