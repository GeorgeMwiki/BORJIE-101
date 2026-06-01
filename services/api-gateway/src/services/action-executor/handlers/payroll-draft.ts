/**
 * draft_payroll_run — a CONFIRM-REQUIRED *DRAFT* verb (money-adjacent, but
 * NEVER a money move).
 *
 * ─── WHY THIS IS NOT A MONEY VERB (CLAUDE.md hard rule) ─────────────────
 * The money path MUST go through `LedgerService.post()`. The AI must NEVER
 * move money. This verb does NOT. It creates ONLY the `payroll_runs`
 * *header* row in its initial `status='draft'` state — the exact same row,
 * in the exact same state, that the canonical owner route
 * (`routes/owner/payroll.hono.ts` → `POST /runs`) creates for a human.
 *
 * Per the `payroll_runs` state machine (payroll-runs.schema.ts):
 *     draft  ──preview──▶ previewed ──COMMIT──▶ committed  ──▶ paid/failed
 *                                       ▲
 *                                       └─ this is the ONLY edge that calls
 *                                          LedgerService.post() and writes
 *                                          wage money. It happens on a
 *                                          SEPARATE owner-approved endpoint,
 *                                          never here.
 *
 * A `draft` run is a non-binding pointer the owner approves elsewhere
 * (four-eye discipline): the owner reviews it, runs `preview` to compute
 * line items, and only an explicit `commit` posts to the ledger. THIS
 * handler stops at `draft` and writes ZERO wage figures.
 *
 * Money columns LEFT AT THEIR DB DEFAULTS (never written from chat):
 *   - `total_tzs`    → DB default '0' (NOT in the INSERT column list here).
 *   - `worker_count` → DB default 0   (NOT in the INSERT column list here).
 *   - payroll_line_items (every `*_tzs` wage column) → NO line items are
 *     created here AT ALL; they are computed later by the `preview` step.
 *   - `ledger_txn_id` → only ever stamped by the commit step post-CAS.
 * We import NO LedgerService and write NO ledger / journal row.
 *
 * ─── WHY RAW PARAMETERIZED SQL (not the Drizzle table object) ───────────
 * The `payrollRuns` Drizzle table is defined in
 * `packages/database/src/schemas/payroll-runs.schema.ts` but that file is
 * NOT re-exported from the `@borjie/database` barrel (`schemas/index.ts`),
 * so `import { payrollRuns } from '@borjie/database'` resolves to
 * `undefined` (a pre-existing packaging gap, OUT OF SCOPE for this wave —
 * we may only edit the action-executor + the chat-actions route). To stay
 * in scope AND avoid a cross-package deep import that breaks the modular-
 * monolith import discipline, we write the draft via a single PARAMETERIZED
 * `sql` INSERT — exactly the mechanism the sibling `audit.ts` already uses
 * for `ai_audit_chain`. Parameter binding (never string interpolation)
 * keeps it injection-safe.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * Param shape `{ period, siteId? }`:
 *   - `period`  → a `YYYY-MM` month. We derive the NOT-NULL `period_start`
 *                 (first day) and `period_end` (last day) from it, matching
 *                 how an owner would scope a monthly run. (Explicit
 *                 `periodStart`/`periodEnd` are also accepted for parity
 *                 with the owner route.)
 *   - `siteId`  → optional. `payroll_runs` has NO site_id column, so we do
 *                 NOT invent one; when supplied we VERIFY it belongs to the
 *                 tenant (graceful FK-not-found) and record it in `notes`
 *                 provenance so the owner sees which site the draft targets.
 *
 * Idempotency: mirrors the owner route — `payroll_runs` is unique-by-intent
 * on (tenant, period_start, period_end); if a run already exists for the
 * period we return it (no duplicate draft) rather than inserting twice.
 *
 * RLS FORCE: the `/confirm-action` databaseMiddleware binds
 * `app.current_tenant_id`, so the WITH CHECK policy clips the insert to the
 * caller's tenant. We ALSO bind `tenant_id = ctx.tenantId` in every
 * statement (belt-and-braces, matching the sibling handlers).
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { appendExecAudit } from '../audit.js';
import type { ActionHandler, ExecContext, ExecResult } from '../types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

const draftPayrollRunSchema = z
  .object({
    /** A YYYY-MM month; period_start/period_end are derived from it. */
    period: z
      .string()
      .trim()
      .regex(ISO_MONTH, 'period must be a YYYY-MM month')
      .optional(),
    /** Explicit bounds (parity with the owner route); both required together. */
    periodStart: z
      .string()
      .trim()
      .regex(ISO_DATE, 'periodStart must be an ISO date (YYYY-MM-DD)')
      .optional(),
    periodEnd: z
      .string()
      .trim()
      .regex(ISO_DATE, 'periodEnd must be an ISO date (YYYY-MM-DD)')
      .optional(),
    /** Optional site the draft targets — verified, stored in notes only. */
    siteId: z.string().trim().min(1).max(80).optional(),
  })
  .refine(
    (d) => Boolean(d.period) || (Boolean(d.periodStart) && Boolean(d.periodEnd)),
    {
      message: 'provide a `period` (YYYY-MM) or both periodStart + periodEnd',
      path: ['period'],
    },
  );

