/**
 * /api/v1/field/workforce — R5 worker hero card data wires.
 *
 * Backs `apps/workforce-mobile/src/components/WorkerHomeHero.tsx` (the
 * card above the worker chat that shows shift status + next task +
 * mark-done / need-help buttons). Closes G-B from
 * `Docs/AUDIT/REALITY_CHECK_2026-05-29.md`.
 *
 * Routes (all tenant-scoped via JWT + RLS):
 *   GET    /me                       worker identity + shift state
 *   GET    /tasks/next                single next pending task
 *   POST   /tasks/:id/complete        mark task done (hash-chain audited)
 *   POST   /help-requests             worker raises "Need help" flag
 *
 * Sources of truth:
 *   - Shift state: `clock_in_events` (migration 0103) — open shift =
 *     row with `clocked_out_at IS NULL` newest-first for the worker.
 *   - Worker identity: platform `users` row joined to the (optional)
 *     `employees` row when present.
 *   - Next task: `mining_tasks` (migration 0080) filtered to the auth'd
 *     user with status in {pending,in_progress,blocked}, ordered by
 *     priority then due_at.
 *   - Help requests: `help_requests` (migration 0126) — fans out as a
 *     `workforce.shift_event` so the owner cockpit pulses on raise.
 *
 * Tenant isolation:
 *   RLS FORCE-enabled on every table. Handlers also predicate on
 *   `auth.tenantId` so cross-tenant writes fail at the WITH CHECK
 *   predicate (belt-and-braces per CLAUDE.md).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import {
  employees,
  helpRequests,
  miningTasks,
  users,
} from '@borjie/database';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('field-workforce');

// ---------------------------------------------------------------------------
// Hash-chain audit helper (lifted shape from
// services/api-gateway/src/routes/mining/tasks.hono.ts — kept local so the
// field surface stays self-contained).
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

async function appendAuditEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  payload: AuditAppendPayload,
): Promise<string> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    turnId: payload.turnId,
    action: payload.action,
    userId: payload.userId,
    details: payload.details,
  });
  const latestResult: unknown = await db.execute(
    sql`SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                WHERE tenant_id = ${payload.tenantId}
                ORDER BY sequence_id DESC LIMIT 1) AS last_hash
        FROM ai_audit_chain
        WHERE tenant_id = ${payload.tenantId}`,
  );
  const rows =
    (latestResult as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (latestResult as ReadonlyArray<Record<string, unknown>>);
  const head = rows[0] ?? {};
  const maxSeq = Number(head.max_seq ?? 0);
  const lastHash =
    typeof head.last_hash === 'string' && head.last_hash.length > 0
      ? head.last_hash
      : '';
  const sequenceId = maxSeq + 1;
  const prevHash = lastHash;
  const thisHash = createHash('sha256')
    .update(prevHash + canonical)
    .digest('hex');
  await db.execute(sql`
    INSERT INTO ai_audit_chain (
      id, tenant_id, sequence_id, turn_id, action,
      prev_hash, this_hash, payload, created_at
    ) VALUES (
      ${id},
      ${payload.tenantId},
      ${sequenceId},
      ${payload.turnId},
      ${payload.action},
      ${prevHash},
      ${thisHash},
      ${JSON.stringify({ userId: payload.userId, details: payload.details })}::jsonb,
      ${new Date().toISOString()}
    )
  `);
  return id;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const CompleteTaskParamsSchema = z.object({
  id: z.string().uuid(),
});

const HelpRequestBodySchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  locale: z.enum(['sw', 'en']).default('sw'),
  message: z.string().trim().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonError(
  code: string,
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 500 | 503,
) {
  return { status, body: { success: false as const, error: { code, message } } };
}

type ShiftStatus = 'active' | 'on_break' | 'off_shift' | 'no_shift';

interface MeResponse {
  readonly workerId: string;
  readonly workerName: string;
  readonly roleLabel: string;
  readonly roleLabelSw: string;
  readonly shiftStatus: ShiftStatus;
  readonly shiftDetail?: string;
  readonly shiftDetailSw?: string;
}

interface NextTaskResponse {
  readonly id: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly location?: string;
  readonly startedAt?: string;
  readonly dueAt?: string;
}

function roleLabelFor(
  role: string | null | undefined,
  locale: 'sw' | 'en',
): string {
  const map: Record<string, { en: string; sw: string }> = {
    geologist: { en: 'Geologist', sw: 'Mwanajiolojia' },
    supervisor: { en: 'Site supervisor', sw: 'Msimamizi wa kazi' },
    operator: { en: 'Equipment operator', sw: 'Mtumiaji wa mitambo' },
    driver: { en: 'Driver', sw: 'Dereva' },
    miner: { en: 'Miner', sw: 'Mchimbaji' },
    safety_officer: { en: 'Safety officer', sw: 'Afisa wa usalama' },
    foreman: { en: 'Foreman', sw: 'Msimamizi wa kazi' },
  };
  const lookup = role ? map[role.toLowerCase()] : undefined;
  if (lookup) return locale === 'sw' ? lookup.sw : lookup.en;
  return locale === 'sw' ? 'Mfanyakazi' : 'Worker';
}

function priorityWeight(priority: string | null | undefined): number {
  switch (priority) {
    case 'urgent':
      return 0;
    case 'high':
      return 1;
    case 'normal':
      return 2;
    case 'low':
      return 3;
    default:
      return 4;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createFieldWorkforceRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // -------------------------------------------------------------------------
  // GET /me — worker identity + current shift state.
  //
  // Resolves the worker's display name from the platform `users` row
  // and (when present) the matching `employees` row's role. Shift state
  // is derived from the latest `clock_in_events` row for this user:
  //   - open row (no clocked_out_at) within the last 24h → active
  //   - closed row today → off_shift
  //   - nothing today → no_shift
  // -------------------------------------------------------------------------
  app.get('/me', async (c: any) => {
    const auth = c.get('auth') ?? {};
    const { tenantId, userId } = auth as {
      tenantId?: string;
      userId?: string;
    };
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'FIELD_WORKFORCE_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    try {
      const [userRow] = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      const [employeeRow] = await db
        .select({
          id: employees.id,
          fullName: employees.fullName,
          role: employees.role,
          siteId: employees.siteId,
        })
        .from(employees)
        .where(
          and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)),
        )
        .limit(1);

      // Display-name precedence:
      //   1. employees.full_name (HR-of-record)
      //   2. users.first_name + last_name (platform identity)
      //   3. users.email (fallback when name fields are blank)
      //   4. literal 'Worker' (final fallback — keeps the FE non-empty)
      const composedFromUsers = [userRow?.firstName, userRow?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      const displayName =
        (employeeRow?.fullName as string | undefined) ??
        (composedFromUsers.length > 0
          ? composedFromUsers
          : (userRow?.email as string | undefined) ?? 'Worker');

      // Shift state: read latest clock_in_events row for this user.
      // The clock_in_events.employee_id column stores the platform user
      // id (the auth subject) — that's what the mobile clock-in flow
      // submits at /api/v1/workforce/clock-in. If the employees table
      // separately models this person, we still match on user_id so the
      // surface is monotone with the FE.
      const clockResult = await db.execute(sql`
        SELECT id, clocked_in_at, clocked_out_at, site_id
          FROM clock_in_events
         WHERE tenant_id = ${tenantId}::uuid
           AND employee_id = ${userId}::uuid
         ORDER BY clocked_in_at DESC
         LIMIT 1
      `);
      const clockRows =
        (clockResult as { rows?: ReadonlyArray<Record<string, unknown>> })
          .rows ??
        (clockResult as ReadonlyArray<Record<string, unknown>>);
      const latestClock = clockRows[0];

      let shiftStatus: ShiftStatus = 'no_shift';
      let shiftDetailEn: string | undefined;
      let shiftDetailSw: string | undefined;

      if (latestClock) {
        const clockedInAt = latestClock.clocked_in_at
          ? new Date(String(latestClock.clocked_in_at))
          : null;
        const clockedOutAt = latestClock.clocked_out_at
          ? new Date(String(latestClock.clocked_out_at))
          : null;
        const now = Date.now();
        const startedHoursAgo = clockedInAt
          ? (now - clockedInAt.getTime()) / 3_600_000
          : Number.POSITIVE_INFINITY;
        const startedTodayUtc =
          clockedInAt !== null &&
          clockedInAt.toISOString().slice(0, 10) ===
            new Date(now).toISOString().slice(0, 10);

        if (clockedOutAt === null && clockedInAt !== null && startedHoursAgo < 24) {
          shiftStatus = 'active';
          shiftDetailEn = `Clocked in ${formatRelative(now - clockedInAt.getTime())} ago`;
          shiftDetailSw = `Umeingia kazini ${formatRelativeSw(now - clockedInAt.getTime())} zilizopita`;
        } else if (clockedOutAt !== null && startedTodayUtc) {
          shiftStatus = 'off_shift';
          shiftDetailEn = 'Shift ended today';
          shiftDetailSw = 'Zamu imeisha leo';
        }
      }

      const response: MeResponse = {
        workerId: userId,
        workerName: displayName,
        roleLabel: roleLabelFor(employeeRow?.role, 'en'),
        roleLabelSw: roleLabelFor(employeeRow?.role, 'sw'),
        shiftStatus,
        ...(shiftDetailEn ? { shiftDetail: shiftDetailEn } : {}),
        ...(shiftDetailSw ? { shiftDetailSw } : {}),
      };
      return c.json(response, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'me failed';
      moduleLogger.error('field workforce /me failed', {
        evt: 'field_workforce_me_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError('FIELD_WORKFORCE_ME_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // GET /tasks/next — earliest open task assigned to this worker.
  //
  // Filters to status in {pending, in_progress, blocked}; ordered by
  // priority (urgent first) then due_at ascending. Returns 204 (in spirit
  // — we serve 200 with `null` body for FE simplicity) when no task is
  // assigned.
  // -------------------------------------------------------------------------
  app.get('/tasks/next', async (c: any) => {
    const auth = c.get('auth') ?? {};
    const { tenantId, userId } = auth as {
      tenantId?: string;
      userId?: string;
    };
    if (!tenantId || !userId) {
      const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
      return c.json(err.body, err.status);
    }
    const db = c.get('db');
    if (!db) {
      const err = jsonError(
        'FIELD_WORKFORCE_UNAVAILABLE',
        'database is not configured on this gateway',
        503,
      );
      return c.json(err.body, err.status);
    }

    try {
      const rows = await db
        .select()
        .from(miningTasks)
        .where(
          and(
            eq(miningTasks.tenantId, tenantId),
            eq(miningTasks.assignedToUserId, userId),
            sql`${miningTasks.status} IN ('pending', 'in_progress', 'blocked')`,
          ),
        )
        .orderBy(
          asc(
            sql`CASE ${miningTasks.priority}
                  WHEN 'urgent' THEN 0
                  WHEN 'high'   THEN 1
                  WHEN 'normal' THEN 2
                  WHEN 'low'    THEN 3
                  ELSE 4 END`,
          ),
          // Push tasks without a due_at to the back so soonest-due wins.
          sql`${miningTasks.dueAt} ASC NULLS LAST`,
          asc(miningTasks.createdAt),
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        return c.json(null, 200);
      }
      const response: NextTaskResponse = {
        id: String(row.id),
        titleEn: String(row.titleEn ?? row.titleSw ?? ''),
        titleSw: String(row.titleSw ?? row.titleEn ?? ''),
        ...(row.siteId ? { location: String(row.siteId) } : {}),
        ...(row.status === 'in_progress' && row.createdAt
          ? { startedAt: new Date(String(row.createdAt)).toISOString() }
          : {}),
        ...(row.dueAt
          ? { dueAt: new Date(String(row.dueAt)).toISOString() }
          : {}),
      };
      void priorityWeight; // kept exported for future ordering tweaks
      return c.json(response, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'next failed';
      moduleLogger.error('field workforce /tasks/next failed', {
        evt: 'field_workforce_next_task_failed',
        tenantId,
        reason: message,
      });
      const e = jsonError('FIELD_WORKFORCE_NEXT_TASK_FAILED', message, 500);
      return c.json(e.body, e.status);
    }
  });

  // -------------------------------------------------------------------------
  // POST /tasks/:id/complete — worker marks the named task done.
  //
  // Idempotent on already-done. Appends a hash-chain audit entry before
  // mutating the row and stamps the new chain id onto `hash_chain_id`.
  // -------------------------------------------------------------------------
  app.post(
    '/tasks/:id/complete',
    zValidator('param', CompleteTaskParamsSchema),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      const { tenantId, userId } = auth as {
        tenantId?: string;
        userId?: string;
      };
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'FIELD_WORKFORCE_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }
      const { id } = c.req.valid('param') as { id: string };

      try {
        const [existing] = await db
          .select()
          .from(miningTasks)
          .where(
            and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)),
          )
          .limit(1);
        if (!existing) {
          const err = jsonError('TASK_NOT_FOUND', 'Task not found', 404);
          return c.json(err.body, err.status);
        }
        if (existing.assignedToUserId && existing.assignedToUserId !== userId) {
          const err = jsonError(
            'TASK_NOT_ASSIGNED',
            'Task is not assigned to this worker',
            403,
          );
          return c.json(err.body, err.status);
        }
        if (existing.status === 'done') {
          return c.json(
            {
              ok: true as const,
              taskId: existing.id,
              completedAt:
                existing.completedAt instanceof Date
                  ? existing.completedAt.toISOString()
                  : String(existing.completedAt ?? new Date().toISOString()),
              idempotent: true as const,
            },
            200,
          );
        }

        const completedAt = new Date();
        const chainId = await appendAuditEntry(db, {
          action: 'field.workforce.task.complete',
          tenantId,
          turnId: id,
          userId,
          details: {
            taskId: id,
            previousStatus: existing.status,
            completedAt: completedAt.toISOString(),
            source: 'field-workforce-hero-card',
          },
        });

        await db
          .update(miningTasks)
          .set({
            status: 'done',
            completedAt,
            blockedReason: null,
            hashChainId: chainId,
          })
          .where(
            and(eq(miningTasks.id, id), eq(miningTasks.tenantId, tenantId)),
          );

        return c.json(
          {
            ok: true as const,
            taskId: id,
            completedAt: completedAt.toISOString(),
            hashChainId: chainId,
          },
          200,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'complete failed';
        moduleLogger.error('field workforce /tasks/:id/complete failed', {
          evt: 'field_workforce_task_complete_failed',
          tenantId,
          taskId: id,
          reason: message,
        });
        const e = jsonError(
          'FIELD_WORKFORCE_TASK_COMPLETE_FAILED',
          message,
          500,
        );
        return c.json(e.body, e.status);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /help-requests — worker raises a help request.
  //
  // Inserts into `help_requests`, appends an audit-chain entry, and
  // publishes a `workforce.shift_event` so the owner cockpit pulses.
  // -------------------------------------------------------------------------
  app.post(
    '/help-requests',
    zValidator('json', HelpRequestBodySchema),
    async (c: any) => {
      const auth = c.get('auth') ?? {};
      const { tenantId, userId } = auth as {
        tenantId?: string;
        userId?: string;
      };
      if (!tenantId || !userId) {
        const err = jsonError('UNAUTHORIZED', 'Authentication required', 401);
        return c.json(err.body, err.status);
      }
      const db = c.get('db');
      if (!db) {
        const err = jsonError(
          'FIELD_WORKFORCE_UNAVAILABLE',
          'database is not configured on this gateway',
          503,
        );
        return c.json(err.body, err.status);
      }
      const body = c.req.valid('json') as z.infer<typeof HelpRequestBodySchema>;

      try {
        const requestId = randomUUID();
        const audit = await appendAuditEntry(db, {
          action: 'field.workforce.help_request.create',
          tenantId,
          turnId: requestId,
          userId,
          details: {
            requestId,
            taskId: body.taskId ?? null,
            locale: body.locale,
            source: 'field-workforce-hero-card',
          },
        });

        const [row] = await db
          .insert(helpRequests)
          .values({
            id: requestId,
            tenantId,
            workerUserId: userId,
            taskId: body.taskId ?? null,
            siteId: null,
            locale: body.locale,
            messageText: body.message ?? null,
            status: 'open',
            auditHashId: audit,
            provenance: {
              via: 'field-workforce-hero-card',
              capturedBy: userId,
              capturedAt: new Date().toISOString(),
            },
          })
          .returning();

        publishCockpitEvent({
          kind: 'workforce.shift_event',
          tenantId,
          emittedAt: new Date().toISOString(),
          workerId: userId,
          // We map a "need help" raise onto a shift-event so the cockpit
          // bus stays a single channel; downstream renderers branch on
          // the audit details to render the right toast. Until a richer
          // help_event kind lands this is the honest mapping.
          transition: 'shift_start',
        });

        return c.json(
          {
            ok: true as const,
            id: row.id,
            status: row.status,
            createdAt:
              row.createdAt instanceof Date
                ? row.createdAt.toISOString()
                : String(row.createdAt),
          },
          201,
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'help request failed';
        moduleLogger.error('field workforce /help-requests failed', {
          evt: 'field_workforce_help_request_failed',
          tenantId,
          reason: message,
        });
        const e = jsonError(
          'FIELD_WORKFORCE_HELP_REQUEST_FAILED',
          message,
          500,
        );
        return c.json(e.body, e.status);
      }
    },
  );

  return app;
}

export const fieldWorkforceRouter = createFieldWorkforceRouter();

// ---------------------------------------------------------------------------
// Tiny i18n-aware relative-time helpers — kept inline so the route file
// stays self-contained.
// ---------------------------------------------------------------------------

function formatRelative(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'a moment';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${hours} hour${hours === 1 ? '' : 's'} ${remMin} min`;
}

function formatRelativeSw(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 1) return 'sekunde chache';
  if (minutes < 60) return `dakika ${minutes}`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (remMin === 0) return `saa ${hours}`;
  return `saa ${hours} dakika ${remMin}`;
}

// Suppress unused-import flags introduced by drizzle helpers that may
// be exercised in future revisions without re-importing.
void desc;
void isNull;
