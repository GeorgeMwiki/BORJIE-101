/**
 * Async per-upload OCR + full-text extraction task (Wave DOC-INTEL).
 *
 * Closes the synchronous-extraction gap documented in
 * `services/api-gateway/src/routes/mining/document-intelligence.hono.ts`
 * and `…/document-extraction.ts`:
 *
 *   P2b wired SYNCHRONOUS, heuristic-only field extraction into
 *   `POST /upload`, but it can only see the caller-supplied `textSample`
 *   (the ≤4 KB first slice the classifier consumes). At `/upload` time the
 *   binary is NOT in object storage yet — the route only mints a presigned
 *   PUT. The real document text only exists AFTER the FE PUTs the bytes and
 *   `ingestion_status` flips to `ready`.
 *
 * This task runs AFTER that flip. For each ready document it:
 *
 *   1. Fetches the binary from object storage (the same Supabase Storage
 *      bucket the upload route presigns into).
 *   2. Runs a REAL, SSRF-guarded OCR adapter from `@borjie/document-ai/ocr`
 *      → a `ParsedDocument` with FULL text (not the 4 KB sample).
 *   3. Re-runs schema-guided extraction over the FULL text WITH a real
 *      `BrainPort` (LLM-augmented). `extractFormFields` PII-tokenises before
 *      the brain call and restores after, so the LLM never sees raw IDs.
 *   4. UPSERTs the `ocr_extractions` row keyed on `document_upload_id`
 *      (inserts a NEW higher-confidence row; the retrieval route returns the
 *      newest by `created_at`, so the async row supersedes the heuristic one
 *      without mutating it), back-points `document_uploads.ocr_extraction_id`,
 *      and hash-chains the extraction event into `ai_audit_chain`.
 *
 * ---------------------------------------------------------------------------
 * Architecture — ports, not adapters
 * ---------------------------------------------------------------------------
 *
 * The orchestration here is PURE and dependency-injected: storage, OCR, the
 * brain-augmented extractor, and the DB are all ports. This module never
 * imports `@borjie/document-ai`, `@supabase/supabase-js`, or
 * `document-extraction.ts` directly — `@borjie/document-ai` is NOT a
 * dependency of this worker (it is a dependency of api-gateway), so the
 * concrete adapters are resolved through the SAME sibling-service dynamic
 * import pattern this worker already uses for `db-client`, the owner-brief
 * composer, and the constitutional critic (see `../index.ts`). The concrete
 * wiring lives in api-gateway and is built by
 * `buildOcrExtractionAdapters()` (exported from
 * `…/routes/mining/document-intelligence.hono.ts`).
 *
 * Because the orchestration is port-shaped, the unit test mocks OCR + brain
 * + storage + db with zero install and zero network.
 *
 * ---------------------------------------------------------------------------
 * RLS / tenant isolation
 * ---------------------------------------------------------------------------
 *
 * Workers bypass `databaseMiddleware`, so the pooled connection carries NO
 * `app.current_tenant_id` GUC. Every tenant-scoped block here is wrapped in
 * `withWorkerTenantContext(db, tenantId, …)` — BEGIN; SET LOCAL
 * app.{current_tenant_id,tenant_id}; <body>; COMMIT — exactly mirroring
 * `services/api-gateway/src/workers/with-tenant-context.ts` (audit gap G8)
 * and the brain-teach `SET LOCAL` pattern. The binding is transaction-local
 * and cannot leak onto the pooled connection.
 *
 * ---------------------------------------------------------------------------
 * Honesty — what needs runtime validation
 * ---------------------------------------------------------------------------
 *
 *   - OCR adapter + storage fetch + BrainPort are REAL wiring but need
 *     RUNTIME (binaries / API keys / a reachable storage bucket). The
 *     concrete factory (`buildOcrExtractionAdapters`) degrades to a no-op
 *     when its inputs are unwired and logs precisely why; this task then
 *     records a per-document skip rather than silently stubbing. The exact
 *     runtime requirements are listed in that factory and in the task return
 *     report. NOTHING here fabricates extracted fields.
 */

