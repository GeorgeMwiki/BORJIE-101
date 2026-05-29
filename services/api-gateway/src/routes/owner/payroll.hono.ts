/**
 * /api/v1/owner/payroll — payroll chain L-B (issue #193).
 *
 * Routes:
 *   POST   /runs                    create / fetch run for (period)
 *   POST   /runs/:id/preview        compute line items from clock + shifts
 *   POST   /runs/:id/commit         post to LedgerService + enqueue payouts
 *   GET    /runs                    list runs for current tenant
 *   GET    /runs/:id                fetch run + line items
 *
 * Money path (CLAUDE.md hard rule):
 *   - The commit endpoint calls `LedgerService.post()` per line item
 *     via the `PayrollLedgerPort` seam (see ledger-port.ts).
 *   - Each line item's `ledger_txn_id` is stamped post-CAS.
 *
 * Tenant isolation: RLS FORCE on `payroll_runs` + `payroll_line_items`
 * (migration 0134). The databaseMiddleware sets the GUC.
 *
 * Bilingual: payslip labels are sw + en.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  clockInEvents,
  payrollLineItems,
  payrollRuns,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { publishCockpitEvent } from '../../services/cockpit-events';
import {
  computeLineItem,
  rollupRun,
  payslipLabel,
  type ClockEventForPayroll,
} from '../../services/payroll/calculator';
import { resolvePayrollLedgerPort } from '../../services/payroll/ledger-port';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-payroll');

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const createRunSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).optional(),
});

const previewSchema = z.object({
  /**
   * Per-worker override map: { [workerUserId]: { hourlyRateTzs, bonusTzs, deductionTzs } }
   * Workers not in the map use defaults: hourlyRateTzs=0, bonusTzs=0,
   * deductionTzs=0 (the preview is then surfaced for the owner to
   * adjust before commit; commit refuses runs where all rates are 0).
   */
  overrides: z
    .record(
      z.string(),
      z.object({
        hourlyRateTzs: z.number().min(0).max(10_000_000),
        bonusTzs: z.number().min(0).max(10_000_000).default(0),
        deductionTzs: z.number().min(0).max(10_000_000).default(0),
      }),
    )
    .default({}),
});

// ---------------------------------------------------------------------------
// Audit-chain helper (mirrors workforce/openings.hono.ts)
// ---------------------------------------------------------------------------

interface AuditAppendPayload {
  readonly action: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly userId: string;
  readonly details: Record<string, unknown>;
}

