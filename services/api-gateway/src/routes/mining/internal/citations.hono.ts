// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
// TODO(openapi-migration): convert this router from plain Hono to
// OpenAPIHono + createRoute (issue #60, follow-up to #19). Routes here
// are still picked up by the regex generator pass in
// scripts/generate-openapi-spec.mjs but lack typed response shapes.
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
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { intelligenceCorpusChunks } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const SourceEnum = z.enum(['gazette', 'nemc', 'bot', 'tra', 'tumemadini', 'tmaa']);

const QuerySchema = z.object({
  source: SourceEnum.optional(),
  q: z.string().min(1).max(200).optional(),
  language: z.enum(['en', 'sw', 'fr', 'zh', 'pt']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

app.get('/', zValidator('query', QuerySchema), async (c) => {
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
  return c.json({ success: true, data: rows, meta: { count: rows.length, limit } });
});

export const miningInternalCitationsRouter = app;
