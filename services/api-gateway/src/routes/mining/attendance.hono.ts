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
import { attendance, employees, miningToolboxTalks } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  attendanceCheckInRoute,
  attendanceCheckOutRoute,
} from './_openapi/route-defs';
import { createLogger } from '../../utils/logger';
import { adaptCrewRoster, type CrewRosterRow } from './crew-roster';
import { adaptMyPerformance, adaptMyShift, type MyAttendanceRow } from './my-attendance';

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

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// GET /mine — the caller's current/last shift (employee HOME hero card).
//
// Replaces the dead GET /attendance/mine the mobile hook cast. Reads the
// caller's OWN latest attendance row (same employeeId=userId scope as GET /)
// and projects the AttendanceShift render contract via adaptMyShift — real
// state/timer only, never a fabricated running shift.
// ---------------------------------------------------------------------------
app.get('/mine', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const now = new Date();
  const today = dayKey(now);
  if (!db) {
    return c.json(
      { success: true as const, data: adaptMyShift(null, today, now) },
      200,
    );
  }
  const [row] = (await db
    .select({
      id: attendance.id,
      status: attendance.status,
      hoursWorked: attendance.hoursWorked,
      signedOffAt: attendance.signedOffAt,
      workDate: attendance.workDate,
    })
    .from(attendance)
    .where(
      and(
        eq(attendance.tenantId, tenantId),
        eq(attendance.employeeId, userId),
      ),
    )
    .orderBy(desc(attendance.workDate), desc(attendance.signedOffAt))
    .limit(1)) as ReadonlyArray<MyAttendanceRow>;
  return c.json(
    { success: true as const, data: adaptMyShift(row ?? null, today, now) },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /me/performance?range=7d — the caller's attendance-derived snapshot.
//
// Replaces the dead GET /attendance/me/performance the mobile hook cast.
// metricValue = REAL count of the caller's shifts in the window; deltaPct is
// driven by the prior window (0 when the baseline is empty — no fabricated
// trend). No streaks/charts (R2 worker-home anti-pattern).
// ---------------------------------------------------------------------------
const PerformanceQuerySchema = z.object({
  range: z
    .string()
    .regex(/^\d{1,3}d$/u)
    .default('7d')
    .optional(),
});

app.get('/me/performance', async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const parsed = PerformanceQuerySchema.safeParse({ range: c.req.query('range') });
  const rangeDays = parsed.success
    ? Number((parsed.data.range ?? '7d').replace('d', ''))
    : 7;
  if (!db) {
    return c.json(
      { success: true as const, data: adaptMyPerformance(0, rangeDays, null) },
      200,
    );
  }
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - rangeDays);
  const priorStart = new Date(now);
  priorStart.setDate(priorStart.getDate() - rangeDays * 2);

  async function countPresent(fromKey: string, toKeyExclusive: string): Promise<number> {
    const [agg] = (await db
      .select({ n: sql<number>`COUNT(*)::int` })
      .from(attendance)
      .where(
        and(
          eq(attendance.tenantId, tenantId),
          eq(attendance.employeeId, userId),
          eq(attendance.status, 'present'),
          gte(attendance.workDate, fromKey),
          sql`${attendance.workDate} < ${toKeyExclusive}`,
        ),
      )) as ReadonlyArray<{ n: number | string | null }>;
    return Number(agg?.n ?? 0);
  }

  // Exclusive upper bound = tomorrow, so a shift worked TODAY is counted in
  // the current window (a bound of `today` would silently drop today's shift).
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const shiftsInWindow = await countPresent(dayKey(windowStart), dayKey(tomorrow));
  const priorCount = await countPresent(dayKey(priorStart), dayKey(windowStart));
  return c.json(
    {
      success: true as const,
      data: adaptMyPerformance(shiftsInWindow, rangeDays, priorCount),
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// GET /crew-roster?siteId=<id> — the site's crew for the manager HOME band.
//
// Replaces the mobile CrewRoster's dead cast of GET /attendance (the caller's
// OWN history) to a `{ items: CrewMember[] }`. Returns the tenant's active
// employees (LEFT JOIN today's attendance for on-shift status), scoped to the
// requested site when supplied. workloadPct/equipmentPaired are honest-null
// (no source). Every row is tenant-fenced by RLS + explicit tenantId eq.
// ---------------------------------------------------------------------------
app.get('/crew-roster', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const siteId = c.req.query('siteId');
  if (!db) {
    return c.json({ success: true as const, data: { items: [] as const } }, 200);
  }
  const today = dayKey(new Date());
  const conds = [
    eq(employees.tenantId, tenantId),
    eq(employees.status, 'active'),
  ];
  if (siteId) {
    conds.push(eq(employees.siteId, siteId));
  }
  const rows = (await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      role: employees.role,
      attendanceStatus: sql<string | null>`(
        SELECT a.status FROM attendance a
        WHERE a.employee_id = ${employees.id}
          AND a.tenant_id = ${tenantId}
          AND a.work_date = ${today}
        ORDER BY a.signed_off_at DESC NULLS LAST
        LIMIT 1
      )`,
    })
    .from(employees)
    .where(and(...conds))
    .orderBy(employees.fullName)
    .limit(200)) as ReadonlyArray<CrewRosterRow>;
  return c.json(
    { success: true as const, data: { items: adaptCrewRoster(rows) } },
    200,
  );
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
        'mining_toolbox_talks missing — returning empty toolbox topics',
        { tenantId },
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
