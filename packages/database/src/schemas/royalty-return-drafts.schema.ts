/**
 * Royalty-return DRAFTS — the backing table for the confirm-required,
 * NON-MONEY `draft_royalty_return` chat verb.
 *
 * Companion to migration 0159. Sibling of `payroll_runs` (0134 §4): a
 * non-binding `status='draft'` header the owner reviews + completes in the
 * royalty surface (apps/owner-web RoyaltyDraftPanel). The verb was previously
 * FLAGGED "no backing table" in the action-executor registry and was
 * correctly NOT built until this table landed.
 *
 * Money path (CLAUDE.md hard rule)
 * --------------------------------
 * This table carries NO posted money / ledger column BY DESIGN. There is no
 * gross_value, no royalty_amount, and no ledger_txn_id. The royalty FIGURES
 * are filled by the owner in the royalty surface — NEVER from chat — and the
 * actual royalty PAYMENT posts the money path through `LedgerService.post()`
 * on a SEPARATE, four-eye-gated owner flow (the DEFERRED `file_royalty`
 * verb), never here. The chat draft writes ONLY the period + mineral +
 * (optional, non-money) physical quantity/unit and stops at `status='draft'`
 * — the pre-money state.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0159 (mirrors
 * payroll_runs' 0134 §4 policy on `current_setting('app.current_tenant_id')`).
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  uuid,
  date,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// royalty_return_drafts — header row per (tenant, period, mineral)
// ============================================================================

export const royaltyReturnDrafts = pgTable(
  'royalty_return_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** Owner / user who drafted the return (from chat or the surface). */
    createdByUserId: text('created_by_user_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    /** ISO mineral code or named gem (Au|Cu|tanzanite|...). Part of the key. */
    mineral: text('mineral').notNull(),
    /**
     * Optional, NON-MONEY production quantity the draft scopes (e.g. mass).
     * A physical figure — NEVER money. NULL until the owner fills it.
     */
    quantity: numeric('quantity', { precision: 18, scale: 4 }),
    /** Unit for `quantity` (kg | t | g | ct | ...). NULL when quantity NULL. */
    unit: text('unit'),
    /** draft | pending_approval | submitted | cancelled. Pre-money states. */
    status: text('status').notNull().default('draft'),
    /** Provenance / chat-intent bag. NO money figure is ever stored here. */
    notes: jsonb('notes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_royalty_return_drafts_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
    // Idempotency: one draft per (tenant, period_start, period_end, mineral).
    tenantPeriodMineralUnique: unique(
      'royalty_return_drafts_unique_tenant_period_mineral',
    ).on(t.tenantId, t.periodStart, t.periodEnd, t.mineral),
  }),
);

export type RoyaltyReturnDraft = typeof royaltyReturnDrafts.$inferSelect;
export type NewRoyaltyReturnDraft = typeof royaltyReturnDrafts.$inferInsert;
