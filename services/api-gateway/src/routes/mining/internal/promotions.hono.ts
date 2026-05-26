// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
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
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte } from 'drizzle-orm';
import { promptPromotions } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const QuerySchema = z.object({
  kind: z.enum(['prompt', 'model', 'corpus']).optional(),
  subject: z.string().min(1).max(200).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

app.get('/', zValidator('query', QuerySchema), async (c) => {
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
  return c.json({ success: true, data: rows, meta: { count: rows.length, limit } });
});

export const miningInternalPromotionsRouter = app;