import { logger } from '../logger.js';
import {
  withWorkerTenantContext,
  type TenantContextDbLike,
} from './with-worker-tenant-context.js';

// ─────────────────────────────────────────────────────────────────────
// Public types — ports
// ─────────────────────────────────────────────────────────────────────

/** Minimum DB surface — raw `execute(q)`, matching the worker convention. */
export interface OcrExtractionDb extends TenantContextDbLike {
  execute(query: unknown): Promise<unknown>;
}

/** A document row the poll selected as ready-but-not-yet-async-extracted. */
export interface ReadyDocument {
  readonly documentId: string;
  readonly tenantId: string;
  readonly mimeType: string;
  readonly documentType: string;
  readonly kind: string;
  readonly fileName: string;
  /** Where the binary lives (bucket/path or fileUrl) — opaque to this task. */
  readonly fileUrl: string;
}

/** Fetches the raw document bytes from object storage. */
export interface StorageFetchPort {
  /**
   * Resolve the document binary. Returns `null` when the object is not
   * found / storage is unwired so the task can skip (never throw-to-crash).
   */
  fetch(doc: ReadyDocument): Promise<{
    readonly bytes: Uint8Array;
    readonly mime: string;
  } | null>;
}

/** Normalised OCR result — full document text + the adapter that produced it. */
export interface OcrResult {
  /** Full extracted text across all pages (NOT the 4 KB sample). */
  readonly text: string;
  /** Adapter id, e.g. `docling` / `anthropic-vision` — for provenance. */
  readonly producedBy: string;
  /** Best-effort dominant language code (ISO 639-1) for the row. */
  readonly dominantLanguage?: string;
}

/** Runs a real, SSRF-guarded OCR adapter over the bytes. */
export interface OcrPort {
  /** Stable id of the underlying adapter (provenance + logging). */
  readonly id: string;
  recognize(input: {
    readonly bytes: Uint8Array;
    readonly mime: string;
    readonly correlationId?: string;
  }): Promise<OcrResult>;
}

/** Flat, jsonb-ready extraction result mirroring `document-extraction.ts`. */
export interface ExtractionOutcome {
  readonly schemaId: string;
  readonly extractedFields: Readonly<Record<string, unknown>>;
  readonly confidenceScores: Readonly<Record<string, number>>;
  readonly overallConfidence: number;
  /** `true` when a real BrainPort augmented the heuristic baseline. */
  readonly brainAugmented: boolean;
}

/**
 * Schema-guided field extraction over the FULL OCR text, optionally
 * LLM-augmented. Implemented in api-gateway by reusing
 * `runFormExtraction` / `extractFormFields` (PII-safe) from
 * `document-extraction.ts` + `@borjie/document-ai`.
 */
export interface BrainExtractPort {
  extract(input: {
    readonly documentId: string;
    readonly text: string;
    readonly sourceMime: string;
    readonly documentType: string;
    readonly kind: string;
  }): Promise<ExtractionOutcome>;
}

/** Per-document deps bundle. */
export interface OcrExtractionDeps {
  readonly db: OcrExtractionDb;
  readonly storage: StorageFetchPort;
  readonly ocr: OcrPort;
  readonly extractor: BrainExtractPort;
  /** Stable provider tag for the ocr_extractions.ocr_provider column. */
  readonly providerTag?: string;
}

export type OcrExtractionStatus =
  | 'extracted'
  | 'no_text'
  | 'storage_miss'
  | 'failed';

