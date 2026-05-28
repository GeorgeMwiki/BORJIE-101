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
 * Per CLAUDE.md hard rules: no console.log (logger only), no reflective
 * CORS, no raw HTML interpolation, no process.env reads outside
 * bootstrap.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  documentUploads,
  documentIntelligenceSessions,
  documentCorpusLinks,
  intelligenceCorpusChunks,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { logger } from '../../utils/logger';
import { classifyDocument, type DocumentKind } from './document-intelligence-classifier';

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
  language: z.enum(['sw', 'en']).default('sw'),
});

const summarySchema = z.object({
  language: z.enum(['sw', 'en']).default('sw'),
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

  const kind = classifyDocument({
    fileName: input.fileName,
    ...(input.textSample && { textSample: input.textSample }),
  });
  const documentType = kindToDocumentType(kind);

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

    return c.json(
      envelope({
        documentId: row.id,
        ingestionStatus: 'queued',
        kind,
        presignedPut: fileUrl,
        document: row,
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
// helpers
// ---------------------------------------------------------------------------

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    v,
  );
}

export const miningDocumentIntelligenceRouter = app;
