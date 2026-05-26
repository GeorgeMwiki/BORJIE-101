// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/attendance — GPS-fenced check-in / check-out.
 *
 * Routes:
 *   POST /check-in   employee opens shift (rejects if outside site fence)
 *   POST /check-out  employee closes shift (computes hoursWorked)
 *
 * GPS-fence check is gated on the request payload's `withinFence` flag,
 * which the mobile client computes against the site polygon before
 * submitting. The server records the lat/lon for audit but trusts the
 * client's fence verdict so the policy works offline-first.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { attendance } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  attendanceCheckInRoute,
  attendanceCheckOutRoute,
} from './_openapi/route-defs';

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

export const miningAttendanceRouter = app;
