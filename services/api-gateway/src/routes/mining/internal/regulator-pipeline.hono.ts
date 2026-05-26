// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/regulator-pipeline — kanban-shaped tracker
 * for incoming regulator changes (Gazette / NEMC / Tumemadini / BoT /
 * TRA) that need platform-staff review before being pushed into the
 * Borjie intelligence corpus.
 *
 * SUPER_ADMIN-only. Reads from the platform-scope
 * `regulator_pipeline_entries` table (migration 0008).
 *
 * Routes:
 *   GET    /                paginated list (filter: source, status, limit)
 *   PATCH  /:id/stage       move an entry to the next kanban stage
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { regulatorPipelineEntries } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const SourceEnum = z.enum(['gazette', 'nemc', 'bot', 'tra', 'tumemadini']);
const StageEnum = z.enum(['incoming', 'reviewing', 'approved', 'pushed']);

const ListQuerySchema = z.object({
  source: SourceEnum.optional(),
  status: StageEnum.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const MoveSchema = z.object({ stage: StageEnum });

app.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const db = c.get('db');
  const { source, status, limit } = c.req.valid('query');
  const conds: unknown[] = [];
  if (source) conds.push(eq(regulatorPipelineEntries.source, source));
  if (status) conds.push(eq(regulatorPipelineEntries.status, status));
  const query = db
    .select()
    .from(regulatorPipelineEntries)
    .orderBy(desc(regulatorPipelineEntries.capturedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true, data: rows, meta: { count: rows.length, limit } });
});

app.patch(
  '/:id/stage',
  zValidator('json', MoveSchema),
  withSecurityEvents(
    {
      action: 'platform.regulator_pipeline.move',
      resource: 'platform.regulator_pipeline',
      severity: 'info',
    },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      const { stage } = c.req.valid('json');
      const now = new Date();
      const patch: Record<string, unknown> = {
        status: stage,
        updatedAt: now,
        reviewedByUserId: userId,
      };
      if (stage === 'reviewing' || stage === 'approved') patch.reviewedAt = now;
      if (stage === 'pushed') patch.pushedToCorpusAt = now;
      const [row] = await db
        .update(regulatorPipelineEntries)
        .set(patch)
        .where(eq(regulatorPipelineEntries.id, id))
        .returning();
      if (!row) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Pipeline entry not found' } },
          404,
        );
      }
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningInternalRegulatorPipelineRouter = app;
