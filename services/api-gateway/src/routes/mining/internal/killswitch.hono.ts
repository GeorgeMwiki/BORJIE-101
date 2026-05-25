// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/killswitch — platform / per-tenant kill-switch.
 *
 * Mutating ⇒ requires SUPER_ADMIN role AND `X-Confirmation-Operator-Id`
 * header (a second operator's user id) so the four-eye policy holds.
 * Fail-closed: missing confirmation ⇒ 403; bad scope ⇒ 400.
 *
 * Routes:
 *   POST  /     set kill-switch state for a scope
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { platformKillswitchState } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN));
app.use('*', databaseMiddleware);

const ScopeSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => s === 'platform' || s.startsWith('tenant:'), {
    message: 'Scope must be "platform" or "tenant:<tenantId>"',
  });

const SetKillswitchSchema = z.object({
  scope: ScopeSchema,
  level: z.enum(['live', 'degraded', 'halt']),
  reasonCode: z.string().min(1).max(200),
  note: z.string().max(500).optional(),
});

app.post(
  '/',
  zValidator('json', SetKillswitchSchema),
  withSecurityEvents(
    { action: 'platform.killswitch.set', resource: 'platform.killswitch', severity: 'critical' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const confirmationOperator = c.req.header('X-Confirmation-Operator-Id');
      if (!confirmationOperator || confirmationOperator === userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FOUR_EYE_REQUIRED',
              message: 'A distinct second operator must confirm via X-Confirmation-Operator-Id',
            },
          },
          403,
        );
      }
      const input = c.req.valid('json');
      const [existing] = await db
        .select()
        .from(platformKillswitchState)
        .where(eq(platformKillswitchState.scope, input.scope))
        .limit(1);
      const now = new Date();
      const setBy = `${userId}+${confirmationOperator}`;
      if (!existing) {
        const [row] = await db
          .insert(platformKillswitchState)
          .values({
            id: randomUUID(),
            scope: input.scope,
            level: input.level,
            reasonCode: input.reasonCode,
            note: input.note ?? null,
            prevLevel: null,
            prevReasonCode: null,
            prevNote: null,
            setAt: now,
            setBy,
          })
          .returning();
        return c.json({ success: true, data: row }, 201);
      }
      const [row] = await db
        .update(platformKillswitchState)
        .set({
          level: input.level,
          reasonCode: input.reasonCode,
          note: input.note ?? null,
          prevLevel: existing.level,
          prevReasonCode: existing.reasonCode,
          prevNote: existing.note,
          setAt: now,
          setBy,
        })
        .where(eq(platformKillswitchState.scope, input.scope))
        .returning();
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningInternalKillswitchRouter = app;
