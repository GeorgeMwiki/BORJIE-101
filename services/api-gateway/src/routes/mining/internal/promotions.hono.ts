/**
 * /api/v1/mining/internal/promotions — recent prompt / model / corpus
 * version promotions with revert metadata.
 *
 * SUPER_ADMIN-only. Reads from the platform-scope `prompt_promotions`
 * table (migration 0008) which records every promote event raised by
 * the rollout controller plus operator-initiated reverts.
 *
 * Routes:
 *   GET  /     paginated list (filter: kind, subject, since, limit)
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, gte } from 'drizzle-orm';
import { promptPromotions } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { internalPromotionsListRoute } from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalPromotionsListRoute, async (c) => {
  const db = c.get('db');
  const { kind, subject, since, limit } = c.req.valid('query');
  const conds: unknown[] = [];
  if (kind) conds.push(eq(promptPromotions.kind, kind));
  if (subject) conds.push(eq(promptPromotions.subject, subject));
  if (since) conds.push(gte(promptPromotions.promotedAt, new Date(since)));
  const query = db
    .select()
    .from(promptPromotions)
    .orderBy(desc(promptPromotions.promotedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true as const, data: rows }, 200);
});

export const miningInternalPromotionsRouter = app;
