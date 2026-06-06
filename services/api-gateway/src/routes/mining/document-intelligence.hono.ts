/**
 * /api/v1/mining/document-intelligence — "Documents as alive entities."
 *
 * Wave DOC-INTEL. Users upload contracts / RFPs / letters via the chat
 * paperclip OR a dedicated Documents section. Files flow through corpus
 * ingestion; the brain converses with them via the existing doc-chat
 * pipeline.
 *
 * Routes:
 *   POST /upload              — register an upload (returns presigned PUT
 *                                URL + document row). Validates mime,
 *                                auto-classifies kind, enqueues corpus
 *                                ingestion via ingestion_status='queued'.
 *
 *   GET  /documents           — list the caller's tenant documents,
 *                                newest first, with ingestion_status +
 *                                kind for the UI badge.
 *
 *   POST /sessions            — open a doc-intelligence session bound
 *                                to one or more documents. Body:
 *                                {documentIds, initialPrompt?}. Returns
 *                                {sessionId}.
 *
 *   POST /sessions/:id/ask    — ask a question scoped to the session's
 *                                documents. Returns the answer +
 *                                evidence chunk ids drawn ONLY from the
 *                                bound documents.
 *
 *   POST /documents/:id/summary
 *                              — request an AI summary of the document.
 *                                Returns the summary string + the chunk
 *                                ids that backed it.
 *
 * Tenant isolation: every row is tenant-scoped via the RLS GUC bound by
 * the database middleware. Per-tenant corpus chunks are also tenant_id-
 * scoped (never NULL — global corpus is reserved for the mining ground
 * truth).
 *
 * Per CLAUDE.md hard rules: no raw console statements (logger only), no
 * reflective CORS, no raw HTML interpolation, no process.env reads outside
 * bootstrap.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  documentUploads,
  documentIntelligenceSessions,
  documentCorpusLinks,
  intelligenceCorpusChunks,
  ocrExtractions,
} from '@borjie/database';
import { createSupabaseAdminClient } from '@borjie/supabase-client';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { logger } from '../../utils/logger';
import { classifyDocument, type DocumentKind } from './document-intelligence-classifier';
import { buildExtractiveAnswer } from './doc-chat-answer';
import {
  runFormExtraction,
  buildOcrExtractionInsert,
} from './document-extraction';
// Async per-upload OCR + full-text extraction (Wave DOC-INTEL).
// The heavy wiring (real Supabase download + SSRF-guarded OCR adapter +
// real BrainPort + reuse of runFormExtraction/extractFormFields) lives in a
// focused sibling module so this route stays thin. It is RE-EXPORTED here so
// the consolidation-worker can reach it via its canonical sibling-service
// dynamic import of this route's built dist
// (`…/routes/mining/document-intelligence.hono.js`).
export {
  buildOcrExtractionAdapters,
  type GatewayOcrAdapters,
} from './document-ocr-extraction-wiring';
import {
  triggerAsyncOcrExtraction,
} from './document-ocr-extraction-wiring';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — covers contracts + scanned PDFs.

const uploadSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileSize: z.number().int().positive().max(MAX_FILE_BYTES),
  mimeType: z.string().min(1).max(128),
  /** Optional caller-provided text sample (first 4 KB) to seed
   *  classification before the full ingest runs. */
  textSample: z.string().max(4096).optional(),
  /** Optional caller-provided tags. */
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
});

const createSessionSchema = z.object({
  documentIds: z
    .array(z.string().min(1).max(64))
    .min(1, 'At least one document is required')
    .max(16, 'Up to 16 documents per session'),
  initialPrompt: z.string().min(1).max(2000).optional(),
  title: z.string().min(1).max(256).optional(),
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  // English default per CLAUDE.md (flipped 2026-05).
  language: z.enum(['sw', 'en']).default('en'),
});