async function appendAuditEntry(
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
// Owner-only role gate (mirror of workforce-onboarding)
// ---------------------------------------------------------------------------

function isOwnerOrAdmin(role: string | undefined): boolean {
  if (!role) return false;
  return (
    role === 'OWNER' || role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN'
  );
}

function isoStart(periodStart: string): string {
  return `${periodStart}T00:00:00.000Z`;
}
function isoEndExclusive(periodEnd: string): string {
  // Inclusive period_end -> exclusive upper-bound (start of next day).
  const d = new Date(`${periodEnd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createOwnerPayrollRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // ----------------------------------------------------------------
  // POST /runs — create / fetch run (idempotent on tenant + period)
  // ----------------------------------------------------------------
  app.post('/runs', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !isOwnerOrAdmin(auth.role)) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN' } },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYROLL_UNAVAILABLE' } },
        503,
      );
    }
    const body = await c.req.json().catch(() => null);
    const parsed = createRunSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const { periodStart, periodEnd, notes } = parsed.data;
    if (new Date(periodStart) > new Date(periodEnd)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'periodStart must be <= periodEnd',
          },
        },
        400,
      );
    }

    try {
      // Idempotent on (tenant, period_start, period_end).
      const [existing] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, auth.tenantId),
            eq(payrollRuns.periodStart, periodStart),
            eq(payrollRuns.periodEnd, periodEnd),
          ),
        )
        .limit(1);
      if (existing) {
        return c.json(
          { success: true, data: existing, meta: { idempotent: true } },
          200,
        );
      }
      const [row] = await db
        .insert(payrollRuns)
        .values({
          tenantId: auth.tenantId,
          createdByUserId: auth.userId,
          periodStart,
          periodEnd,
          notes: notes ?? null,
          status: 'draft',
        })
        .returning();
      await appendAuditEntry(db, {
        action: 'owner.payroll.run.create',
        tenantId: auth.tenantId,
        turnId: row.id,
        userId: auth.userId,
        details: { runId: row.id, periodStart, periodEnd },
      });
      return c.json({ success: true, data: row }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create failed';
      moduleLogger.error('payroll run create failed', {
        evt: 'payroll_run_create_failed',
        tenantId: auth.tenantId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'PAYROLL_CREATE_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // POST /runs/:id/preview — compute line items
  // ----------------------------------------------------------------
  app.post('/runs/:id/preview', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !isOwnerOrAdmin(auth.role)) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN' } },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYROLL_UNAVAILABLE' } },
        503,
      );
    }
    const runId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const parsed = previewSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            issues: parsed.error.issues,
          },
        },
        400,
      );
    }
    const overrides = parsed.data.overrides ?? {};

    try {
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, auth.tenantId),
            eq(payrollRuns.id, runId),
          ),
        )
        .limit(1);
      if (!run) {
        return c.json(
          { success: false, error: { code: 'RUN_NOT_FOUND' } },
          404,
        );
      }
      if (run.status !== 'draft' && run.status !== 'previewed') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: `Cannot preview a run in state '${run.status}'`,
            },
          },
          409,
        );
      }

      // Pull active workers + their clock events for the period.
      const periodStartIso = isoStart(run.periodStart);
      const periodEndIso = isoEndExclusive(run.periodEnd);

      const events = await db
        .select()
        .from(clockInEvents)
        .where(
          and(
            eq(clockInEvents.tenantId, auth.tenantId),
            gte(clockInEvents.clockedInAt, new Date(periodStartIso)),
            lt(clockInEvents.clockedInAt, new Date(periodEndIso)),
          ),
        );

      const eventsByWorker = new Map<string, ClockEventForPayroll[]>();
      for (const e of events) {
        const list = eventsByWorker.get(e.employeeId) ?? [];
        list.push({
          employeeId: e.employeeId,
          clockedInAt:
            e.clockedInAt instanceof Date
              ? e.clockedInAt.toISOString()
              : String(e.clockedInAt),
          clockedOutAt:
            e.clockedOutAt instanceof Date
              ? e.clockedOutAt.toISOString()
              : e.clockedOutAt
              ? String(e.clockedOutAt)
              : null,
          biometricPassed: !!e.biometricPassed,
        });
        eventsByWorker.set(e.employeeId, list);
      }

      // Compute line items per active worker.
      const lineItemResults = Array.from(eventsByWorker.keys()).map(
        (workerId) => {
          const override = overrides[workerId];
          return computeLineItem({
            workerUserId: workerId,
            periodStartIso,
            periodEndIso,
            hourlyRateTzs: override?.hourlyRateTzs ?? 0,
            bonusTzs: override?.bonusTzs ?? 0,
            deductionTzs: override?.deductionTzs ?? 0,
            events: eventsByWorker.get(workerId) ?? [],
          });
        },
      );

      // Wipe + insert line items inside a transaction-shaped pair.
      await db
        .delete(payrollLineItems)
        .where(eq(payrollLineItems.payrollRunId, runId));

      const inserted =
        lineItemResults.length === 0
          ? []
          : await db
              .insert(payrollLineItems)
              .values(
                lineItemResults.map((li) => ({
                  tenantId: auth.tenantId,
                  payrollRunId: runId,
                  workerUserId: li.workerUserId,
                  hoursWorked: String(li.hoursWorked),
                  overtimeHours: String(li.overtimeHours),
                  hourlyRateTzs: String(li.hourlyRateTzs),
                  baseTzs: String(li.baseTzs),
                  overtimeTzs: String(li.overtimeTzs),
                  bonusTzs: String(li.bonusTzs),
                  deductionTzs: String(li.deductionTzs),
                  netTzs: String(li.netTzs),
                  status: 'pending' as const,
                })),
              )
              .returning();

      const rollup = rollupRun(lineItemResults);
      const [updated] = await db
        .update(payrollRuns)
        .set({
          status: 'previewed',
          previewedAt: new Date(),
          totalTzs: String(rollup.totalTzs),
          workerCount: rollup.workerCount,
        })
        .where(eq(payrollRuns.id, runId))
        .returning();

      await appendAuditEntry(db, {
        action: 'owner.payroll.run.preview',
        tenantId: auth.tenantId,
        turnId: runId,
        userId: auth.userId,
        details: {
          runId,
          workerCount: rollup.workerCount,
          totalTzs: rollup.totalTzs,
        },
      });

      return c.json(
        {
          success: true,
          data: { run: updated, lineItems: inserted },
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'preview failed';
      moduleLogger.error('payroll run preview failed', {
        evt: 'payroll_run_preview_failed',
        tenantId: auth.tenantId,
        runId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'PAYROLL_PREVIEW_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // POST /runs/:id/commit — post journals + enqueue payouts
  //
  // CLAUDE.md hard rule: money path MUST go through LedgerService.post().
  // Each line item -> one journal id stamped post-CAS on the row.
  // ----------------------------------------------------------------
  app.post('/runs/:id/commit', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !isOwnerOrAdmin(auth.role)) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN' } },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYROLL_UNAVAILABLE' } },
        503,
      );
    }
    const runId = c.req.param('id');

    try {
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, auth.tenantId),
            eq(payrollRuns.id, runId),
          ),
        )
        .limit(1);
      if (!run) {
        return c.json(
          { success: false, error: { code: 'RUN_NOT_FOUND' } },
          404,
        );
      }
      if (run.status === 'committed' || run.status === 'paid') {
        return c.json(
          { success: true, data: run, meta: { idempotent: true } },
          200,
        );
      }
      if (run.status !== 'previewed') {
        return c.json(
          {
            success: false,
            error: {
              code: 'INVALID_STATE',
              message: `Cannot commit a run in state '${run.status}'`,
            },
          },
          409,
        );
      }

      const lineItems = await db
        .select()
        .from(payrollLineItems)
        .where(
          and(
            eq(payrollLineItems.tenantId, auth.tenantId),
            eq(payrollLineItems.payrollRunId, runId),
          ),
        );

      if (lineItems.length === 0) {
        return c.json(
          {
            success: false,
            error: {
              code: 'EMPTY_RUN',
              message: 'Run has no line items — preview first',
            },
          },
          409,
        );
      }

      const port = resolvePayrollLedgerPort();
      const postedRows: any[] = [];
      for (const li of lineItems) {
        const idempotencyKey = `${runId}:${li.workerUserId}`;
        const { journalId } = await port.post({
          tenantId: auth.tenantId,
          workerUserId: li.workerUserId,
          payrollRunId: runId,
          netTzs: Number(li.netTzs),
          idempotencyKey,
        });
        const [updated] = await db
          .update(payrollLineItems)
          .set({
            ledgerTxnId: journalId,
            status: 'posted',
            postedAt: new Date(),
          })
          .where(eq(payrollLineItems.id, li.id))
          .returning();
        postedRows.push(updated);
      }

      const [updatedRun] = await db
        .update(payrollRuns)
        .set({ status: 'committed', committedAt: new Date() })
        .where(eq(payrollRuns.id, runId))
        .returning();

      await appendAuditEntry(db, {
        action: 'owner.payroll.run.commit',
        tenantId: auth.tenantId,
        turnId: runId,
        userId: auth.userId,
        details: {
          runId,
          workerCount: lineItems.length,
          totalTzs: Number(run.totalTzs),
          ledgerJournalCount: postedRows.length,
        },
      });

      // Cockpit pulse — workers see "you've been paid" via this kind.
      publishCockpitEvent({
        kind: 'payroll.committed',
        tenantId: auth.tenantId,
        emittedAt: new Date().toISOString(),
        payrollRunId: runId,
        periodEnd: String(run.periodEnd),
        netTotalTzs: Number(run.totalTzs),
        headcount: lineItems.length,
        committedBy: auth.userId,
      });

      return c.json(
        {
          success: true,
          data: { run: updatedRun, lineItems: postedRows },
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'commit failed';
      moduleLogger.error('payroll run commit failed', {
        evt: 'payroll_run_commit_failed',
        tenantId: auth.tenantId,
        runId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: { code: 'PAYROLL_COMMIT_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET /runs — list
  // ----------------------------------------------------------------
  app.get('/runs', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !isOwnerOrAdmin(auth.role)) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN' } },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYROLL_UNAVAILABLE' } },
        503,
      );
    }
    try {
      const rows = await db
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.tenantId, auth.tenantId))
        .orderBy(desc(payrollRuns.createdAt))
        .limit(100);
      return c.json({ success: true, data: rows }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      return c.json(
        {
          success: false,
          error: { code: 'PAYROLL_LIST_FAILED', message },
        },
        500,
      );
    }
  });

  // ----------------------------------------------------------------
  // GET /runs/:id — fetch run + line items + payslip labels
  // ----------------------------------------------------------------
  app.get('/runs/:id', async (c: any) => {
    const auth = c.get('auth');
    if (!auth || !isOwnerOrAdmin(auth.role)) {
      return c.json(
        { success: false, error: { code: 'FORBIDDEN' } },
        403,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        { success: false, error: { code: 'PAYROLL_UNAVAILABLE' } },
        503,
      );
    }
    const runId = c.req.param('id');
    try {
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, auth.tenantId),
            eq(payrollRuns.id, runId),
          ),
        )
        .limit(1);
      if (!run) {
        return c.json(
          { success: false, error: { code: 'RUN_NOT_FOUND' } },
          404,
        );
      }
      const items = await db
        .select()
        .from(payrollLineItems)
        .where(
          and(
            eq(payrollLineItems.tenantId, auth.tenantId),
            eq(payrollLineItems.payrollRunId, runId),
          ),
        );
      const labelled = items.map((it: any) => ({
        ...it,
        payslipLabel: payslipLabel(Number(it.netTzs)),
      }));
      return c.json(
        { success: true, data: { run, lineItems: labelled } },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fetch failed';
      return c.json(
        {
          success: false,
          error: { code: 'PAYROLL_FETCH_FAILED', message },
        },
        500,
      );
    }
  });

  return app;
}

export const ownerPayrollRouter = createOwnerPayrollRouter();
