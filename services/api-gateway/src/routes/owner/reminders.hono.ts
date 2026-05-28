/**
 * /api/v1/owner/reminders — owner-cockpit reminders CRUD.
 *
 * Wave OWNER-OS. The owner asks Mr. Mwikila to remind them about a
 * regulator deadline, a renewal, a counterparty meeting, etc. The chat
 * dispatches here. The reminders-dispatch worker (in
 * `services/api-gateway/src/workers/reminders-dispatch.worker.ts`)
 * polls the `reminders` table every 30s, dispatches by email (default),
 * SMS, or Slack via the shared `EmailProvider` / `SmsProvider` ports
 * (`services/api-gateway/src/services/notification-dispatch/`), then
 * flips the row's status. The idempotency_key (derived per-create)
 * prevents double-fire under worker restart.
 *
 * Routes:
 *   POST   /                          create a reminder
 *   GET    /                          list the caller's reminders
 *   PATCH  /:id                       cancel or reschedule a reminder
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 *       `databaseMiddleware`'s `app.tenant_id` GUC for RLS.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';

import {
  reminders,
  REMINDER_CHANNELS,
  REMINDER_STATUSES,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-reminders');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  title: z.string().min(1).max(280),
  body: z.string().min(1).max(8000),
  triggerAt: z
    .string()
    .datetime({ offset: true })
    .refine(
      (s) => Number.isFinite(new Date(s).getTime()),
      'triggerAt must be a valid ISO-8601 timestamp',
    ),
  channel: z.enum(REMINDER_CHANNELS).default('email'),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Optional caller-supplied idempotency key. Generated if absent so
   *  the dispatcher's UNIQUE(tenant_id, idempotency_key) is satisfied. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const patchSchema = z
  .object({
    status: z.enum(['cancelled']).optional(),
    triggerAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.triggerAt !== undefined,
    { message: 'must update status or triggerAt' },
  );

const listQuerySchema = z.object({
  status: z.enum(REMINDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// POST / — create a reminder
// ---------------------------------------------------------------------------

app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'REMINDERS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }

  const raw = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid reminder payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;
  const triggerAt = new Date(input.triggerAt);
  if (triggerAt.getTime() <= Date.now()) {
    return c.json(
      { success: false, error: { code: 'TRIGGER_IN_PAST', message: 'triggerAt must be in the future' } },
      400,
    );
  }

  const idempotencyKey =
    input.idempotencyKey ??
    `reminder-${auth.userId}-${triggerAt.getTime()}-${randomUUID().slice(0, 8)}`;

  try {
    const [row] = await db
      .insert(reminders)
      .values({
        tenantId: auth.tenantId,
        ownerId: auth.userId,
        title: input.title,
        body: input.body,
        triggerAt,
        channel: input.channel,
        status: 'scheduled',
        payload: input.payload,
        idempotencyKey,
      })
      .returning();

    moduleLogger.info('owner-reminders: created', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      reminderId: row.id,
      channel: input.channel,
      triggerAt: triggerAt.toISOString(),
    });

    return c.json({ success: true, data: { reminder: row } }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // The UNIQUE(tenant_id, idempotency_key) collision returns a Postgres
    // 23505. Surface as 409 so the FE can retry with a fresh key.
    if (message.includes('reminders_idem_uniq') || message.includes('23505')) {
      return c.json(
        { success: false, error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Reminder already exists for this idempotency key' } },
        409,
      );
    }
    moduleLogger.error('owner-reminders: insert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      { success: false, error: { code: 'REMINDER_INSERT_FAILED', message } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET / — list reminders (owner-scoped via owner_id)
// ---------------------------------------------------------------------------

app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'REMINDERS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const parsed = listQuerySchema.safeParse({
    status: c.req.query('status'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', issues: parsed.error.issues } },
      400,
    );
  }
  const conditions = [
    eq(reminders.tenantId, auth.tenantId),
    eq(reminders.ownerId, auth.userId),
  ];
  if (parsed.data.status) {
    conditions.push(eq(reminders.status, parsed.data.status));
  }

  const rows = await db
    .select()
    .from(reminders)
    .where(and(...conditions))
    .orderBy(asc(reminders.triggerAt), desc(reminders.createdAt))
    .limit(parsed.data.limit);

  return c.json({ success: true, data: { reminders: rows, count: rows.length } });
});

// ---------------------------------------------------------------------------
// PATCH /:id — cancel or reschedule
// ---------------------------------------------------------------------------

app.patch('/:id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'REMINDERS_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid patch payload', issues: parsed.error.issues } },
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(reminders)
    .where(
      and(
        eq(reminders.tenantId, auth.tenantId),
        eq(reminders.ownerId, auth.userId),
        eq(reminders.id, id),
      ),
    )
    .limit(1);

  if (!existing) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Reminder not found' } }, 404);
  }
  if (existing.status !== 'scheduled') {
    return c.json(
      { success: false, error: { code: 'IMMUTABLE_STATUS', message: `Cannot patch a ${existing.status} reminder` } },
      409,
    );
  }

  const set: Record<string, unknown> = {};
  if (parsed.data.status === 'cancelled') {
    set.status = 'cancelled';
  }
  if (parsed.data.triggerAt !== undefined) {
    const next = new Date(parsed.data.triggerAt);
    if (next.getTime() <= Date.now()) {
      return c.json(
        { success: false, error: { code: 'TRIGGER_IN_PAST', message: 'triggerAt must be in the future' } },
        400,
      );
    }
    set.triggerAt = next;
  }

  const [row] = await db
    .update(reminders)
    .set(set)
    .where(
      and(
        eq(reminders.tenantId, auth.tenantId),
        eq(reminders.ownerId, auth.userId),
        eq(reminders.id, id),
      ),
    )
    .returning();

  moduleLogger.info('owner-reminders: patched', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    reminderId: id,
    set,
  });

  return c.json({ success: true, data: { reminder: row } });
});

export const ownerRemindersRouter = app;
export default ownerRemindersRouter;
