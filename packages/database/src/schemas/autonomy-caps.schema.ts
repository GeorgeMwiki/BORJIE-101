/**
 * tenant_autonomy_caps — per-tenant autonomy envelope (Phase E.4).
 *
 * The "Klarna defense" substrate. Every autonomous mutation must pass an
 * `evaluateAutonomyCap` check against this row BEFORE the four-eye
 * approval / sovereign-ledger write. See
 * `packages/autonomy-governance/src/caps/cap-evaluator.ts` for decision
 * logic.
 *
 * One row per tenant. Missing row = platform defaults (the substrate
 * resolves via `defaultCap(tenantId)`). Updates are admin-only — the
 * kernel must never raise its own ceiling.
 *
 * Schema-side guarantees:
 *   - All numeric ceilings are non-negative.
 *   - slowdownAt <= hardStopAt, both ∈ (0, 1].
 *   - perToolTierCaps + perSubMdCaps are JSONB blobs — shape is enforced
 *     in the application layer (Zod schema in autonomy-governance).
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  numeric,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const tenantAutonomyCaps = pgTable(
  'tenant_autonomy_caps',
  {
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Tenant-wide daily ceiling on autonomous mutations. */
    maxMutationsPerDay: integer('max_mutations_per_day').notNull().default(50),
    /** Tenant-wide daily cost ceiling, in USD cents. */
    maxCostUsdCentsPerDay: bigint('max_cost_usd_cents_per_day', { mode: 'number' })
      .notNull()
      .default(5_000_00),
    /**
     * JSONB object — keys are RiskTier strings, values are `number | null`.
     * `null` = unlimited; `0` = hard-blocked. Example:
     *   { "destroy": 0, "sovereign": 0, "billing": 5 }
     */
    perToolTierCaps: jsonb('per_tool_tier_caps')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * JSONB object — keys are sub-MD ids, values are
     *   { maxMutationsPerDay: number, maxCostUsdCentsPerDay: number }.
     */
    perSubMdCaps: jsonb('per_sub_md_caps')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Fraction at which `slowdown-ask-owner` engages. 0 < slowdownAt <= 1. */
    slowdownAt: numeric('slowdown_at', { precision: 3, scale: 2 })
      .notNull()
      .default('0.80'),
    /** Fraction at which `deny-cap-exceeded` fires. Usually 1.00. */
    hardStopAt: numeric('hard_stop_at', { precision: 3, scale: 2 })
      .notNull()
      .default('1.00'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => ({
    mutationsCheck: check(
      'tenant_autonomy_caps_mutations_chk',
      sql`${t.maxMutationsPerDay} >= 0`,
    ),
    costCheck: check(
      'tenant_autonomy_caps_cost_chk',
      sql`${t.maxCostUsdCentsPerDay} >= 0`,
    ),
    slowdownCheck: check(
      'tenant_autonomy_caps_slowdown_chk',
      sql`${t.slowdownAt} > 0 AND ${t.slowdownAt} <= 1`,
    ),
    hardStopCheck: check(
      'tenant_autonomy_caps_hard_stop_chk',
      sql`${t.hardStopAt} > 0 AND ${t.hardStopAt} <= 1`,
    ),
    slowdownLeqHardStopCheck: check(
      'tenant_autonomy_caps_slowdown_leq_hardstop_chk',
      sql`${t.slowdownAt} <= ${t.hardStopAt}`,
    ),
  }),
);