export interface OcrExtractionResult {
  readonly documentId: string;
  readonly tenantId: string;
  readonly status: OcrExtractionStatus;
  readonly extractionId: string | null;
  readonly schemaId: string | null;
  readonly fieldCount: number;
  readonly overallConfidence: number;
  readonly producedBy: string | null;
  readonly brainAugmented: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Provider tag — how the async row is distinguished from the synchronous
// heuristic row. The retrieval route returns newest-by-createdAt, so the
// async row naturally supersedes; the prefix also lets the poll skip docs
// that already have an async extraction (idempotency).
// ─────────────────────────────────────────────────────────────────────

export const ASYNC_OCR_PROVIDER_PREFIX = 'async-ocr';

function buildProviderTag(ocrId: string, schemaId: string, augmented: boolean): string {
  const mode = augmented ? 'brain' : 'heuristic';
  return `${ASYNC_OCR_PROVIDER_PREFIX}:${ocrId}:${schemaId}:${mode}`;
}

// ─────────────────────────────────────────────────────────────────────
// Core: run the async OCR-extraction step for ONE ready document.
//
// Pure orchestration: every side effect is behind a port. Never throws —
// a failure is captured as a `failed` result so the batch (or the route's
// fire-and-forget enqueue) is never poisoned by one bad document.
// ─────────────────────────────────────────────────────────────────────

export async function runOcrExtractionForDocument(
  deps: OcrExtractionDeps,
  doc: ReadyDocument,
): Promise<OcrExtractionResult> {
  const base = {
    documentId: doc.documentId,
    tenantId: doc.tenantId,
    extractionId: null,
    schemaId: null,
    fieldCount: 0,
    overallConfidence: 0,
    producedBy: null,
    brainAugmented: false,
  } as const;

  try {
    // 1) Fetch the binary now that it is in storage.
    const blob = await deps.storage.fetch(doc);
    if (!blob || blob.bytes.length === 0) {
      logger.warn('ocr-extraction: storage miss — skipping document', {
        tenantId: doc.tenantId,
        documentId: doc.documentId,
        fileUrl: doc.fileUrl,
      });
      return { ...base, status: 'storage_miss' };
    }

    // 2) Real OCR → full text.
    const startedAt = new Date();
    const ocr = await deps.ocr.recognize({
      bytes: blob.bytes,
      mime: blob.mime || doc.mimeType,
      correlationId: `ocr-${doc.documentId}`,
    });
    const fullText = ocr.text.trim();
    if (fullText.length === 0) {
      logger.warn('ocr-extraction: OCR produced no text — skipping extraction', {
        tenantId: doc.tenantId,
        documentId: doc.documentId,
        producedBy: ocr.producedBy,
      });
      // Still mark the document so the poll does not loop on it forever:
      // persist an empty async row carrying the producedBy provenance.
      await persistExtraction(deps, doc, {
        startedAt,
        completedAt: new Date(),
        ocrProducedBy: ocr.producedBy,
        rawText: '',
        outcome: {
          schemaId: 'none',
          extractedFields: {},
          confidenceScores: {},
          overallConfidence: 0,
          brainAugmented: false,
        },
      });
      return { ...base, status: 'no_text', producedBy: ocr.producedBy };
    }

    // 3) Schema-guided extraction over the FULL text, brain-augmented + PII-safe.
    const outcome = await deps.extractor.extract({
      documentId: doc.documentId,
      text: fullText,
      sourceMime: blob.mime || doc.mimeType,
      documentType: doc.documentType,
      kind: doc.kind,
    });
    const completedAt = new Date();

    // 4) Persist (UPSERT-by-insert-newest), back-point, audit-append.
    const extractionId = await persistExtraction(deps, doc, {
      startedAt,
      completedAt,
      ocrProducedBy: ocr.producedBy,
      rawText: fullText,
      outcome,
    });

    const fieldCount = Object.keys(outcome.extractedFields).length;
    logger.info('ocr-extraction: document extracted', {
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      extractionId,
      ocrAdapter: ocr.producedBy,
      schemaId: outcome.schemaId,
      brainAugmented: outcome.brainAugmented,
      fieldCount,
      overallConfidence: outcome.overallConfidence,
    });

    return {
      ...base,
      status: 'extracted',
      extractionId,
      schemaId: outcome.schemaId,
      fieldCount,
      overallConfidence: outcome.overallConfidence,
      producedBy: ocr.producedBy,
      brainAugmented: outcome.brainAugmented,
    };
  } catch (err) {
    logger.error('ocr-extraction: document failed', {
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      reason: messageOf(err),
    });
    return { ...base, status: 'failed' };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Persistence — tenant-scoped via SET LOCAL, raw SQL so this worker has
// zero compile-time coupling to the Drizzle `document_uploads` /
// `ocr_extractions` schema objects (which today lag the live columns added
// by migration 0083; raw SQL targets the real columns). Mirrors the shape
// `buildOcrExtractionInsert` produces in document-extraction.ts.
// ─────────────────────────────────────────────────────────────────────

interface PersistArgs {
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly ocrProducedBy: string;
  readonly rawText: string;
  readonly outcome: ExtractionOutcome;
}

async function persistExtraction(
  deps: OcrExtractionDeps,
  doc: ReadyDocument,
  args: PersistArgs,
): Promise<string> {
  const extractionId = randomUuid();
  const providerTag =
    deps.providerTag ??
    buildProviderTag(args.ocrProducedBy, args.outcome.schemaId, args.outcome.brainAugmented);
  const durationMs = Math.max(0, args.completedAt.getTime() - args.startedAt.getTime());
  const overallConfidence = clampConfidence(args.outcome.overallConfidence).toFixed(4);
  const fieldCount = Object.keys(args.outcome.extractedFields).length;

  await withWorkerTenantContext(deps.db, doc.tenantId, async () => {
    await runInsertExtraction(deps.db, {
      extractionId,
      tenantId: doc.tenantId,
      documentUploadId: doc.documentId,
      providerTag,
      providerResponse: JSON.stringify({
        schemaId: args.outcome.schemaId,
        ocrAdapter: args.ocrProducedBy,
        mode: args.outcome.brainAugmented ? 'brain' : 'heuristic',
      }),
      extractedFields: JSON.stringify(args.outcome.extractedFields),
      confidenceScores: JSON.stringify(args.outcome.confidenceScores),
      overallConfidence,
      rawText: args.rawText,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      durationMs,
    });

    await runBackpointUpload(deps.db, {
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      extractionId,
      updatedAt: args.completedAt,
    });

    await runAuditAppend(deps.db, {
      tenantId: doc.tenantId,
      documentId: doc.documentId,
      extractionId,
      schemaId: args.outcome.schemaId,
      fieldCount,
      overallConfidence: args.outcome.overallConfidence,
      brainAugmented: args.outcome.brainAugmented,
      ocrAdapter: args.ocrProducedBy,
      completedAt: args.completedAt,
    });
  });

  return extractionId;
}

async function runInsertExtraction(
  db: OcrExtractionDb,
  v: {
    readonly extractionId: string;
    readonly tenantId: string;
    readonly documentUploadId: string;
    readonly providerTag: string;
    readonly providerResponse: string;
    readonly extractedFields: string;
    readonly confidenceScores: string;
    readonly overallConfidence: string;
    readonly rawText: string;
    readonly startedAt: Date;
    readonly completedAt: Date;
    readonly durationMs: number;
  },
): Promise<void> {
  const sql = await sqlTag();
  await db.execute(sql`
    INSERT INTO ocr_extractions
      (id, tenant_id, document_upload_id, processing_started_at,
       processing_completed_at, processing_duration_ms, ocr_provider,
       provider_response, extracted_fields, confidence_scores,
       overall_confidence, raw_text, validation_status, created_at, updated_at)
    VALUES (
      ${v.extractionId},
      ${v.tenantId},
      ${v.documentUploadId},
      ${v.startedAt.toISOString()}::timestamptz,
      ${v.completedAt.toISOString()}::timestamptz,
      ${v.durationMs},
      ${v.providerTag},
      ${v.providerResponse}::jsonb,
      ${v.extractedFields}::jsonb,
      ${v.confidenceScores}::jsonb,
      ${v.overallConfidence}::numeric,
      ${v.rawText},
      ${'extracted'},
      ${v.completedAt.toISOString()}::timestamptz,
      ${v.completedAt.toISOString()}::timestamptz
    )
  `);
}

async function runBackpointUpload(
  db: OcrExtractionDb,
  v: {
    readonly tenantId: string;
    readonly documentId: string;
    readonly extractionId: string;
    readonly updatedAt: Date;
  },
): Promise<void> {
  const sql = await sqlTag();
  // tenantId predicate is belt-and-braces on top of FORCE RLS + SET LOCAL.
  await db.execute(sql`
    UPDATE document_uploads
       SET ocr_extraction_id = ${v.extractionId},
           updated_at = ${v.updatedAt.toISOString()}::timestamptz
     WHERE tenant_id = ${v.tenantId}
       AND id = ${v.documentId}
  `);
}

async function runAuditAppend(
  db: OcrExtractionDb,
  v: {
    readonly tenantId: string;
    readonly documentId: string;
    readonly extractionId: string;
    readonly schemaId: string;
    readonly fieldCount: number;
    readonly overallConfidence: number;
    readonly brainAugmented: boolean;
    readonly ocrAdapter: string;
    readonly completedAt: Date;
  },
): Promise<void> {
  const sql = await sqlTag();
  // Hash-chained, append-only — mirrors the synchronous extraction audit in
  // document-intelligence.hono.ts. Best-effort: a chain gap is logged but
  // never blocks the extraction (the row is already persisted above).
  try {
    const payload = JSON.stringify({
      action: 'mining.document.extraction',
      documentId: v.documentId,
      extractionId: v.extractionId,
      schemaId: v.schemaId,
      fieldCount: v.fieldCount,
      overallConfidence: v.overallConfidence,
      ocrAdapter: v.ocrAdapter,
      mode: v.brainAugmented ? 'brain-async' : 'heuristic-async',
    });
    const hashInput = JSON.stringify({
      documentId: v.documentId,
      extractionId: v.extractionId,
      tenantId: v.tenantId,
      schemaId: v.schemaId,
      fieldCount: v.fieldCount,
    });
    await db.execute(sql`
      WITH prev AS (
        SELECT this_hash, sequence_id
          FROM ai_audit_chain
         WHERE tenant_id = ${v.tenantId}
         ORDER BY sequence_id DESC
         LIMIT 1
      )
      INSERT INTO ai_audit_chain
        (id, tenant_id, sequence_id, turn_id, session_id, action,
         prev_hash, this_hash, payload_ref, payload, created_at)
      VALUES (
        ${randomUuid()},
        ${v.tenantId},
        COALESCE((SELECT sequence_id FROM prev), 0) + 1,
        ${`doc-extract-async-${v.documentId}`},
        NULL,
        ${'mining.document.extraction'},
        COALESCE((SELECT this_hash FROM prev), ''),
        encode(sha256(
          (COALESCE((SELECT this_hash FROM prev), '') || ${hashInput})::bytea
        ), 'hex'),
        NULL,
        ${payload}::jsonb,
        ${v.completedAt.toISOString()}::timestamptz
      )
    `);
  } catch (auditErr) {
    logger.warn('ocr-extraction: audit-chain append failed', {
      tenantId: v.tenantId,
      documentId: v.documentId,
      reason: messageOf(auditErr),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Poll: select ready documents lacking an async OCR extraction and run
// the step for each. The trigger when `ingestion_status` flips to `ready`.
//
// Idempotent: a document is "needs-async-OCR" iff it is `ready` AND has no
// ocr_extractions row whose provider starts with the async prefix. Once the
// async row lands the document drops out of the candidate set.
//
// The candidate SELECT is intentionally NOT tenant-GUC-bound (it spans all
// tenants to discover work); every WRITE for a given document is wrapped in
// that document's tenant context inside runOcrExtractionForDocument →
// persistExtraction. The SELECT reads only id/tenant/mime metadata (no
// tenant-private field values), and a service-role worker connection is the
// canonical cross-tenant discovery surface (same as the reservoir source).
// ─────────────────────────────────────────────────────────────────────

export interface PollOptions {
  /** Max documents to process per poll tick. Default 25. */
  readonly batchSize?: number;
}

export interface PollResult {
  readonly scanned: number;
  readonly extracted: number;
  readonly skipped: number;
  readonly failed: number;
}

export async function pollAndRunOcrExtractions(
  deps: OcrExtractionDeps,
  options: PollOptions = {},
): Promise<PollResult> {
  const batchSize = clampBatch(options.batchSize, 25);
  let candidates: ReadonlyArray<ReadyDocument>;
  try {
    candidates = await selectReadyDocuments(deps.db, batchSize);
  } catch (err) {
    logger.warn('ocr-extraction: candidate select failed (schema may be pre-0083)', {
      reason: messageOf(err),
    });
    return { scanned: 0, extracted: 0, skipped: 0, failed: 0 };
  }

  let extracted = 0;
  let skipped = 0;
  let failed = 0;
  for (const doc of candidates) {
    const result = await runOcrExtractionForDocument(deps, doc);
    if (result.status === 'extracted') extracted += 1;
    else if (result.status === 'failed') failed += 1;
    else skipped += 1;
  }

  logger.info('ocr-extraction: poll tick complete', {
    scanned: candidates.length,
    extracted,
    skipped,
    failed,
  });
  return { scanned: candidates.length, extracted, skipped, failed };
}

async function selectReadyDocuments(
  db: OcrExtractionDb,
  limit: number,
): Promise<ReadonlyArray<ReadyDocument>> {
  const sql = await sqlTag();
  const result = (await db.execute(sql`
    SELECT du.id            AS document_id,
           du.tenant_id     AS tenant_id,
           du.mime_type     AS mime_type,
           du.document_type::text AS document_type,
           du.kind          AS kind,
           du.file_name     AS file_name,
           du.file_url      AS file_url
      FROM document_uploads du
     WHERE du.ingestion_status = 'ready'
       AND du.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM ocr_extractions oe
          WHERE oe.document_upload_id = du.id
            AND oe.ocr_provider LIKE ${`${ASYNC_OCR_PROVIDER_PREFIX}:%`}
       )
     ORDER BY du.updated_at ASC
     LIMIT ${limit}
  `)) as unknown;

  const rows = rowsOf(result);
  const out: ReadyDocument[] = [];
  for (const r of rows) {
    const documentId = asString(r.document_id);
    const tenantId = asString(r.tenant_id);
    if (!documentId || !tenantId) continue;
    out.push({
      documentId,
      tenantId,
      mimeType: asString(r.mime_type) ?? 'application/octet-stream',
      documentType: asString(r.document_type) ?? 'other',
      kind: asString(r.kind) ?? 'other',
      fileName: asString(r.file_name) ?? documentId,
      fileUrl: asString(r.file_url) ?? '',
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Default adapter resolution — sibling-service dynamic import.
//
// `@borjie/document-ai`, `@supabase/supabase-js`, and the
// `document-extraction.ts` helpers are NOT reachable from this worker's
// module graph (document-ai is not a dependency here). They ARE reachable
// from api-gateway, where `buildOcrExtractionAdapters()` wires the real
// Supabase download + real SSRF-guarded OCR adapter + real BrainPort +
// reuse of runFormExtraction/extractFormFields/buildOcrExtractionInsert.
//
// We load that factory from the api-gateway dist exactly like
// `../index.ts` loads `db-client`, and like `owner-brief-cron.ts` loads the
// brief composer. A missing dist (fresh checkout / unit test) resolves to
// `null` and the supervisor logs + no-ops — never a silent stub.
// ─────────────────────────────────────────────────────────────────────

export interface GatewayOcrAdapters {
  readonly storage: StorageFetchPort;
  readonly ocr: OcrPort;
  readonly extractor: BrainExtractPort;
  readonly providerTag?: string;
  /** Precise list of what is unwired (missing keys / endpoints / bucket). */
  readonly runtimeWarnings: ReadonlyArray<string>;
}

export async function resolveGatewayOcrAdapters(): Promise<GatewayOcrAdapters | null> {
  try {
    const mod = (await import(
      // @ts-expect-error — sibling-service import resolved by pnpm symlink
      '../../../api-gateway/dist/routes/mining/document-intelligence.hono.js'
    )) as {
      buildOcrExtractionAdapters?: () => Promise<GatewayOcrAdapters>;
    };
    if (typeof mod.buildOcrExtractionAdapters !== 'function') {
      logger.warn(
        'ocr-extraction: api-gateway buildOcrExtractionAdapters not found — task is a no-op',
      );
      return null;
    }
    return await mod.buildOcrExtractionAdapters();
  } catch (err) {
    logger.warn('ocr-extraction: gateway adapter load failed — task is a no-op', {
      reason: messageOf(err),
    });
    return null;
  }
}

/**
 * Supervisor-facing entry: resolve the real gateway adapters, then poll.
 * No-ops cleanly when `db` is null or the gateway dist is absent. Designed
 * to be called by the consolidation-worker supervisor on a short interval
 * (the same supervisor that runs the consolidation loop), or one-shot from
 * a CLI / the route's enqueue path.
 */
export async function runOcrExtractionPollWithGatewayAdapters(args: {
  readonly db: OcrExtractionDb | null;
  readonly batchSize?: number;
}): Promise<PollResult> {
  if (!args.db) {
    logger.warn('ocr-extraction: no db — supervisor poll is a no-op');
    return { scanned: 0, extracted: 0, skipped: 0, failed: 0 };
  }
  const adapters = await resolveGatewayOcrAdapters();
  if (!adapters) {
    return { scanned: 0, extracted: 0, skipped: 0, failed: 0 };
  }
  if (adapters.runtimeWarnings.length > 0) {
    logger.warn('ocr-extraction: degraded adapters — some inputs unwired', {
      runtimeWarnings: adapters.runtimeWarnings,
    });
  }
  const deps: OcrExtractionDeps = {
    db: args.db,
    storage: adapters.storage,
    ocr: adapters.ocr,
    extractor: adapters.extractor,
    ...(adapters.providerTag ? { providerTag: adapters.providerTag } : {}),
  };
  return pollAndRunOcrExtractions(deps, {
    ...(typeof args.batchSize === 'number' ? { batchSize: args.batchSize } : {}),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Lazy `sql` tag so the pure orchestration compiles/tests without drizzle. */
async function sqlTag(): Promise<(strings: TemplateStringsArray, ...values: unknown[]) => unknown> {
  const drizzle = (await import('drizzle-orm')) as {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => unknown;
  };
  return drizzle.sql;
}

function randomUuid(): string {
  // node:crypto.randomUUID — available in the worker's Node runtime.
  // Lazy-required so the module body stays side-effect free.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ?? fallbackUuid();
}

function fallbackUuid(): string {
  // RFC-4122 v4 fallback (only used if globalThis.crypto is unavailable).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function clampBatch(input: number | undefined, fallback: number): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) return fallback;
  return Math.min(Math.floor(input), 200);
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = (result as { rows?: unknown })?.rows;
  return Array.isArray(wrapped)
    ? (wrapped as ReadonlyArray<Record<string, unknown>>)
    : [];
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
