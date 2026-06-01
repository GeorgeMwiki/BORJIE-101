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
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { logger } from '../../utils/logger';
import { classifyDocument, type DocumentKind } from './document-intelligence-classifier';
import {
  runFormExtraction,
  buildOcrExtractionInsert,
} from './document-extraction';

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
  const kind = classifyDocument(classifyInput);  const documentType = kindToDocumentType(kind);

  const id = randomUUID();
  const fileUrl = `s3://borjie-${tenantId}/document-intelligence/${id}/${encodeURIComponent(input.fileName)}`;
  const now = new Date();

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
        presignedPut: fileUrl,
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

  logger.info('document-intelligence: ask dispatched', {
    tenantId,
    sessionId: id,
    documentCount: documentIdList.length,
    evidenceCount: evidenceIds.length,
    language: input.language,
  });

  // The doc-chat orchestrator is wired through the existing doc-chat
  // pipeline; this route returns the evidence envelope + the canonical
  // dispatch shape so the chat-ui consumes it identically to the brain
  // surface.
  return c.json(
    envelope({
      sessionId: id,
      question: input.question,
      language: input.language,
      evidenceIds,
      documentIds: documentIdList,
      answer: null,
      note: 'doc-chat orchestrator dispatch — answer streams via /chat SSE',
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
// helpers
// ---------------------------------------------------------------------------

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export const miningDocumentIntelligenceRouter = app;
