// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
/**
 * /api/v1/mining/internal/corpus — global intelligence corpus admin.
 *
 * Tenant_id NULL ⇒ Borjie-wide ground truth. SUPER_ADMIN-only.
 *
 * Routes:
 *   POST  /upload            ingest one chunk
 *   POST  /supersede         mark a chunk superseded by a new one
 *   GET   /versions          list chunks grouped by source_file
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { intelligenceCorpusChunks } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const UploadSchema = z.object({
  sourceFile: z.string().min(1).max(500),
  section: z.string().max(200).optional(),
  page: z.number().int().nonnegative().optional(),
  text: z.string().min(1),
  url: z.string().url().optional(),
  language: z.enum(['en', 'sw', 'fr', 'zh', 'pt']).default('en'),
  metadata: z.record(z.unknown()).optional(),
  // Embedding generation runs in the consolidation worker; clients can
  // optionally pre-supply a vector.
  embedding: z.array(z.number()).length(1024).optional(),
});

const SupersedeSchema = z.object({
  oldChunkId: z.string().min(1),
  newChunkId: z.string().min(1),
});

app.post(
  '/upload',
  zValidator('json', UploadSchema),
  withSecurityEvents(
    { action: 'platform.corpus.upload', resource: 'platform.corpus', severity: 'info' },
    async (c) => {
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .insert(intelligenceCorpusChunks)
        .values({
          id: randomUUID(),
          tenantId: null,
          sourceFile: input.sourceFile,
          section: input.section ?? null,
          page: input.page ?? null,
          text: input.text,
          embedding: input.embedding ?? null,
          url: input.url ?? null,
          language: input.language,
          metadata: input.metadata ?? {},
          ingestedAt: new Date(),
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.post(
  '/supersede',
  zValidator('json', SupersedeSchema),
  withSecurityEvents(
    { action: 'platform.corpus.supersede', resource: 'platform.corpus', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const input = c.req.valid('json');
      const [row] = await db
        .update(intelligenceCorpusChunks)
        .set({ supersededById: input.newChunkId })
        .where(eq(intelligenceCorpusChunks.id, input.oldChunkId))
        .returning();
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Chunk not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

app.get('/versions', async (c) => {
  const db = c.get('db');
  const sourceFile = c.req.query('source_file');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000);
  const conds = [isNull(intelligenceCorpusChunks.tenantId)];
  if (sourceFile) conds.push(eq(intelligenceCorpusChunks.sourceFile, sourceFile));
  const rows = await db
    .select({
      id: intelligenceCorpusChunks.id,
      sourceFile: intelligenceCorpusChunks.sourceFile,
      section: intelligenceCorpusChunks.section,
      page: intelligenceCorpusChunks.page,
      language: intelligenceCorpusChunks.language,
      url: intelligenceCorpusChunks.url,
      supersededById: intelligenceCorpusChunks.supersededById,
      ingestedAt: intelligenceCorpusChunks.ingestedAt,
    })
    .from(intelligenceCorpusChunks)
    .where(and(...conds))
    .orderBy(desc(intelligenceCorpusChunks.ingestedAt))
    .limit(limit);
  return c.json({ success: true, data: rows });
});

export const miningInternalCorpusRouter = app;
