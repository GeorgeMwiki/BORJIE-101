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
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq } from 'drizzle-orm';
import { regulatorPipelineEntries } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalRegulatorListRoute,
  internalRegulatorMoveRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalRegulatorListRoute, async (c) => {
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
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  internalRegulatorMoveRoute,
  withSecurityEvents(
    {
      action: 'platform.regulator_pipeline.move',
      resource: 'platform.regulator_pipeline',
      severity: 'info',
    },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const { id } = c.req.valid('param');
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
          {
            success: false as const,
            error: { code: 'NOT_FOUND', message: 'Pipeline entry not found' },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningInternalRegulatorPipelineRouter = app;
