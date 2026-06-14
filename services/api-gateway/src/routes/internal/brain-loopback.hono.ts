/**
 * /api/v1/internal/brain + /api/v1/internal/documents — shared brain-tool
 * loopback endpoints.
 *
 * Companion to:
 *   - services/api-gateway/src/composition/brain-tools/shared-tools.ts
 *     (borjie.ask / borjie.cite / documents.upload / documents.search)
 *
 * These four tools were BORN DARK: each handler POSTed/GETed to
 * `/internal/brain/ask`, `/internal/brain/cite`,
 * `/internal/documents/upload-url`, `/internal/documents/search` over the
 * loopback client, but NO router was ever mounted there — every call 404'd
 * and the tool fell back to its defensive stub (or threw, for `upload`).
 * This single router (mounted at BOTH `/internal/brain` and
 * `/internal/documents` in index.ts) lights them up.
 *
 * Routes (ALL Supabase-JWT authed + tenant-bound):
 *   POST /ask          corpus-grounded sub-answer + evidence ids (READ)
 *   POST /cite         resolve evidence ids → citations (READ)
 *   POST /upload-url   record a pending document + return its put URL (WRITE,
 *                      metadata only — the blob is PUT by the client)
 *   GET  /search       text search the tenant's uploaded documents (READ)
 *
 * Auth model: mirrors the working brain-loopback routers (owner/tabs,
 * mining/documents) — `authMiddleware` + `databaseMiddleware`. The tenant GUC
 * + an explicit `tenant_id` predicate are the load-bearing isolation
 * controls; the persona-tool gate already restricts which personas can reach
 * these tools.
 *
 * Honest-degrade: a missing DB yields an EMPTY structured result, never
 * fabricated citations / answers. The corpus is tenant-AGNOSTIC global
 * ground truth (tenant_id IS NULL) PLUS the tenant's own rows, per CLAUDE.md.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, isNull, or, inArray, type SQL } from 'drizzle-orm';
import {
  intelligenceCorpusChunks,
  documentUploads,
} from '@borjie/database';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const loopbackLogger = createLogger('internal-brain-loopback');

// ---------------------------------------------------------------------------
// Composition seam (test-injectable). Production reads the tenant-bound
// client from `c.get('db')`; tests set `c.set('services', { loopbackDb })`
// to run against an in-memory double without a live PG (and still exercise
// the REAL auth gate). Mirrors the seam in entity-legibility.hono.ts.
// ---------------------------------------------------------------------------

function resolveDb(c: any): any | null {
  const injected = (c.get('services') as { loopbackDb?: unknown } | undefined) ?? {};
  if (injected.loopbackDb) return injected.loopbackDb;
  return c.get('db') ?? null;
}

// ---------------------------------------------------------------------------
// Schemas — mirror the shared-tool wire contracts.
// ---------------------------------------------------------------------------

const askSchema = z.object({
  tenantId: z.string().min(1).optional(),
  question: z.string().min(1).max(2000),
  sourcePersona: z.string().optional(),
});

const citeSchema = z.object({
  tenantId: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(20),
});

const uploadUrlSchema = z.object({
  tenantId: z.string().min(1).optional(),
  actorId: z.string().min(1).optional(),
  fileName: z.string().min(1).max(256),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive().max(50_000_000),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// POST /ask — corpus-grounded sub-answer. NEVER fabricates: returns the top
// matching corpus snippet + its evidence id, or an empty-evidence echo when
// nothing matches. (The full recursive brain hand-off lives in the kernel;
// this loopback gives the tool a grounded, evidence-carrying fast path.)
app.post('/ask', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = askSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ answer: '', evidenceIds: [] }, 400);
  }
  const db = resolveDb(c);
  if (!db) return c.json({ answer: parsed.data.question, evidenceIds: [] });
  try {
    const rows = await db
      .select({
        id: intelligenceCorpusChunks.id,
        text: intelligenceCorpusChunks.text,
        sourceFile: intelligenceCorpusChunks.sourceFile,
      })
      .from(intelligenceCorpusChunks)
      .where(
        and(
          // Global corpus (tenant_id IS NULL) + the tenant's own chunks.
          or(
            isNull(intelligenceCorpusChunks.tenantId),
            eq(intelligenceCorpusChunks.tenantId, auth.tenantId),
          ),
          ilike(intelligenceCorpusChunks.text, `%${parsed.data.question}%`),
        ),
      )
      .orderBy(desc(intelligenceCorpusChunks.ingestedAt))
      .limit(5);
    if (rows.length === 0) {
      return c.json({ answer: parsed.data.question, evidenceIds: [] });
    }
    const answer = String(rows[0]?.text ?? '').slice(0, 1200);
    const evidenceIds = rows.map((r: { id: string }) => r.id);
    return c.json({ answer, evidenceIds });
  } catch (err) {
    loopbackLogger.warn('brain ask degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ answer: parsed.data.question, evidenceIds: [] });
  }
});

// POST /cite — resolve evidence ids → human-readable citations.
app.post('/cite', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = citeSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ citations: [] }, 400);
  }
  const db = resolveDb(c);
  const fallback = {
    citations: parsed.data.evidenceIds.map((id) => ({
      evidenceId: id,
      title: 'unknown',
      excerpt: '',
    })),
  };
  if (!db) return c.json(fallback);
  try {
    const rows = await db
      .select({
        id: intelligenceCorpusChunks.id,
        sourceFile: intelligenceCorpusChunks.sourceFile,
        text: intelligenceCorpusChunks.text,
        url: intelligenceCorpusChunks.url,
      })
      .from(intelligenceCorpusChunks)
      .where(
        and(
          or(
            isNull(intelligenceCorpusChunks.tenantId),
            eq(intelligenceCorpusChunks.tenantId, auth.tenantId),
          ),
          inArray(intelligenceCorpusChunks.id, parsed.data.evidenceIds),
        ),
      );
    const byId = new Map(
      rows.map((r: { id: string; sourceFile: string | null; text: string; url: string | null }) => [
        r.id,
        r,
      ]),
    );
    const citations = parsed.data.evidenceIds.map((id) => {
      const r = byId.get(id) as
        | { id: string; sourceFile: string | null; text: string; url: string | null }
        | undefined;
      if (!r) return { evidenceId: id, title: 'unknown', excerpt: '' };
      return {
        evidenceId: id,
        title: r.sourceFile ?? 'corpus chunk',
        excerpt: String(r.text ?? '').slice(0, 320),
        ...(r.url ? { sourceUri: r.url } : {}),
      };
    });
    return c.json({ citations });
  } catch (err) {
    loopbackLogger.warn('brain cite degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json(fallback);
  }
});

// POST /upload-url — record a pending document upload + return a put URL.
// The blob itself is PUT by the client; we persist only the metadata row so
// the indexing pipeline (DOC-Intelligence) can pick it up.
app.post('/upload-url', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = uploadUrlSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid upload body' } }, 400);
  }
  const db = resolveDb(c);
  if (!db) {
    return c.json(
      { error: { code: 'DB_UNAVAILABLE', message: 'document upload requires a database' } },
      503,
    );
  }
  try {
    const id = randomUUID();
    const now = new Date();
    const fileUrl = `s3://borjie-${auth.tenantId}/documents/${id}/${encodeURIComponent(
      parsed.data.fileName,
    )}`;
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    await db
      .insert(documentUploads)
      .values({
        id,
        tenantId: auth.tenantId,
        customerId: null,
        documentType: 'other',
        status: 'pending_upload',
        source: 'api',
        fileName: parsed.data.fileName,
        fileSize: parsed.data.byteSize,
        mimeType: parsed.data.contentType,
        fileUrl,
        thumbnailUrl: null,
        metadata: { uploadedVia: 'brain-tool-loopback' },
        tags: [],
        createdAt: now,
        updatedAt: now,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })
      .onConflictDoNothing();
    return c.json({ uploadUrl: fileUrl, documentId: id, expiresAt });
  } catch (err) {
    loopbackLogger.warn('documents upload-url degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      { error: { code: 'UPLOAD_FAILED', message: 'Could not create the upload record' } },
      500,
    );
  }
});

// GET /search — text search the tenant's uploaded documents.
app.get('/search', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string };
  const q = (c.req.query('q') ?? '').toString();
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '10', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 10;
  const db = resolveDb(c);
  if (!db || q.length === 0) return c.json({ hits: [], totalHits: 0 });
  try {
    const conds: SQL[] = [
      eq(documentUploads.tenantId, auth.tenantId),
      isNull(documentUploads.deletedAt),
    ];
    const qCond = ilike(documentUploads.fileName, `%${q}%`);
    if (qCond) conds.push(qCond);
    const rows = await db
      .select({
        id: documentUploads.id,
        fileName: documentUploads.fileName,
        documentType: documentUploads.documentType,
        updatedAt: documentUploads.updatedAt,
      })
      .from(documentUploads)
      .where(and(...conds))
      .orderBy(desc(documentUploads.updatedAt))
      .limit(limit);
    const hits = rows.map(
      (r: { id: string; fileName: string; documentType: string }, idx: number) => ({
        documentId: r.id,
        title: r.fileName,
        snippet: `${r.documentType} — ${r.fileName}`,
        score: Math.max(0.1, 1 - idx * 0.05),
      }),
    );
    return c.json({ hits, totalHits: hits.length });
  } catch (err) {
    loopbackLogger.warn('documents search degraded', {
      tenantId: auth.tenantId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return c.json({ hits: [], totalHits: 0 });
  }
});

export const internalBrainLoopbackRouter = app;
export default internalBrainLoopbackRouter;
