// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/citations — searchable regulation index.
 *
 * SUPER_ADMIN-only. Reads from the global Borjie intelligence corpus
 * (`intelligence_corpus_chunks` rows where `tenant_id IS NULL`) and
 * filters by source agency (Gazette / NEMC / Tumemadini / BoT / TRA).
 *
 * The source filter resolves to `metadata.source` (set by the corpus
 * ingestion pipeline) OR a substring match in `source_file` for
 * legacy rows that pre-date the metadata convention.
 *
 * Routes:
 *   GET  /     paginated list (filter: source, q, language, limit)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { intelligenceCorpusChunks } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { internalCitationsListRoute } from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalCitationsListRoute, async (c) => {
  const db = c.get('db');
  const { source, q, language, limit } = c.req.valid('query');
  const conds: unknown[] = [isNull(intelligenceCorpusChunks.tenantId)];
  if (language) conds.push(eq(intelligenceCorpusChunks.language, language));
  if (source) {
    conds.push(
      or(
        sql`${intelligenceCorpusChunks.metadata}->>'source' = ${source}`,
        ilike(intelligenceCorpusChunks.sourceFile, `%${source}%`),
      ),
    );
  }
  if (q) {
    conds.push(
      or(
        ilike(intelligenceCorpusChunks.text, `%${q}%`),
        ilike(intelligenceCorpusChunks.sourceFile, `%${q}%`),
        ilike(intelligenceCorpusChunks.section, `%${q}%`),
      ),
    );
  }
  const rows = await db
    .select({
      id: intelligenceCorpusChunks.id,
      sourceFile: intelligenceCorpusChunks.sourceFile,
      section: intelligenceCorpusChunks.section,
      page: intelligenceCorpusChunks.page,
      text: intelligenceCorpusChunks.text,
      url: intelligenceCorpusChunks.url,
      language: intelligenceCorpusChunks.language,
      metadata: intelligenceCorpusChunks.metadata,
      ingestedAt: intelligenceCorpusChunks.ingestedAt,
    })
    .from(intelligenceCorpusChunks)
    .where(and(...conds))
    .orderBy(desc(intelligenceCorpusChunks.ingestedAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningInternalCitationsRouter = app;
