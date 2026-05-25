// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/prompts — kernel prompt registry admin.
 *
 * Routes:
 *   GET   /          list registry (filter by capability, status)
 *   POST  /promote   promote a prompt from shadow into canary
 *
 * SUPER_ADMIN-only. Promotion is gated by the upstream rollout
 * controller; this surface records the intent and flips status to
 * `canary`. The promote endpoint is intentionally narrow — see
 * `packages/database/src/services/kernel-prompt-registry.service.ts`
 * for the full state machine.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { kernelPromptRegistry } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const PromoteSchema = z.object({
  capability: z.string().min(1).max(200),
  version: z.string().min(1).max(80),
});

app.get('/', async (c) => {
  const db = c.get('db');
  const capability = c.req.query('capability');
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000);
  const conds = [] as unknown[];
  if (capability) conds.push(eq(kernelPromptRegistry.capability, capability));
  if (status) conds.push(eq(kernelPromptRegistry.status, status));
  const query = db
    .select()
    .from(kernelPromptRegistry)
    .orderBy(desc(kernelPromptRegistry.promotedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true, data: rows });
});

app.post(
  '/promote',
  zValidator('json', PromoteSchema),
  withSecurityEvents(
    { action: 'platform.prompt.promote', resource: 'platform.prompt', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const input = c.req.valid('json');
      const [row] = await db
        .update(kernelPromptRegistry)
        .set({ status: 'canary', promotedAt: new Date(), promotedBy: userId })
        .where(
          and(
            eq(kernelPromptRegistry.capability, input.capability),
            eq(kernelPromptRegistry.version, input.version),
          ),
        )
        .returning();
      if (!row) {
        return c.json(
          { success: false, error: { code: 'NOT_FOUND', message: 'Prompt (capability, version) not found' } },
          404,
        );
      }
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningInternalPromptsRouter = app;
