/**
 * /api/v1/mining/payslip — worker-facing payslip read (WS-3 workforce wires).
 *
 * The owner payroll surface (routes/owner/payroll.hono.ts) is owner/admin-gated
 * and exposes the WHOLE run. A worker must only ever see THEIR OWN committed
 * line item, so this route is the worker-scoped read seam over the SAME real
 * data (`payroll_line_items`): it returns the signed-in worker's most recent
 * COMMITTED / POSTED / PAID line item, never a draft or preview, and never
 * anyone else's row.
 *
 * Routes:
 *   GET /me            most recent committed line item for the signed-in worker
 *
 * Tenant isolation: RLS FORCE on `payroll_runs` + `payroll_line_items`
 * (migration 0134). databaseMiddleware binds `app.current_tenant_id`. We
 * additionally predicate on `worker_user_id = auth.userId` so a worker can
 * never read a colleague's slip within the same tenant.
 *
 * Bilingual: the response carries the shared `PAYSLIP_FIELD_LABELS` (sw + en)
 * from the payroll calculator so the mobile screen renders without re-declaring
 * labels. Money fields carry NO currency symbol — the FE renders them via
 * `formatCurrency(amount, currencyCode)` (multi-currency hard rule).
 */

import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { payrollLineItems, payrollRuns } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import {
  PAYSLIP_FIELD_LABELS,
  payslipLabel,
} from '../../services/payroll/calculator';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('worker-payslip');

/** Run statuses whose line items represent committed (real) pay. */
const COMMITTED_RUN_STATUSES = ['committed', 'paid'] as const;

export function createWorkerPayslipRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // ----------------------------------------------------------------
  // GET /me — most recent committed line item for the signed-in worker
  // ----------------------------------------------------------------
  app.get('/me', async (c: any) => {
    const auth = c.get('auth');
    if (!auth?.userId || !auth?.tenantId) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYSLIP_UNAVAILABLE' } },
        503,
      );
    }

    try {
      // Committed/paid runs for this tenant, newest first. RLS already
      // constrains to the tenant; we order so the latest period wins.
      const committedRuns = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, auth.tenantId),
            inArray(payrollRuns.status, [...COMMITTED_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(payrollRuns.periodEnd), desc(payrollRuns.committedAt));

      if (committedRuns.length === 0) {
        return c.json({ success: true, data: null }, 200);
      }

      // Walk runs newest-first; return the first one that has a line item
      // for THIS worker. A worker may not appear in every run.
      for (const run of committedRuns) {
        const [item] = await db
          .select()
          .from(payrollLineItems)
          .where(
            and(
              eq(payrollLineItems.tenantId, auth.tenantId),
              eq(payrollLineItems.payrollRunId, run.id),
              eq(payrollLineItems.workerUserId, auth.userId),
            ),
          )
          .limit(1);
        if (!item) continue;

        return c.json(
          {
            success: true,
            data: {
              period: { start: run.periodStart, end: run.periodEnd },
              runStatus: run.status,
              lineItem: {
                hoursWorked: Number(item.hoursWorked),
                overtimeHours: Number(item.overtimeHours),
                hourlyRateTzs: Number(item.hourlyRateTzs),
                baseTzs: Number(item.baseTzs),
                overtimeTzs: Number(item.overtimeTzs),
                bonusTzs: Number(item.bonusTzs),
                deductionTzs: Number(item.deductionTzs),
                netTzs: Number(item.netTzs),
                status: item.status,
              },
              // currency the figures are denominated in — TZS-primary at
              // launch; the FE renders via formatCurrency(amount, currencyCode).
              currencyCode: 'TZS',
              labels: PAYSLIP_FIELD_LABELS,
              netLabel: payslipLabel(Number(item.netTzs)),
            },
          },
          200,
        );
      }

      // Committed runs exist but none include this worker.
      return c.json({ success: true, data: null }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'payslip fetch failed';
      moduleLogger.error('worker payslip fetch failed', {
        evt: 'worker_payslip_fetch_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        { success: false, error: { code: 'PAYSLIP_FETCH_FAILED', message } },
        500,
      );
    }
  });

  return app;
}

export const miningPayslipRouter = createWorkerPayslipRouter();
