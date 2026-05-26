/**
 * /api/v1/mining/internal/corpus — global intelligence corpus admin.
 *
 * Tenant_id NULL ⇒ Borjie-wide ground truth. SUPER_ADMIN-only.
 *
 * Routes:
 *   POST  /upload            ingest one chunk
 *   POST  /supersede         mark a chunk superseded by a new one
 *   GET   /versions          list chunks grouped by source_file
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { intelligenceCorpusChunks } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalCorpusUploadRoute,
  internalCorpusSupersedeRoute,
  internalCorpusVersionsRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(
  internalCorpusUploadRoute,
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
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  internalCorpusSupersedeRoute,
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
      if (!row) {
        return c.json(
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Chunk not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

app.openapi(internalCorpusVersionsRoute, async (c) => {
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 200), 1000);
  const conds = [isNull(intelligenceCorpusChunks.tenantId)];
  if (q.source_file) conds.push(eq(intelligenceCorpusChunks.sourceFile, q.source_file));
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
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningInternalCorpusRouter = app;
