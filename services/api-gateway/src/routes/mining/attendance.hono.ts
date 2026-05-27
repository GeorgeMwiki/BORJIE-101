/**
 * /api/v1/mining/attendance — GPS-fenced check-in / check-out.
 *
 * Routes:
 *   GET  /                           paginated attendance history
 *   GET  /toolbox-topics             today's toolbox safety topics
 *   GET  /headcount?groupBy=site     per-site headcount for today
 *   POST /check-in                   employee opens shift
 *   POST /check-out                  employee closes shift
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { attendance, miningToolboxTalks } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  attendanceCheckInRoute,
  attendanceCheckOutRoute,
} from './_openapi/route-defs';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-attendance');

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(
  attendanceCheckInRoute,
  withSecurityEvents(
    {
      action: 'mining.attendance.check_in',
      resource: 'mining.attendance',
      severity: 'info',
    },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      if (!input.withinFence) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'OUTSIDE_FENCE',
              message: 'Outside permitted GPS fence',
            },
          },
          422,
        );
      }
      const [row] = await db
        .insert(attendance)
        .values({
          id: randomUUID(),
          tenantId,
          employeeId: input.employeeId,
          siteId: input.siteId,
          workDate: input.workDate,
          shiftKind: input.shiftKind,
          status: 'present',
          hoursWorked: null,
          signedOffByUserId: userId,
          signedOffAt: new Date(),
          signedOffFingerprintEventId: input.fingerprintEventId ?? null,
          notes: `check-in @ ${input.lat},${input.lon}`,
        })
        .returning();
      return c.json({ success: true as const, data: row }, 201);
    },
  ),
);

app.openapi(
  attendanceCheckOutRoute,
  withSecurityEvents(
    {
      action: 'mining.attendance.check_out',
      resource: 'mining.attendance',
      severity: 'info',
    },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const db = c.get('db');
      const input = c.req.valid('json');
      const [existing] = await db
        .select()
        .from(attendance)
        .where(
          and(
            eq(attendance.id, input.attendanceId),
            eq(attendance.tenantId, tenantId),
            isNull(attendance.hoursWorked),
          ),
        )
        .limit(1);
      if (!existing) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'NOT_FOUND',
              message: 'Open attendance record not found',
            },
          },
          404,
        );
      }
      const start = existing.signedOffAt
        ? new Date(existing.signedOffAt as unknown as string)
        : new Date();
      const now = new Date();
      const hours = Math.max(
        0,
        (now.getTime() - start.getTime()) / 3600_000,
      ).toFixed(2);
      const [row] = await db
        .update(attendance)
        .set({
          hoursWorked: hours,
          signedOffByUserId: userId,
          signedOffAt: now,
          signedOffFingerprintEventId:
            input.fingerprintEventId ?? existing.signedOffFingerprintEventId,
          notes:
            input.notes ?? `${existing.notes ?? ''} | check-out @ ${input.lat},${input.lon}`,
        })
        .where(
          and(
            eq(attendance.id, input.attendanceId),
            eq(attendance.tenantId, tenantId),
          ),
        )
        .returning();
      return c.json({ success: true as const, data: row }, 200);
    },
  ),
);

// ---------------------------------------------------------------------------
// GET / — paginated attendance history for the caller.
// ---------------------------------------------------------------------------

const ListAttendanceQuerySchema = z.object({
  employeeId: z.string().optional(),
  siteId: z.string().optional(),
  workDateFrom: z.string().optional(),
  workDateTo: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

app.get('/', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const rawQuery = {
    employeeId: c.req.query('employeeId'),
    siteId: c.req.query('siteId'),
    workDateFrom: c.req.query('workDateFrom'),
    workDateTo: c.req.query('workDateTo'),
    limit: c.req.query('limit'),
  };
  const parsed = ListAttendanceQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const limit = Math.min(parsed.data.limit ?? 100, 500);
  const employeeId = parsed.data.employeeId ?? userId;
  const conds = [
    eq(attendance.tenantId, tenantId),
    eq(attendance.employeeId, employeeId),
  ];
  if (parsed.data.siteId) {
    conds.push(eq(attendance.siteId, parsed.data.siteId));
  }
  if (parsed.data.workDateFrom) {
    conds.push(gte(attendance.workDate, parsed.data.workDateFrom));
  }
  const rows = await db
    .select()
    .from(attendance)
    .where(and(...conds))
    .orderBy(desc(attendance.workDate))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// GET /toolbox-topics — today's toolbox topics for caller's site.
// ---------------------------------------------------------------------------

app.get('/toolbox-topics', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  if (!db) {
    return c.json(
      { success: true as const, data: { items: [] as const } },
      200,
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  try {
    const conds = [
      eq(miningToolboxTalks.tenantId, tenantId),
      eq(miningToolboxTalks.scheduledFor, today),
    ];
    if (siteId) {
      conds.push(eq(miningToolboxTalks.siteId, siteId));
    }
    const rows = await db
      .select()
      .from(miningToolboxTalks)
      .where(and(...conds))
      .orderBy(desc(miningToolboxTalks.createdAt))
      .limit(100);
    return c.json(
      { success: true as const, data: { items: rows } },
      200,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      /relation\s+"?mining_toolbox_talks"?\s+does not exist/i.test(message) ||
      /no such table:?\s*mining_toolbox_talks/i.test(message)
    ) {
      moduleLogger.warn(
        { tenantId },
        'mining_toolbox_talks missing — returning empty toolbox topics',
      );
      return c.json(
        {
          success: true as const,
          data: {
            items: [] as const,
            note: 'awaiting B-WorkerTasks migration 0080',
          },
        },
        200,
      );
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /headcount?groupBy=site — per-site headcount for today.
// ---------------------------------------------------------------------------

const HeadcountQuerySchema = z.object({
  groupBy: z.enum(['site']).default('site'),
  workDate: z.string().optional(),
});

app.get('/headcount', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const rawQuery = {
    groupBy: c.req.query('groupBy') ?? 'site',
    workDate: c.req.query('workDate'),
  };
  const parsed = HeadcountQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      },
      400,
    );
  }
  if (!db) {
    return c.json(
      { success: true as const, data: { groupBy: 'site' as const, perSite: [] as const } },
      200,
    );
  }
  const workDate = parsed.data.workDate ?? new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      siteId: attendance.siteId,
      headcount: sql<number>`COUNT(DISTINCT ${attendance.employeeId})`,
    })
    .from(attendance)
    .where(
      and(
        eq(attendance.tenantId, tenantId),
        eq(attendance.workDate, workDate),
        eq(attendance.status, 'present'),
      ),
    )
    .groupBy(attendance.siteId);
  return c.json(
    {
      success: true as const,
      data: { groupBy: 'site' as const, workDate, perSite: rows },
    },
    200,
  );
});

export const miningAttendanceRouter = app;
