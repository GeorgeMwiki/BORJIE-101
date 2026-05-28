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
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { kernelPromptRegistry } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  internalPromptsListRoute,
  internalPromptsPromoteRoute,
} from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

app.openapi(internalPromptsListRoute, async (c) => {
  const db = c.get('db');
  const q = c.req.valid('query');
  const limit = Math.min(Number(q.limit ?? 200), 1000);
  const conds: SQL[] = [];
  if (q.capability) conds.push(eq(kernelPromptRegistry.capability, q.capability));
  if (q.status) conds.push(eq(kernelPromptRegistry.status, q.status));
  const query = db
    .select()
    .from(kernelPromptRegistry)
    .orderBy(desc(kernelPromptRegistry.promotedAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true as const, data: rows }, 200);
});

app.openapi(
  internalPromptsPromoteRoute,
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
          {
            success: false as const,
            error: {
              code: 'NOT_FOUND',
              message: 'Prompt (capability, version) not found',
            },
          },
          404,
        );
      }
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

export const miningInternalPromptsRouter = app;
