// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/killswitch — platform / per-tenant kill switch
 * with proper two-operator RBAC.
 *
 * Replaces the legacy tenant-prefixed scope hack on
 * `X-Confirmation-Operator-Id` (issue #24). The flow is now:
 *
 *   1. POST /             — initiator creates a pending_confirmations
 *                            row. UI shows "waiting for 2nd operator
 *                            within 30 s".
 *   2. POST /:id/confirm  — confirmer (distinct user) approves. Both
 *                            users must hold a matching
 *                            killswitch_authorities row and the
 *                            confirmation must arrive within 30 s.
 *
 * Mutation eligibility is enforced TWICE: Supabase JWT role must be
 * SUPER_ADMIN AND the user must hold an active authority covering the
 * target scope. Fail-closed everywhere.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, like } from 'drizzle-orm';
import {
  killswitchPendingConfirmations,
  platformKillswitchState,
} from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import {
  applyKillswitch,
  parseScope,
  userHoldsAuthority,
  type KillswitchScope,
} from './killswitch-rbac';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN));
app.use('*', databaseMiddleware);

const PENDING_WINDOW_MS = 30_000;

const ScopeSchema = z
  .string()
  .min(1)
  .max(120)
  .refine((s) => s === 'platform' || s.startsWith('tenant:'), {
    message: 'Scope must be "platform" or "tenant:<tenantId>"',
  });

const InitiateSchema = z.object({
  scope: ScopeSchema,
  level: z.enum(['live', 'degraded', 'halt']),
  reasonCode: z.string().min(1).max(200),
  note: z.string().max(500).optional(),
});

const TargetSchema = z.object({
  scope: ScopeSchema,
  level: z.enum(['live', 'degraded', 'halt']),
  reasonCode: z.string().min(1).max(200),
  note: z.string().max(500).optional(),
});

type ParsedTarget = z.infer<typeof TargetSchema>;

function forbiddenAuthority(c: unknown, scope: string) {
  return (c as { json: (body: unknown, status: number) => unknown }).json(
    {
      success: false,
      error: {
        code: 'NO_KILLSWITCH_AUTHORITY',
        message: `User does not hold an active authority covering ${scope}`,
      },
    },
    403,
  );
}

// ----------------------------------------------------------------------------
// POST /  — initiate
// ----------------------------------------------------------------------------
app.post(
  '/',
  zValidator('json', InitiateSchema),
  withSecurityEvents(
    {
      action: 'platform.killswitch.initiate',
      resource: 'platform.killswitch',
      severity: 'critical',
    },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const input = c.req.valid('json');

      let scope: KillswitchScope;
      try {
        scope = parseScope(input.scope);
      } catch (err) {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_SCOPE',
              message: err instanceof Error ? err.message : 'Invalid scope',
            },
          },
          400,
        );
      }

      const hasAuthority = await userHoldsAuthority(db, userId, scope);
      if (!hasAuthority) {
        return forbiddenAuthority(c, scope);
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + PENDING_WINDOW_MS);
      const target: ParsedTarget = {
        scope: input.scope,
        level: input.level,
        reasonCode: input.reasonCode,
        note: input.note,
      };
      const [row] = await db
        .insert(killswitchPendingConfirmations)
        .values({
          id: randomUUID(),
          killswitchTarget: target,
          initiatorUserId: userId,
          initiatedAt: now,
          expiresAt,
        })
        .returning();
      return c.json(
        {
          success: true,
          data: {
            pendingConfirmationId: row.id,
            target,
            expiresAt: row.expiresAt,
            waitingForSecondOperator: true,
          },
        },
        201,
      );
    },
  ),
);

// ----------------------------------------------------------------------------
// POST /:id/confirm  — second operator confirms
// ----------------------------------------------------------------------------
app.post(
  '/:id/confirm',
  withSecurityEvents(
    {
      action: 'platform.killswitch.confirm',
      resource: 'platform.killswitch',
      severity: 'critical',
    },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const pendingId = c.req.param('id');

      const [pending] = await db
        .select()
        .from(killswitchPendingConfirmations)
        .where(
          and(
            eq(killswitchPendingConfirmations.id, pendingId),
            isNull(killswitchPendingConfirmations.confirmedAt),
            gte(killswitchPendingConfirmations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!pending) {
        return c.json(
          {
            success: false,
            error: {
              code: 'PENDING_NOT_FOUND_OR_EXPIRED',
              message: 'No live pending confirmation matches that id',
            },
          },
          404,
        );
      }

      if (pending.initiatorUserId === userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FOUR_EYE_REQUIRED',
              message: 'Confirmer must be a different user than the initiator',
            },
          },
          403,
        );
      }

      const parsed = TargetSchema.safeParse(pending.killswitchTarget);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'CORRUPT_TARGET',
              message: 'Persisted target failed validation',
            },
          },
          500,
        );
      }
      const target = parsed.data;
      const scope = parseScope(target.scope);

      const [initiatorOk, confirmerOk] = await Promise.all([
        userHoldsAuthority(db, pending.initiatorUserId, scope),
        userHoldsAuthority(db, userId, scope),
      ]);
      if (!initiatorOk || !confirmerOk) {
        return forbiddenAuthority(c, target.scope);
      }

      const now = new Date();
      await db
        .update(killswitchPendingConfirmations)
        .set({ confirmedAt: now, confirmedByUserId: userId })
        .where(eq(killswitchPendingConfirmations.id, pendingId));

      const setBy = `${pending.initiatorUserId}+${userId}`;
      const { row, created } = await applyKillswitch(db, target, setBy, now);
      return c.json({ success: true, data: row }, created ? 201 : 200);
    },
  ),
);

// ----------------------------------------------------------------------------
// GET /  — list active kill-switch state per scope (read-only)
// ----------------------------------------------------------------------------
const ListQuerySchema = z.object({
  /** Filter to a single exact scope, e.g. 'platform' or 'tenant:<id>'. */
  scope: z.string().min(1).max(120).optional(),
  /** Filter to a tenant id; expands to scope LIKE 'tenant:<tenantId>%'. */
  tenantId: z.string().min(1).max(120).optional(),
  level: z.enum(['live', 'degraded', 'halt']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

app.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const db = c.get('db');
  const { scope, tenantId, level, limit } = c.req.valid('query');
  const conds: unknown[] = [];
  if (scope) conds.push(eq(platformKillswitchState.scope, scope));
  if (tenantId) conds.push(like(platformKillswitchState.scope, `tenant:${tenantId}%`));
  if (level) conds.push(eq(platformKillswitchState.level, level));
  const query = db
    .select()
    .from(platformKillswitchState)
    .orderBy(desc(platformKillswitchState.setAt))
    .limit(limit);
  const rows = conds.length > 0 ? await query.where(and(...conds)) : await query;
  return c.json({ success: true, data: rows, meta: { count: rows.length, limit } });
});

// ----------------------------------------------------------------------------
// GET /pending  — list pending confirmations the caller can act on
// ----------------------------------------------------------------------------
app.get('/pending', async (c) => {
  const db = c.get('db');
  const { userId } = c.get('auth');
  const rows = await db
    .select()
    .from(killswitchPendingConfirmations)
    .where(
      and(
        isNull(killswitchPendingConfirmations.confirmedAt),
        gte(killswitchPendingConfirmations.expiresAt, new Date()),
      ),
    )
    .limit(50);
  // Hide rows the caller initiated — they can't confirm their own.
  const actionable = rows.filter(
    (r: { initiatorUserId: string }) => r.initiatorUserId !== userId,
  );
  return c.json({ success: true, data: actionable });
});

export const miningInternalKillswitchRouter = app;
