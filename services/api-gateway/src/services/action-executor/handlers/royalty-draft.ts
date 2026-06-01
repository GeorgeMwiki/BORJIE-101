/**
 * draft_royalty_return — a CONFIRM-REQUIRED *DRAFT* verb (royalty-adjacent,
 * but NEVER a money move). Sibling of `draft_payroll_run`.
 *
 * ─── WHY THIS IS NOT A MONEY VERB (CLAUDE.md hard rule) ─────────────────
 * The money path MUST go through `LedgerService.post()`. The AI must NEVER
 * move money. This verb does NOT. It creates ONLY a `royalty_return_drafts`
 * *header* row in its initial `status='draft'` state — a non-binding pointer
 * the owner reviews + completes in the royalty surface (apps/owner-web
 * RoyaltyDraftPanel).
 *
 * The royalty FIGURES — gross value, royalty rate, royalty amount — are
 * filled by the owner in that surface, NEVER from chat. The
 * `royalty_return_drafts` table (migration 0159) carries NO posted money /
 * ledger column AT ALL (no gross_value, no royalty_amount, no ledger_txn_id),
 * so there is nothing money-shaped for this handler to write even by mistake.
 * The actual royalty PAYMENT posts the money path through
 * `LedgerService.post()` on a SEPARATE, four-eye-gated owner flow (the
 * DEFERRED `file_royalty` verb — see registry.ts), never here.
 *
 * Columns written here (NON-MONEY only):
 *   - period_start / period_end → the NOT-NULL date bounds (derived from a
 *     YYYY-MM `period` month, or supplied explicitly for parity).
 *   - mineral                   → the per-mineral scope of the return.
 *   - quantity / unit           → OPTIONAL physical production figures (mass,
 *     etc.). These are real-world MEASURES, never money. Omitted when absent
 *     so the DB leaves them NULL.
 *   - status                    → always the pre-money literal 'draft'.
 *   - notes                     → free-form chat provenance bag (no money).
 * We import NO LedgerService and write NO ledger / journal row.
 *
 * ─── WHY RAW PARAMETERIZED SQL (not the Drizzle table object) ───────────
 * Mirrors the sibling `payroll-draft.ts` EXACTLY: we write the draft via a
 * single PARAMETERIZED `sql` INSERT (the same mechanism `audit.ts` uses for
 * `ai_audit_chain`). Parameter binding (never string interpolation) keeps it
 * injection-safe, and it keeps this handler aligned with the established
 * draft-verb pattern + its tests without depending on barrel-export timing.
 *
 * This verb NEVER auto-executes. It is registered `autoSafe:false`
 * (registry.ts) so the brain-teach auto-execute path and `/micro-action`
 * both refuse it; ONLY `/confirm-action` (after the owner explicitly
 * confirmed via a confirmation_card) reaches this handler, and only after
 * the fail-closed `decideAutoAuthorization` gate authorizes it.
 *
 * Idempotency: mirrors the owner-route discipline — `royalty_return_drafts`
 * is unique-by-intent on (tenant, period_start, period_end, mineral); if a
 * draft already exists for the period + mineral we return it (no duplicate)
 * rather than inserting twice.
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

const draftRoyaltyReturnSchema = z
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
    /** The per-mineral scope of the royalty return (Au|Cu|tanzanite|...). */
    mineral: z.string().trim().min(1).max(80),
    /**
     * Optional NON-MONEY physical production quantity (mass etc.). A real-
     * world measure — NEVER money. Must be finite + non-negative when given.
     */
    quantity: z.number().finite().nonnegative().optional(),
    /** Unit for `quantity` (kg | t | g | ct | ...). */
    unit: z.string().trim().min(1).max(16).optional(),
  })
  .refine(
    (d) => Boolean(d.period) || (Boolean(d.periodStart) && Boolean(d.periodEnd)),
    {
      message: 'provide a `period` (YYYY-MM) or both periodStart + periodEnd',
      path: ['period'],
    },
  );

type DraftRoyaltyReturnInput = z.infer<typeof draftRoyaltyReturnSchema>;

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
 * Resolve the draft's `period_start` / `period_end` (both NOT NULL `date`).
 * From an explicit pair when given, else derived from the YYYY-MM month.
 * Throws a precise error when the bounds are inverted so the dispatcher
 * surfaces a clear `reason`.
 */
