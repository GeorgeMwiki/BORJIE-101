/**
 * /api/v1/owner/docs — owner-cockpit document intake + talk-to-doc.
 *
 * Wave OWNER-OS. The owner drops one or many files on the home chat
 * panel; the panel POSTs each one here. We persist into the same
 * `document_uploads` table the mining/document-intelligence pipeline
 * uses (Wave DOC-INTEL) but with `entity_type='owner_intake'` so the
 * owner cockpit's Docs tab filters cleanly without colliding with the
 * mining-domain doc-intelligence inbox.
 *
 * Routes:
 *   POST /intake          — register one file (returns documentId +
 *                            presigned PUT URL). After the FE PUTs the
 *                            bytes, ingestion is queued so the brain
 *                            chunks + indexes the doc into
 *                            intelligence_corpus_chunks (tenant-scoped).
 *
 *   GET  /                — list owner-intake docs newest first.
 *
 *   POST /:id/explain     — "talk to this document" — return a one-
 *                            paragraph live-brain summary + the source
 *                            chunk ids that backed it.
 *
 *   POST /:id/qa          — ask a single question scoped to one doc.
 *                            Returns the brain's answer + cited chunk
 *                            ids. No retrieval is done outside the
 *                            doc's linked chunks.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 *
 * No mock data. The brain ladder (Anthropic → OpenAI → DeepSeek)
 * mirrors public-chat.hono.ts. Empty responses surface as a real error.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  documentUploads,
  documentCorpusLinks,
  intelligenceCorpusChunks,
} from '@borjie/database';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { callBrainOnce } from './brain-call.js';
// Wave OWNER-OS — REAL Supabase Storage presigned PUT replacing the
// previous placeholder. Uses `createSignedUploadUrl` against the
// shared `tenant-uploads` bucket. Path scheme:
//   tenant-uploads/<tenant_id>/<yyyy-mm>/<uuid>.<ext>
import { issueOwnerDocPresign } from '../../services/owner-docs-storage/presign';

const moduleLogger = createLogger('owner-docs');

const ENTITY_TYPE = 'owner_intake';
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIMES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const intakeSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileSize: z.number().int().positive().max(MAX_FILE_BYTES),
  mimeType: z.string().min(1).max(128),
  /** Optional caller-provided tags. */
  tags: z.array(z.string().min(1).max(64)).max(32).optional(),
  /** Optional first 4 KB of text for fast classification when the FE
   *  can extract it client-side (e.g. .txt files). */
  textSample: z.string().max(4096).optional(),
});

const explainSchema = z.object({
  language: z.enum(['sw', 'en']).default('en'),
});

const qaSchema = z.object({
  question: z.string().min(1).max(2000),
  language: z.enum(['sw', 'en']).default('en'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(data: T) {
  return { success: true as const, data };
}

function err(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

function isAllowedMime(mime: string): boolean {
  return (ALLOWED_MIMES as ReadonlyArray<string>).includes(mime);
}

/**
 * Classify the doc into one of the seven Borjie owner categories. The
 * brain re-classifies during ingestion; this is a cheap first guess
 * keyed off the filename so the UI badge is correct immediately.
 */
function classifyOwnerDoc(fileName: string, mime: string): string {
  const lower = fileName.toLowerCase();
  if (/(licence|license|pml|sml|brela|brema)/i.test(lower)) return 'licence';
  if (/(royalty|royalties|tra|return)/i.test(lower)) return 'royalty-return';
  if (/(contract|agreement|mou|sla)/i.test(lower)) return 'contract';
  if (/(invoice|receipt|bill|payment)/i.test(lower)) return 'invoice';
  if (/(insurance|policy|cover)/i.test(lower)) return 'insurance';
  if (/(eia|environmental|nemc|csr)/i.test(lower)) return 'eia';
  if (/(payroll|salary|hr|workforce)/i.test(lower)) return 'payroll';
  if (/(notice|letter|brela|tmaa|regulator|govt)/i.test(lower)) return 'regulator-letter';
  if (mime.startsWith('image/')) return 'other';
  return 'other';
}

function mapCategoryToDocumentType(category: string): string {
  switch (category) {
    case 'contract':
      return 'lease_agreement';
    case 'royalty-return':
    case 'invoice':
    case 'insurance':
      return 'receipt';
    case 'licence':
    case 'eia':
    case 'regulator-letter':
      return 'notice';
    case 'payroll':
      return 'employment_letter';
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
// POST /intake — register an owner-intake document
// ---------------------------------------------------------------------------

app.post('/intake', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('OWNER_DOCS_DB_UNAVAILABLE', 'Database not configured'), 503);
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = intakeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid intake payload'), 400);
  }
  const input = parsed.data;

  if (!isAllowedMime(input.mimeType)) {
    return c.json(
      err(
        'MIME_NOT_ALLOWED',
        'Allowed: pdf, docx, doc, xlsx, xls, jpeg, png, webp, txt',
      ),
      400,
    );
  }

  const category = classifyOwnerDoc(input.fileName, input.mimeType);
  const documentType = mapCategoryToDocumentType(category);
  const id = randomUUID();
  const now = new Date();
  // Wave OWNER-OS — REAL Supabase Storage signed-upload URL. Returns
  // `degraded:true` when the gateway is running without Supabase env,
  // so local-dev still hands back a path the FE can branch on.
  const presign = await issueOwnerDocPresign({
    tenantId: auth.tenantId,
    documentId: id,
    fileName: input.fileName,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
  }).catch((err) => {
    moduleLogger.warn(
      'owner-docs presign threw — falling back to placeholder',
      {
        tenantId: auth.tenantId,
        reason: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  });
  const fileUrl = presign
    ? `${presign.bucket}/${presign.path}`
    : `tenant-uploads/${auth.tenantId}/${now
        .toISOString()
        .slice(0, 7)}/${id}`;

  try {
    const [row] = await db
      .insert(documentUploads)
      .values({
        id,
        tenantId: auth.tenantId,
        customerId: null,
        documentType,
        status: 'pending_upload',
        source: 'app_upload',
        fileName: input.fileName,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        fileUrl,
        thumbnailUrl: null,
        entityType: ENTITY_TYPE,
        entityId: null,
        metadata: {
          uploadedVia: 'owner-cockpit-home-chat',
          uploaderUserId: auth.userId,
          ownerCategory: category,
          textSample: input.textSample ?? null,
        },
        tags: input.tags ?? [],
        kind: 'other',
        ingestionStatus: 'queued',
        ingestionError: null,
        ingestedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .returning();

    moduleLogger.info('owner-docs: intake registered', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      documentId: id,
      category,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      presignDegraded: presign?.degraded ?? true,
    });

    // Hash-chain audit of the presign issuance so an operator can
    // trace every URL that left the gateway against an owner request.
    // Best-effort — a chain gap is logged but does not block delivery.
    try {
      await db.execute(
        sql`
          WITH prev AS (
            SELECT this_hash, sequence_id
              FROM ai_audit_chain
             WHERE tenant_id = ${auth.tenantId}
             ORDER BY sequence_id DESC
             LIMIT 1
          )
          INSERT INTO ai_audit_chain
            (id, tenant_id, sequence_id, turn_id, session_id, action,
             prev_hash, this_hash, payload_ref, payload, created_at)
          VALUES (
            ${randomUUID()},
            ${auth.tenantId},
            COALESCE((SELECT sequence_id FROM prev), 0) + 1,
            ${`owner-docs-presign-${id}`},
            NULL,
            ${'owner.docs.presign.issue'},
            COALESCE((SELECT this_hash FROM prev), ''),
            encode(sha256(
              (COALESCE((SELECT this_hash FROM prev), '') ||
               ${JSON.stringify({
                 documentId: id,
                 tenantId: auth.tenantId,
                 userId: auth.userId,
                 bucket: presign?.bucket ?? 'tenant-uploads',
                 path: presign?.path ?? null,
                 degraded: presign?.degraded ?? true,
               })}
              )::bytea
            ), 'hex'),
            NULL,
            ${JSON.stringify({
              action: 'owner.docs.presign.issue',
              documentId: id,
              fileName: input.fileName,
              mimeType: input.mimeType,
              fileSize: input.fileSize,
              category,
              bucket: presign?.bucket ?? 'tenant-uploads',
              path: presign?.path ?? null,
              degraded: presign?.degraded ?? true,
              expiresAt: presign?.expiresAt ?? null,
            })}::jsonb,
            ${now.toISOString()}::timestamptz
          )
        `,
      );
    } catch (auditErr) {
      moduleLogger.warn('owner-docs: presign audit-chain append failed', {
        tenantId: auth.tenantId,
        documentId: id,
        reason:
          auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
    }

    return c.json(
      ok({
        documentId: row.id,
        ingestionStatus: 'queued',
        category,
        documentType,
        // Legacy shape — kept so existing FE callers keep working.
        presignedPut: presign?.uploadUrl ?? fileUrl,
        // New canonical shape — fields the FE PUTs the bytes against.
        presigned: presign
          ? {
              bucket: presign.bucket,
              path: presign.path,
              uploadUrl: presign.uploadUrl,
              token: presign.token,
              expiresAt: presign.expiresAt,
              headers: presign.headers,
              degraded: presign.degraded,
            }
          : null,
        document: row,
      }),
      201,
    );
  } catch (e) {
    moduleLogger.error('owner-docs: intake failed', {
      tenantId: auth.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json(err('INTAKE_FAILED', 'Failed to register intake'), 500);
  }
});

// ---------------------------------------------------------------------------
// GET / — list owner-intake docs newest first
// ---------------------------------------------------------------------------

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(err('OWNER_DOCS_DB_UNAVAILABLE', 'Database not configured'), 503);
  }
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
      metadata: documentUploads.metadata,
      createdAt: documentUploads.createdAt,
      createdBy: documentUploads.createdBy,
    })
    .from(documentUploads)
    .where(
      and(
        eq(documentUploads.tenantId, auth.tenantId),
        eq(documentUploads.entityType, ENTITY_TYPE),
      ),
    )
    .orderBy(desc(documentUploads.createdAt))
    .limit(limit);

  return c.json(ok({ documents: rows }), 200);
});

// ---------------------------------------------------------------------------
// Shared internals for explain / qa
// ---------------------------------------------------------------------------

async function loadDocumentWithChunks(
  db: any,
  tenantId: string,
  documentId: string,
): Promise<{
  doc: typeof documentUploads.$inferSelect;
  chunkTexts: ReadonlyArray<{ id: string; text: string }>;
} | null> {
  const [doc] = await db
    .select()
    .from(documentUploads)
    .where(
      and(
        eq(documentUploads.tenantId, tenantId),
        eq(documentUploads.id, documentId),
      ),
    )
    .limit(1);
  if (!doc) return null;

  const links = await db
    .select({ chunkId: documentCorpusLinks.chunkId })
    .from(documentCorpusLinks)
    .where(
      and(
        eq(documentCorpusLinks.tenantId, tenantId),
        eq(documentCorpusLinks.documentId, documentId),
      ),
    )
    .limit(16);

  const chunkTexts =
    links.length > 0
      ? ((await db
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
                links.map((l: { chunkId: string }) => l.chunkId),
              ),
            ),
          )
          .limit(16)) as ReadonlyArray<{ id: string; text: string }>)
      : [];

  return { doc, chunkTexts };
}

function categoryOf(doc: { metadata: unknown }): string {
  if (!doc.metadata || typeof doc.metadata !== 'object') return 'other';
  const v = (doc.metadata as Record<string, unknown>).ownerCategory;
  return typeof v === 'string' ? v : 'other';
}

function joinedContext(
  chunks: ReadonlyArray<{ id: string; text: string }>,
  cap = 6000,
): string {
  let out = '';
  for (const c of chunks) {
    if (out.length + c.text.length > cap) break;
    out += `[chunk:${c.id}]\n${c.text}\n\n`;
  }
  return out.trim();
}

// ---------------------------------------------------------------------------
// POST /:id/explain
// ---------------------------------------------------------------------------

app.post('/:id/explain', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => ({}));
  const parsed = explainSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid explain payload'), 400);
  }
  if (!db) {
    return c.json(err('OWNER_DOCS_DB_UNAVAILABLE', 'Database not configured'), 503);
  }

  const loaded = await loadDocumentWithChunks(db, auth.tenantId, id);
  if (!loaded) return c.json(err('NOT_FOUND', 'Document not found'), 404);

  const { doc, chunkTexts } = loaded;
  const language = parsed.data.language;
  const category = categoryOf(doc);
  const context = joinedContext(chunkTexts);

  const systemPrompt =
    language === 'sw'
      ? 'Wewe ni Bwana Mwikila, mshauri wa Borjie. Eleza hati ya mmiliki kwa aya moja fupi, ukitumia tu maandishi yaliyotolewa hapa. Onyesha tarehe muhimu na kiasi cha pesa ikiwa zipo. Tumia Kiswahili rahisi. Mwisho, ongeza hatua moja iliyopendekezwa.'
      : 'You are Mr. Mwikila, the Borjie owner advisor. Summarise this owner document in ONE tight paragraph using ONLY the supplied chunks. Surface key dates and money amounts where present. End with one recommended next action.';

  const userPrompt =
    `Document filename: ${doc.fileName}\n` +
    `Category guess: ${category}\n` +
    `Mime: ${doc.mimeType}\n\n` +
    (context.length > 0
      ? `Extracted chunks:\n${context}`
      : '(no chunks indexed yet — explain what this kind of document typically means for a Tanzanian mining owner and what to do next)');

  try {
    const result = await callBrainOnce({
      systemPrompt,
      userPrompt,
      maxTokens: 600,
    });
    return c.json(
      ok({
        documentId: id,
        category,
        language,
        summary: result.text,
        evidenceIds: chunkTexts.map((c) => c.id),
        provider: result.provider,
        latencyMs: result.latencyMs,
      }),
      200,
    );
  } catch (e) {
    moduleLogger.error('owner-docs: explain failed', {
      tenantId: auth.tenantId,
      documentId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json(
      err('BRAIN_UNAVAILABLE', e instanceof Error ? e.message : 'Brain unavailable'),
      502,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /:id/qa
// ---------------------------------------------------------------------------

app.post('/:id/qa', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  const raw = await c.req.json().catch(() => null);
  const parsed = qaSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(err('VALIDATION_ERROR', 'Invalid qa payload'), 400);
  }
  if (!db) {
    return c.json(err('OWNER_DOCS_DB_UNAVAILABLE', 'Database not configured'), 503);
  }

  const loaded = await loadDocumentWithChunks(db, auth.tenantId, id);
  if (!loaded) return c.json(err('NOT_FOUND', 'Document not found'), 404);
  const { doc, chunkTexts } = loaded;
  const language = parsed.data.language;
  const context = joinedContext(chunkTexts);

  const systemPrompt =
    language === 'sw'
      ? 'Wewe ni Bwana Mwikila. Jibu swali la mmiliki KWA KUTUMIA TU maandishi yaliyotolewa kutoka hati hii. Ikiwa jibu haliko kwenye maandishi, sema "Sina taarifa hiyo kwenye hati hii" na pendekeza nini cha kufanya.'
      : 'You are Mr. Mwikila. Answer the owner\'s question USING ONLY the chunks supplied from this single document. If the answer is not in the chunks, say so clearly and suggest the next concrete step. Cite chunk ids inline like [chunk:abc].';

  const userPrompt =
    `Document filename: ${doc.fileName}\n\n` +
    (context.length > 0
      ? `Extracted chunks:\n${context}\n\n`
      : '(no chunks indexed for this document yet)\n\n') +
    `Owner question: ${parsed.data.question}`;

  try {
    const result = await callBrainOnce({
      systemPrompt,
      userPrompt,
      maxTokens: 700,
    });
    return c.json(
      ok({
        documentId: id,
        question: parsed.data.question,
        language,
        answer: result.text,
        evidenceIds: chunkTexts.map((c) => c.id),
        provider: result.provider,
        latencyMs: result.latencyMs,
      }),
      200,
    );
  } catch (e) {
    moduleLogger.error('owner-docs: qa failed', {
      tenantId: auth.tenantId,
      documentId: id,
      error: e instanceof Error ? e.message : String(e),
    });
    return c.json(
      err('BRAIN_UNAVAILABLE', e instanceof Error ? e.message : 'Brain unavailable'),
      502,
    );
  }
});

export const ownerDocsRouter = app;
export default ownerDocsRouter;