type DraftPayrollRunInput = z.infer<typeof draftPayrollRunSchema>;

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD (UTC-safe). */
function lastDayOfMonth(year: number, month1to12: number): string {
  // Day 0 of the *next* month is the last day of this month.
  const d = new Date(Date.UTC(year, month1to12, 0));
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolve the run's `period_start` / `period_end` (both NOT NULL `date`).
 * From an explicit pair when given, else derived from the YYYY-MM month.
 * Throws a precise error when the bounds are inverted so the dispatcher
 * surfaces a clear `reason`.
 */
function resolvePeriod(input: DraftPayrollRunInput): {
  periodStart: string;
  periodEnd: string;
} {
  let periodStart: string;
  let periodEnd: string;
  if (input.periodStart && input.periodEnd) {
    periodStart = input.periodStart;
    periodEnd = input.periodEnd;
  } else {
    // `period` is guaranteed present here by the schema refine.
    const [yearStr, monthStr] = (input.period as string).split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (month < 1 || month > 12) {
      throw new Error('draft_payroll_run_invalid_month');
    }
    periodStart = `${yearStr}-${monthStr}-01`;
    periodEnd = lastDayOfMonth(year, month);
  }
  if (new Date(periodStart).getTime() > new Date(periodEnd).getTime()) {
    throw new Error('draft_payroll_run_period_inverted');
  }
  return { periodStart, periodEnd };
}

/** Coerce a raw db.execute result into a rows array (pg vs array shim). */
function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  const rows =
    (result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ??
    (result as ReadonlyArray<Record<string, unknown>>);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Verify an optional target site belongs to the tenant. Returns the id or
 * null. Throws when an explicit site does not belong to the tenant so the
 * dispatcher surfaces a clear `reason` instead of silently dropping it.
 *
 * Parameterized SQL (never interpolated) — injection-safe.
 */
async function resolveSiteId(
  ctx: ExecContext,
  explicit: string | undefined,
): Promise<string | null> {
  if (!explicit) return null;
  const result = await ctx.db.execute(sql`
    SELECT id FROM sites
     WHERE tenant_id = ${ctx.tenantId} AND id = ${explicit}
     LIMIT 1
  `);
  const row = rowsOf(result)[0];
  if (!row) {
    throw new Error(`draft_payroll_run_site_not_found:${explicit}`);
  }
  return String(row.id);
}

export const draftPayrollRunHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = draftPayrollRunSchema.parse(rawInput);
  const { periodStart, periodEnd } = resolvePeriod(input);
  const siteId = await resolveSiteId(ctx, input.siteId);

  // Idempotent on (tenant, period) — mirror the owner route so a repeated
  // chat draft for the same month returns the existing draft, never a dup.
  const existingResult = await ctx.db.execute(sql`
    SELECT id, status FROM payroll_runs
     WHERE tenant_id = ${ctx.tenantId}
       AND period_start = ${periodStart}
       AND period_end = ${periodEnd}
     LIMIT 1
  `);
  const existing = rowsOf(existingResult)[0];
  if (existing) {
    return {
      kind: 'payroll_run_draft',
      id: String(existing.id),
      summary: `Payroll draft for ${periodStart} already exists (status: ${String(
        existing.status,
      )})`,
      data: {
        payrollRunId: String(existing.id),
        periodStart,
        periodEnd,
        status: String(existing.status),
        idempotent: true,
        ...(siteId ? { siteId } : {}),
      },
    };
  }

  // `notes` is a free-text column — we record chat provenance + the
  // verified target site here (there is NO site_id column, and NO money is
  // written). `total_tzs` (default '0') and `worker_count` (default 0) are
  // DELIBERATELY OMITTED from the column list — chat never writes wage money.
  const id = randomUUID();
  const notes = JSON.stringify({
    via: 'chat',
    createdBy: ctx.userId,
    intent: 'draft_payroll_run',
    ...(siteId ? { siteId } : {}),
  });

  // Single parameterized INSERT into the payroll_runs HEADER, in the
  // pre-money `draft` state. NO money column appears in this statement; NO
  // payroll_line_items row is created; NO ledger/journal is touched.
  const insertResult = await ctx.db.execute(sql`
    INSERT INTO payroll_runs (
      id, tenant_id, created_by_user_id, period_start, period_end, status, notes
    ) VALUES (
      ${id}, ${ctx.tenantId}, ${ctx.userId}, ${periodStart}, ${periodEnd}, 'draft', ${notes}
    )
    RETURNING id, status
  `);
  const row = rowsOf(insertResult)[0] ?? { id, status: 'draft' };

  await appendExecAudit(ctx, {
    action: 'owner.payroll.run.draft',
    turnId: String(row.id),
    details: {
      payrollRunId: String(row.id),
      periodStart,
      periodEnd,
      status: String(row.status),
      ...(siteId ? { siteId } : {}),
      // Make the money-boundary explicit in the immutable trail.
      moneyMoved: false,
      ledgerPosted: false,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'draft_payroll_run',
      tenantId: ctx.tenantId,
      payrollRunId: String(row.id),
      periodStart,
      periodEnd,
    },
    'action-executor: payroll DRAFT created (no money moved)',
  );

  return {
    kind: 'payroll_run_draft',
    id: String(row.id),
    summary: `Payroll draft created for ${periodStart} (pending owner approval)`,
    data: {
      payrollRunId: String(row.id),
      periodStart,
      periodEnd,
      status: String(row.status),
      ...(siteId ? { siteId } : {}),
    },
  };
};