function resolvePeriod(input: DraftRoyaltyReturnInput): {
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
      throw new Error('draft_royalty_return_invalid_month');
    }
    periodStart = `${yearStr}-${monthStr}-01`;
    periodEnd = lastDayOfMonth(year, month);
  }
  if (new Date(periodStart).getTime() > new Date(periodEnd).getTime()) {
    throw new Error('draft_royalty_return_period_inverted');
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

export const draftRoyaltyReturnHandler: ActionHandler = async (
  rawInput: unknown,
  ctx: ExecContext,
): Promise<ExecResult> => {
  const input = draftRoyaltyReturnSchema.parse(rawInput);
  const { periodStart, periodEnd } = resolvePeriod(input);
  const mineral = input.mineral;
  // `quantity` is a physical measure (NOT money); bind it as text at the
  // numeric ORM boundary, or NULL when absent. `unit` only rides along when a
  // quantity is present (a unit with no quantity is meaningless).
  const quantity =
    input.quantity === undefined ? null : String(input.quantity);
  const unit = input.quantity === undefined ? null : (input.unit ?? null);

  // Idempotent on (tenant, period, mineral) — a repeated chat draft for the
  // same month + mineral returns the existing draft, never a duplicate.
  const existingResult = await ctx.db.execute(sql`
    SELECT id, status FROM royalty_return_drafts
     WHERE tenant_id = ${ctx.tenantId}
       AND period_start = ${periodStart}
       AND period_end = ${periodEnd}
       AND mineral = ${mineral}
     LIMIT 1
  `);
  const existing = rowsOf(existingResult)[0];
  if (existing) {
    return {
      kind: 'royalty_return_draft',
      id: String(existing.id),
      summary: `Royalty draft for ${mineral} (${periodStart}) already exists (status: ${String(
        existing.status,
      )})`,
      data: {
        royaltyReturnDraftId: String(existing.id),
        periodStart,
        periodEnd,
        mineral,
        status: String(existing.status),
        idempotent: true,
      },
    };
  }

  // `notes` is a free-text jsonb column — we record chat provenance only. NO
  // money column exists on this table, so there is nothing money-shaped to
  // omit; gross_value / royalty_amount are filled by the owner elsewhere.
  const id = randomUUID();
  const notes = JSON.stringify({
    via: 'chat',
    createdBy: ctx.userId,
    intent: 'draft_royalty_return',
  });

  // Single parameterized INSERT into the royalty_return_drafts HEADER, in the
  // pre-money `draft` state. NO money column appears in this statement; NO
  // ledger/journal is touched.
  const insertResult = await ctx.db.execute(sql`
    INSERT INTO royalty_return_drafts (
      id, tenant_id, created_by_user_id, period_start, period_end,
      mineral, quantity, unit, status, notes
    ) VALUES (
      ${id}, ${ctx.tenantId}, ${ctx.userId}, ${periodStart}, ${periodEnd},
      ${mineral}, ${quantity}, ${unit}, 'draft', ${notes}::jsonb
    )
    RETURNING id, status
  `);
  const row = rowsOf(insertResult)[0] ?? { id, status: 'draft' };

  await appendExecAudit(ctx, {
    action: 'owner.royalty.return.draft',
    turnId: String(row.id),
    details: {
      royaltyReturnDraftId: String(row.id),
      periodStart,
      periodEnd,
      mineral,
      status: String(row.status),
      // Make the money-boundary explicit in the immutable trail.
      moneyMoved: false,
      ledgerPosted: false,
      source: 'chat-confirm-action',
    },
  });

  ctx.logger.info?.(
    {
      executor: 'draft_royalty_return',
      tenantId: ctx.tenantId,
      royaltyReturnDraftId: String(row.id),
      periodStart,
      periodEnd,
      mineral,
    },
    'action-executor: royalty DRAFT created (no money moved)',
  );

  return {
    kind: 'royalty_return_draft',
    id: String(row.id),
    summary: `Royalty draft created for ${mineral} (${periodStart}) (pending owner approval)`,
    data: {
      royaltyReturnDraftId: String(row.id),
      periodStart,
      periodEnd,
      mineral,
      status: String(row.status),
      ...(quantity !== null ? { quantity: input.quantity } : {}),
      ...(unit !== null ? { unit } : {}),
    },
  };
};