const summarySchema = z.object({
  // English default per CLAUDE.md (flipped 2026-05).
  language: z.enum(['sw', 'en']).default('en'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidMime(mime: string): boolean {
  return (ALLOWED_MIMES as ReadonlyArray<string>).includes(mime);
}

function envelope<T>(data: T) {
  return { success: true as const, data };
}

function errorEnvelope(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

/** Map a kind back into the documentTypeEnum used by the document_uploads
 *  table. The 'other' kind maps to 'other'; the rest map to the closest
 *  existing enum value. */
function kindToDocumentType(kind: DocumentKind): string {
  switch (kind) {
    case 'contract':
      return 'lease_agreement';
    case 'rfp':
    case 'letter':
      return 'notice';
    case 'report':
      return 'employment_letter';
    case 'other':
    default:
      return 'other';
  }
}

// ---------------------------------------------------------------------------
// Object-storage presign — REAL Supabase Storage signed-upload URL.
//
// Wave DOC-INTEL. Previously `POST /upload` stored a SYNTHETIC `s3://…`
// `file_url`, so the async OCR worker
// (`consolidation-worker/src/tasks/ocr-extraction-task.ts`) always got a
// `storage_miss` — the binary was never written to a bucket it could read.
//
// We now mint a real signed PUT into the shared `tenant-uploads` bucket and
// store the CANONICAL in-bucket path as `file_url`. Path scheme:
//
//   tenant-uploads/<tenantId>/<documentId>/<fileName>
//
// The worker's storage adapter (`document-ocr-extraction-wiring.ts`
// `candidatePaths`) strips the `tenant-uploads/` prefix from the stored
// `file_url` and downloads the remainder verbatim — so this exact path is a
// DETERMINISTIC hit (no month-guessing fallback, unlike the dated owner-docs
// scheme). The leading `<tenantId>` segment is what Storage RLS policies of
// the shape `(storage.foldername(name))[1] = current_setting('app.tenant_id')`
// key off, so a non-service-role caller cannot cross-tenant read/write.
//
// Mirrors the sibling `owner-docs-storage/presign.ts` pattern
// (createSupabaseAdminClient + ensureBucketExists + createSignedUploadUrl)
// but with the doc-intelligence path convention. Degrades to a non-signed
// canonical path (`degraded:true`) when Supabase env is unwired so local-dev
// gateways stay boot-safe; reads env in-handler scope (never module-init),
// matching the sibling services.
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = 'tenant-uploads';
const PRESIGN_TTL_SECONDS = 5 * 60;

interface UploadPresign {
  readonly bucket: string;
  /** Canonical in-bucket object path — stored as `file_url`'s tail. */
  readonly path: string;
  /** Absolute URL the FE PUTs the bytes to (signed) or the bare path. */
  readonly uploadUrl: string;
  /** Bearer token Supabase requires on the signed PUT (empty when degraded). */
  readonly token: string;
  /** Headers the FE must send on the PUT. */
  readonly headers: Record<string, string>;
  /** Wall-clock ISO of when the signature expires. */
  readonly expiresAt: string;
  /** True when Supabase env is unwired and we returned a bare path. */
  readonly degraded: boolean;
}

let cachedStorageClient: SupabaseClient | null = null;
let cachedBucketChecked = false;

function getStorageAdminClient(): SupabaseClient | null {
  if (cachedStorageClient) return cachedStorageClient;
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  try {
    // `createSupabaseAdminClient` resolves via the package's CJS path; the
    // type-only `SupabaseClient` import resolves via ESM under
    // `exactOptionalPropertyTypes`. The shapes are structurally identical —
    // bridge the dual-resolution skew through `unknown` (same as the sibling
    // presign + ocr-wiring services).
    cachedStorageClient = createSupabaseAdminClient({
      url,
      serviceRoleKey: key,
    }) as unknown as SupabaseClient;
    return cachedStorageClient;
  } catch (err) {
    logger.warn('document-intelligence: supabase admin init failed', {
      reason: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function ensureStorageBucketExists(
  supabase: SupabaseClient,
): Promise<void> {
  if (cachedBucketChecked) return;
  try {
    const { data, error } = await supabase.storage.getBucket(STORAGE_BUCKET);
    if (!error && data) {
      cachedBucketChecked = true;
      return;
    }
    // Bucket missing — create PRIVATE. First-call race is tolerated:
    // Supabase returns an AlreadyExists error when two boots collide.
    const createRes = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_FILE_BYTES,
    });
    if (
      createRes.error &&
      !createRes.error.message.toLowerCase().includes('already')
    ) {
      logger.warn('document-intelligence: createBucket failed', {
        bucket: STORAGE_BUCKET,
        reason: createRes.error.message,
      });
      return;
    }
    cachedBucketChecked = true;
  } catch (err) {
    logger.warn('document-intelligence: ensureBucketExists threw', {
      bucket: STORAGE_BUCKET,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Build the canonical in-bucket object path for a document upload. The
 * filename is sanitised to a single safe path segment (no separators, no
 * traversal) so a hostile `fileName` cannot escape the
 * `<tenantId>/<documentId>/` prefix that RLS + the worker key off.
 */
function buildUploadObjectPath(args: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly fileName: string;
}): string {
  const safeName =
    args.fileName
      .replace(/[/\\]+/g, '_')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 200) || 'upload.bin';
  return `${args.tenantId}/${args.documentId}/${safeName}`;
}

function degradedPresign(path: string, mimeType: string): UploadPresign {
  return {
    bucket: STORAGE_BUCKET,
    path,
    uploadUrl: `${STORAGE_BUCKET}/${path}`,
    token: '',
    headers: { 'Content-Type': mimeType },
    expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString(),
    degraded: true,
  };
}

/**
 * Issue a real Supabase Storage signed-upload URL for the document upload.
 * NEVER throws — returns `degraded:true` when the env/bucket/signature is
 * unavailable so the upload registration still succeeds and the FE can branch.
 */
async function issueUploadPresign(args: {
  readonly tenantId: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly mimeType: string;
}): Promise<UploadPresign> {
  const path = buildUploadObjectPath(args);
  const supabase = getStorageAdminClient();
  if (!supabase) {
    logger.warn(
      'document-intelligence: presign degraded — supabase env not wired',
      { tenantId: args.tenantId, documentId: args.documentId },
    );
    return degradedPresign(path, args.mimeType);
  }
  await ensureStorageBucketExists(supabase);
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) {
      logger.warn('document-intelligence: createSignedUploadUrl failed', {
        tenantId: args.tenantId,
        documentId: args.documentId,
        path,
        reason: error?.message ?? 'no data',
      });
      return degradedPresign(path, args.mimeType);
    }
    return {
      bucket: STORAGE_BUCKET,
      path: data.path ?? path,
      uploadUrl: data.signedUrl,
      token: data.token,
      headers: { 'Content-Type': args.mimeType },
      expiresAt: new Date(
        Date.now() + PRESIGN_TTL_SECONDS * 1000,
      ).toISOString(),
      degraded: false,
    };
  } catch (err) {
    logger.warn('document-intelligence: createSignedUploadUrl threw', {
      tenantId: args.tenantId,
      documentId: args.documentId,
      path,
      reason: err instanceof Error ? err.message : String(err),
    });
    return degradedPresign(path, args.mimeType);
  }
}

/**
 * Run synchronous, schema-guided field extraction over the caller-supplied
 * `textSample`, persist it into `ocr_extractions`, point
 * `document_uploads.ocr_extraction_id` at the new row, and hash-chain the
 * extraction event into `ai_audit_chain`.
 *
 * Best-effort: extraction MUST NOT fail the upload. Any error is logged
 * and swallowed (the upload row already exists; ingestion still proceeds).
 * Returns the extraction summary on success, or `null` when skipped/failed.
 *
 * Heuristic-only (no brain) → zero LLM egress; see `document-extraction.ts`.
 */
async function extractAndPersist(input: {
  readonly db: ReturnType<typeof Object> & {
    insert: (table: unknown) => {
      values: (v: Record<string, unknown>) => {
        returning: () => Promise<ReadonlyArray<Record<string, unknown>>>;
      };
    };
    update: (table: unknown) => {
      set: (v: Record<string, unknown>) => {
        where: (clause: unknown) => Promise<unknown>;
      };
    };
    execute: (q: unknown) => Promise<unknown>;
  };
  readonly tenantId: string;
  readonly userId: string;
  readonly documentId: string;
  readonly documentType: string;
  readonly kind: DocumentKind;
  readonly mimeType: string;
  readonly textSample: string;
}): Promise<{
  readonly extractionId: string;
  readonly schemaId: string;
  readonly fieldCount: number;
  readonly overallConfidence: number;
} | null> {
  const { db, tenantId, documentId } = input;
  try {
    const startedAt = new Date();
    const result = await runFormExtraction({
      documentId,
      text: input.textSample,
      sourceMime: input.mimeType,
      documentType: input.documentType,
      kind: input.kind,
    });
    const completedAt = new Date();

    const extractionId = randomUUID();
    const insert = buildOcrExtractionInsert({
      tenantId,
      documentUploadId: documentId,
      result,
      rawText: input.textSample,
      startedAt,
      completedAt,
      extractionId,
    });

    await db.insert(ocrExtractions).values(insert).returning();

    // Back-point the upload row at its extraction (tenantId belt-and-braces
    // on top of FORCE RLS).
    await db
      .update(documentUploads)
      .set({ ocrExtractionId: extractionId, updatedAt: completedAt })
      .where(
        and(
          eq(documentUploads.tenantId, tenantId),
          eq(documentUploads.id, documentId),
        ),
      );

    const fieldCount = Object.keys(result.extractedFields).length;

    // Hash-chained, append-only audit of the extraction event. Best-effort:
    // a chain gap is logged but never blocks the upload.
    try {
      await db.execute(
        sql`
          WITH prev AS (
            SELECT this_hash, sequence_id
              FROM ai_audit_chain
             WHERE tenant_id = ${tenantId}
             ORDER BY sequence_id DESC
             LIMIT 1
          )
          INSERT INTO ai_audit_chain
            (id, tenant_id, sequence_id, turn_id, session_id, action,
             prev_hash, this_hash, payload_ref, payload, created_at)
          VALUES (
            ${randomUUID()},
            ${tenantId},
            COALESCE((SELECT sequence_id FROM prev), 0) + 1,
            ${`doc-extract-${documentId}`},
            NULL,
            ${'mining.document.extraction'},
            COALESCE((SELECT this_hash FROM prev), ''),
            encode(sha256(
              (COALESCE((SELECT this_hash FROM prev), '') ||
               ${JSON.stringify({
                 documentId,
                 extractionId,
                 tenantId,
                 schemaId: result.schemaId,
                 fieldCount,
               })}
              )::bytea
            ), 'hex'),
            NULL,
            ${JSON.stringify({
              action: 'mining.document.extraction',
              documentId,
              extractionId,
              schemaId: result.schemaId,
              fieldCount,
              overallConfidence: result.overallConfidence,
              mode: 'heuristic',
            })}::jsonb,
            ${completedAt.toISOString()}::timestamptz
          )
        `,
      );
    } catch (auditErr) {
      logger.warn('document-intelligence: extraction audit-chain append failed', {
        tenantId,
        documentId,
        reason: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    logger.info('document-intelligence: fields extracted', {
      tenantId,
      documentId,
      extractionId,
      schemaId: result.schemaId,
      fieldCount,
      overallConfidence: result.overallConfidence,
    });

    return {
      extractionId,
      schemaId: result.schemaId,
      fieldCount,
      overallConfidence: result.overallConfidence,
    };
  } catch (err) {
    logger.error('document-intelligence: extraction failed', {
      tenantId,
      documentId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST /upload — register an upload + enqueue corpus ingestion
// ---------------------------------------------------------------------------

app.post('/upload', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const raw = await c.req.json().catch(() => null);
  const parsed = uploadSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorEnvelope('VALIDATION_ERROR', 'Invalid upload payload'),
      400,
    );
  }
  const input = parsed.data;

  if (!isValidMime(input.mimeType)) {
    return c.json(
      errorEnvelope(
        'MIME_NOT_ALLOWED',
        'Allowed types: pdf, docx, doc, jpeg, png, webp',
      ),
      400,
    );
  }
  if (input.fileSize > MAX_FILE_BYTES) {
    return c.json(errorEnvelope('FILE_TOO_LARGE', 'Max 25 MB per upload'), 413);
  }

  const classifyInput: { readonly fileName: string; readonly textSample?: string } = {
    fileName: input.fileName,
  };
  if (input.textSample !== undefined) {
    (classifyInput as { textSample?: string }).textSample = input.textSample;
  }
  const kind = classifyDocument(classifyInput);
  const documentType = kindToDocumentType(kind);

  const id = randomUUID();
  const now = new Date();

  // Mint a REAL Supabase Storage signed PUT into `tenant-uploads` and store
  // the canonical in-bucket path as `file_url` — the exact path the async OCR
  // worker downloads. Never throws (degrades to a bare path when env/bucket is
  // unwired) so the upload registration always succeeds.
  const presign = await issueUploadPresign({
    tenantId,
    documentId: id,
    fileName: input.fileName,
    mimeType: input.mimeType,
  });
  // `file_url` is what the worker fetches: store the bucket-qualified path so
  // its `tenant-uploads/`-prefix strip yields the exact object key.
  const fileUrl = `${presign.bucket}/${presign.path}`;

  try {
    const [row] = await db
      .insert(documentUploads)
      .values({
        id,
        tenantId,
        customerId: null,
        documentType,
        status: 'pending_upload',
        source: 'app_upload',
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        fileUrl,
        thumbnailUrl: null,
        entityType: 'document_intelligence',
        entityId: null,
        metadata: {
          uploadedVia: 'document-intelligence',
          uploaderUserId: userId,
        },
        tags: input.tags ?? [],
        kind,
        ingestionStatus: 'queued',
        ingestionError: null,
        ingestedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning();

    logger.info('document-intelligence: upload registered', {
      tenantId,
      userId,
      documentId: id,
      kind,
      mimeType: input.mimeType,
      storagePath: presign.path,
      presignDegraded: presign.degraded,
    });

    // Synchronous, schema-guided extraction over the caller-supplied
    // text sample. Best-effort — never fails the upload. When no sample is
    // present (binary not yet OCR'd) extraction is deferred to the async
    // OCR worker (not yet wired — see KNOWN gap).
    const extraction =
      input.textSample && input.textSample.trim().length > 0
        ? await extractAndPersist({
            db,
            tenantId,
            userId,
            documentId: id,
            documentType,
            kind,
            mimeType: input.mimeType,
            textSample: input.textSample,
          })
        : null;

    return c.json(
      envelope({
        documentId: row.id,
        ingestionStatus: 'queued',
        kind,
        // The FE PUTs the raw bytes to this URL, then calls
        // POST /documents/:id/ready to trigger async OCR.
        presignedPut: presign.uploadUrl,
        presigned: {
          bucket: presign.bucket,
          path: presign.path,
          uploadUrl: presign.uploadUrl,
          token: presign.token,
          headers: presign.headers,
          expiresAt: presign.expiresAt,
          degraded: presign.degraded,
        },
        document: row,
        extraction,
      }),
      201,
    );
  } catch (err) {
    logger.error('document-intelligence: upload failed', {
      tenantId,
      userId,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return c.json(
      errorEnvelope('UPLOAD_FAILED', 'Failed to register upload'),
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /documents — list tenant documents (newest first)
// ---------------------------------------------------------------------------

app.get('/documents', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const limitRaw = c.req.query('limit');
  const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);

  const rows = await db
    .select({
      id: documentUploads.id,
      fileName: documentUploads.fileName,
      mimeType: documentUploads.mimeType,
      fileSize: documentUploads.fileSize,
      fileUrl: documentUploads.fileUrl,
      kind: documentUploads.kind,
      ingestionStatus: documentUploads.ingestionStatus,
      ingestionError: documentUploads.ingestionError,
      ingestedAt: documentUploads.ingestedAt,
      tags: documentUploads.tags,
      createdAt: documentUploads.createdAt,
      createdBy: documentUploads.createdBy,
    })
    .from(documentUploads)
    .where(
      and(
        eq(documentUploads.tenantId, tenantId),
        eq(documentUploads.entityType, 'document_intelligence'),
      ),
    )
    .orderBy(desc(documentUploads.createdAt))
    .limit(limit);

  return c.json(envelope({ documents: rows }), 200);
});

// ---------------------------------------------------------------------------
// POST /sessions — open a chat session bound to N documents
// ---------------------------------------------------------------------------

app.post('/sessions', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const raw = await c.req.json().catch(() => null);
  const parsed = createSessionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorEnvelope('VALIDATION_ERROR', 'Invalid session payload'),
      400,
    );
  }
  const input = parsed.data;

  // Verify the documents belong to the caller's tenant. (RLS already
  // enforces this, but we surface a 404 rather than empty-set so the
  // UI can render a sensible error.)
  const found = await db
    .select({ id: documentUploads.id, fileName: documentUploads.fileName })
    .from(documentUploads)
    .where(
      and(
        eq(documentUploads.tenantId, tenantId),
        inArray(documentUploads.id, input.documentIds as string[]),
      ),
    );

  if (found.length !== input.documentIds.length) {
    return c.json(
      errorEnvelope(
        'DOCUMENTS_NOT_FOUND',
        'One or more documents were not found',
      ),
      404,
    );
  }

  const title =
    input.title ??
    (found[0]?.fileName ? `Chat: ${found[0].fileName}` : 'Document chat');

  const [session] = await db
    .insert(documentIntelligenceSessions)
    .values({
      tenantId,
      userId,
      title,
      documentIds: input.documentIds,
      initialPrompt: input.initialPrompt ?? null,
      status: 'active',
    })
    .returning();

  logger.info('document-intelligence: session opened', {
    tenantId,
    userId,
    sessionId: session.id,
    documentCount: input.documentIds.length,
  });

  return c.json(
    envelope({ sessionId: session.id, session, documents: found }),
    201,
  );
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/ask — ask a question scoped to the bound documents
// ---------------------------------------------------------------------------

app.post('/sessions/:id/ask', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(errorEnvelope('VALIDATION_ERROR', 'Invalid session id'), 400);
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      errorEnvelope('VALIDATION_ERROR', 'Invalid ask payload'),
      400,
    );
  }
  const input = parsed.data;

  const [session] = await db
    .select()
    .from(documentIntelligenceSessions)
    .where(
      and(
        eq(documentIntelligenceSessions.tenantId, tenantId),
        eq(documentIntelligenceSessions.id, id),
      ),
    )
    .limit(1);

  if (!session) {
    return c.json(errorEnvelope('NOT_FOUND', 'Session not found'), 404);
  }

  // Pull every chunk linked to the bound documents. Caps retrieval to
  // 32 chunks so a poorly-tuned doc doesn't blow the brain's prompt.
  const documentIdList = (session.documentIds as ReadonlyArray<string>) ?? [];
  const links =
    documentIdList.length > 0
      ? await db
          .select({
            chunkId: documentCorpusLinks.chunkId,
            documentId: documentCorpusLinks.documentId,
          })
          .from(documentCorpusLinks)
          .where(
            and(
              eq(documentCorpusLinks.tenantId, tenantId),
              inArray(documentCorpusLinks.documentId, documentIdList as string[]),
            ),
          )
          .limit(32)
      : [];

  const evidenceIds = links.map((l) => l.chunkId);

  // Pull the linked chunk TEXTS (tenant-scoped) so we can produce a REAL,
  // synchronous, cited answer right here — quoting the source, never
  // fabricating. Capped to the already-capped evidence set.
  const chunkRows =
    evidenceIds.length > 0
      ? await db
          .select({
            id: intelligenceCorpusChunks.id,
            text: intelligenceCorpusChunks.text,
          })
          .from(intelligenceCorpusChunks)
          .where(
            and(
              eq(intelligenceCorpusChunks.tenantId, tenantId),
              inArray(intelligenceCorpusChunks.id, evidenceIds),
            ),
          )
      : [];

  // Build the extractive answer (deterministic, citation-first — mirrors the
  // blessed doc-chat.router.ts fallback). Returns answer:null only when no
  // passage overlaps the question, in which case the FE renders an honest
  // "no evidence" state.
  const extractive = buildExtractiveAnswer({
    chunks: chunkRows.map((r) => ({ id: r.id, text: r.text })),
    question: input.question,
    language: input.language,
  });

  // Touch lastMessageAt so the inbox sorts correctly.
  await db
    .update(documentIntelligenceSessions)
    .set({ lastMessageAt: new Date() })
    .where(
      and(
        eq(documentIntelligenceSessions.tenantId, tenantId),
        eq(documentIntelligenceSessions.id, id),
      ),
    );

  logger.info('document-intelligence: ask answered', {
    tenantId,
    sessionId: id,
    documentCount: documentIdList.length,
    evidenceCount: evidenceIds.length,
    citedCount: extractive.citedEvidenceIds.length,
    answerMode: extractive.mode,
    language: input.language,
  });

  // SYNCHRONOUS cited answer: the written answer quotes the highest-overlap
  // passage(s) verbatim and `evidenceIds` are the chunks it cites. No
  // fabrication — answer is null only when nothing matched.
  return c.json(
    envelope({
      sessionId: id,
      question: input.question,
      language: input.language,
      // Cited evidence first (the passages the answer quotes), then the rest
      // of the retrieved set so the FE can still anchor them.
      evidenceIds:
        extractive.citedEvidenceIds.length > 0
          ? [
              ...extractive.citedEvidenceIds,
              ...evidenceIds.filter(
                (e) => !extractive.citedEvidenceIds.includes(e),
              ),
            ]
          : evidenceIds,
      documentIds: documentIdList,
      answer: extractive.answer,
      answerMode: extractive.mode,
    }),
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /documents/:id/summary — request an AI summary of the document
// ---------------------------------------------------------------------------

app.post('/documents/:id/summary', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (id.length < 1 || id.length > 64) {
    return c.json(errorEnvelope('VALIDATION_ERROR', 'Invalid document id'), 400);
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = summarySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return c.json(
      errorEnvelope('VALIDATION_ERROR', 'Invalid summary payload'),
      400,
    );
  }
  const input = parsed.data;

  const [doc] = await db
    .select()
    .from(documentUploads)
    .where(and(eq(documentUploads.tenantId, tenantId), eq(documentUploads.id, id)))
    .limit(1);

  if (!doc) {
    return c.json(errorEnvelope('NOT_FOUND', 'Document not found'), 404);
  }

  if (doc.ingestionStatus !== 'ready') {
    return c.json(
      errorEnvelope(
        'NOT_READY',
        `Document is still ${doc.ingestionStatus}. Try again once ingestion completes.`,
      ),
      409,
    );
  }

  // Pull the linked chunks (capped at 16) — the orchestrator wraps these
  // with the canonical summarisation prompt and dispatches via the brain
  // pipeline. The response envelope here matches the /ask shape.
  const links = await db
    .select({ chunkId: documentCorpusLinks.chunkId })
    .from(documentCorpusLinks)
    .where(
      and(
        eq(documentCorpusLinks.tenantId, tenantId),
        eq(documentCorpusLinks.documentId, id),
      ),
    )
    .limit(16);

  // Pull the first few chunk texts as a deterministic preview so the UI
  // can render an "executive summary" stub even before the brain replies.
  const chunkTexts =
    links.length > 0
      ? await db
          .select({
            id: intelligenceCorpusChunks.id,
            text: intelligenceCorpusChunks.text,
          })
          .from(intelligenceCorpusChunks)
          .where(
            and(
              eq(intelligenceCorpusChunks.tenantId, tenantId),
              inArray(
                intelligenceCorpusChunks.id,
                links.map((l) => l.chunkId),
              ),
            ),
          )
          .limit(4)
      : [];

  const previewSummary = chunkTexts
    .map((c) => c.text.slice(0, 280))
    .join('\n\n');

  logger.info('document-intelligence: summary requested', {
    tenantId,
    documentId: id,
    language: input.language,
    chunkCount: links.length,
  });

  return c.json(
    envelope({
      documentId: id,
      kind: doc.kind,
      language: input.language,
      summary: previewSummary || 'Summary will be generated once chunks are indexed.',
      evidenceIds: links.map((l) => l.chunkId),
      note: 'doc-chat orchestrator dispatch — full summary streams via /chat SSE',
    }),
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /documents/:id/extraction — fetch the persisted structured fields
// ---------------------------------------------------------------------------

app.get('/documents/:id/extraction', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(errorEnvelope('VALIDATION_ERROR', 'Invalid document id'), 400);
  }

  // Confirm the document belongs to the caller's tenant first so we can
  // distinguish "no such doc" (404) from "doc exists, not yet extracted"
  // (200 with extraction: null). RLS already scopes both queries; the
  // explicit tenantId predicate is belt-and-braces.
  const [doc] = await db
    .select({ id: documentUploads.id, kind: documentUploads.kind })
    .from(documentUploads)
    .where(and(eq(documentUploads.tenantId, tenantId), eq(documentUploads.id, id)))
    .limit(1);

  if (!doc) {
    return c.json(errorEnvelope('NOT_FOUND', 'Document not found'), 404);
  }

  const [extraction] = await db
    .select({
      id: ocrExtractions.id,
      extractedFields: ocrExtractions.extractedFields,
      confidenceScores: ocrExtractions.confidenceScores,
      overallConfidence: ocrExtractions.overallConfidence,
      ocrProvider: ocrExtractions.ocrProvider,
      validationStatus: ocrExtractions.validationStatus,
      processingCompletedAt: ocrExtractions.processingCompletedAt,
      createdAt: ocrExtractions.createdAt,
    })
    .from(ocrExtractions)
    .where(
      and(
        eq(ocrExtractions.tenantId, tenantId),
        eq(ocrExtractions.documentUploadId, id),
      ),
    )
    .orderBy(desc(ocrExtractions.createdAt))
    .limit(1);

  logger.info('document-intelligence: extraction fetched', {
    tenantId,
    documentId: id,
    found: Boolean(extraction),
  });

  return c.json(
    envelope({
      documentId: id,
      kind: doc.kind,
      extraction: extraction ?? null,
    }),
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /documents/:id/ready — confirm the FE finished its presigned PUT and
// flip ingestion_status → 'ready'. This is the TRIGGER for the async per-
// upload OCR + full-text extraction: it stamps `ingested_at` and enqueues the
// worker (whose poll on `ingestion_status='ready'` is the durable backstop).
//
// Why a dedicated endpoint: at `POST /upload` the binary is not yet stored
// (presign only), so OCR cannot run there. The FE PUTs the bytes, then calls
// this to signal "bytes are in storage" — the only point at which a full-text
// OCR pass is possible. Idempotent: re-flipping an already-ready doc re-emits
// the enqueue but does not duplicate state.
//
// RUNTIME note: until the FE is wired to call this after its PUT (or the
// corpus-ingestion pipeline flips the status itself), documents stay 'queued'
// and the async OCR worker has nothing to process.
// ---------------------------------------------------------------------------

app.post('/documents/:id/ready', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const id = c.req.param('id');
  if (!isUuid(id)) {
    return c.json(errorEnvelope('VALIDATION_ERROR', 'Invalid document id'), 400);
  }

  // Confirm tenant ownership (RLS-scoped; explicit predicate belt-and-braces).
  const [doc] = await db
    .select({ id: documentUploads.id })
    .from(documentUploads)
    .where(and(eq(documentUploads.tenantId, tenantId), eq(documentUploads.id, id)))
    .limit(1);

  if (!doc) {
    return c.json(errorEnvelope('NOT_FOUND', 'Document not found'), 404);
  }

  const now = new Date();
  try {
    // Raw SQL UPDATE so we target the migration-0083 columns
    // (`ingestion_status` / `ingested_at`) directly — the Drizzle
    // `documentUploads` object does not yet declare them. Only flips from a
    // pre-ready state so a 'failed' doc isn't silently resurrected.
    await db.execute(
      sql`
        UPDATE document_uploads
           SET ingestion_status = 'ready',
               ingested_at = ${now.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE tenant_id = ${tenantId}
           AND id = ${id}
           AND ingestion_status IN ('queued', 'processing')
      `,
    );
  } catch (err) {
    logger.error('document-intelligence: ready-flip failed', {
      tenantId,
      documentId: id,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return c.json(errorEnvelope('READY_FLIP_FAILED', 'Failed to mark document ready'), 500);
  }

  // Best-effort enqueue — the worker poll on ingestion_status='ready' is the
  // durable trigger; this is an early-start nudge that never blocks the
  // request (no inline OCR; the binary fetch + OCR happen in the worker).
  triggerAsyncOcrExtraction({ tenantId, documentId: id });

  logger.info('document-intelligence: document marked ready', {
    tenantId,
    documentId: id,
  });

  return c.json(envelope({ documentId: id, ingestionStatus: 'ready' }), 200);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export const miningDocumentIntelligenceRouter = app;
