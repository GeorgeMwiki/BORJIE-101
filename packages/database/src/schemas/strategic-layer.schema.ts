/**
 * Strategic Direction Layer persistence (Wave M10–M12).
 *
 * Companion to Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md §15 and
 * migration 0040_strategic_layer.sql. Drizzle types for the six
 * tables backing the strategic-direction loop:
 *
 *   - northStarObjectives   — durable goal records (OKR-shaped) with a
 *                             proposed/active/met/missed/retired state
 *                             machine. T2 events flow through
 *                             @borjie/mutation-authority.
 *   - objectiveProgress     — append-only observation log per objective.
 *                             Velocity + drift signal computed from
 *                             the latest rows.
 *   - pivotProposals        — LLM-drafted retarget / reframe /
 *                             retire-and-replace recommendations when
 *                             drift goes off_track for ≥7 days.
 *   - federationConsents    — per-tenant opt-in gate for cross-tenant
 *                             cognitive-memory federation. Default
 *                             deny; scoped; expiring; prospective
 *                             revocation.
 *   - epsilonBudgets        — per-tenant per-period (monthly) Rényi-DP
 *                             budget cap.
 *   - epsilonLedger         — append-only audit log of every ε-charge
 *                             against a budget. Idempotent on
 *                             (tenant_id, op_kind, op_id).
 *
 * All six tables are tenant-scoped and use the canonical
 * `current_setting('app.tenant_id', true)` GUC RLS policy (migration
 * 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  date,
  jsonb,
  uuid,
  numeric,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// north_star_objectives — durable goal record
// ============================================================================

export const northStarObjectives = pgTable(
  'north_star_objectives',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** 'tenant_root' or org_unit_id (Wave 18Y org-scope). */
    scopeId: text('scope_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    /** e.g. 'royalty_revenue_tzs', 'fx_position_usd', 'parcels_active'. */
    metricName: text('metric_name').notNull(),
    targetValue: numeric('target_value').notNull(),
    targetAt: timestamp('target_at', { withTimezone: true }).notNull(),
    /** proposed | active | met | missed | retired */
    status: text('status').notNull().default('proposed'),
    ownerUserId: uuid('owner_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash'),
  },
  (table) => ({
    statusIdx: index('idx_nso_tenant_status').on(
      table.tenantId,
      table.status,
      table.targetAt,
    ),
    scopeIdx: index('idx_nso_tenant_scope').on(
      table.tenantId,
      table.scopeId,
      table.status,
    ),
    ownerIdx: index('idx_nso_owner').on(
      table.tenantId,
      table.ownerUserId,
      table.status,
    ),
  }),
);

// ============================================================================
// objective_progress — append-only observation log
// ============================================================================

export const objectiveProgress = pgTable(
  'objective_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => northStarObjectives.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    observedValue: numeric('observed_value').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    objectiveIdx: index('idx_op_objective_recorded').on(
      table.objectiveId,
      table.recordedAt,
    ),
    tenantIdx: index('idx_op_tenant_recorded').on(
      table.tenantId,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// pivot_proposals — LLM-drafted retarget / reframe / retire suggestions
// ============================================================================

export const pivotProposals = pgTable(
  'pivot_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectiveId: uuid('objective_id')
      .notNull()
      .references(() => northStarObjectives.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    rationale: text('rationale').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    /** open | accepted | rejected | expired */
    status: text('status').notNull().default('open'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    objectiveIdx: index('idx_pp_objective_proposed').on(
      table.objectiveId,
      table.proposedAt,
    ),
    openIdx: index('idx_pp_tenant_open').on(table.tenantId, table.proposedAt),
  }),
);

// ============================================================================
// federation_consents — per-tenant opt-in gate for cross-tenant federation
// ============================================================================

export const federationConsents = pgTable(
  'federation_consents',
  {
    tenantId: text('tenant_id').notNull(),
    /** patterns | rules | terminology | failures | all */
    scope: text('scope').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    grantedBy: uuid('granted_by').notNull(),
    /** active | revoked | expired */
    status: text('status').notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.scope] }),
    statusIdx: index('idx_fc_tenant_status').on(table.tenantId, table.status),
    expiryIdx: index('idx_fc_expiry').on(table.expiresAt),
  }),
);

// ============================================================================
// epsilon_budgets — per-tenant per-period Rényi-DP budget cap
// ============================================================================

export const epsilonBudgets = pgTable(
  'epsilon_budgets',
  {
    tenantId: text('tenant_id').notNull(),
    /** Monthly period anchored to YYYY-MM-01. */
    periodStart: date('period_start').notNull(),
    totalEpsilon: numeric('total_epsilon').notNull(),
    spentEpsilon: numeric('spent_epsilon').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.periodStart] }),
    tenantIdx: index('idx_eb_tenant_period').on(
      table.tenantId,
      table.periodStart,
    ),
  }),
);

// ============================================================================
// epsilon_ledger — append-only audit log of every ε-charge
// ============================================================================

export const epsilonLedger = pgTable(
  'epsilon_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    periodStart: date('period_start').notNull(),
    chargeEpsilon: numeric('charge_epsilon').notNull(),
    opKind: text('op_kind').notNull(),
    /** Idempotency key — (tenantId, opKind, opId) is unique. */
    opId: text('op_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('uq_el_idempotency').on(
      table.tenantId,
      table.opKind,
      table.opId,
    ),
    tenantPeriodIdx: index('idx_el_tenant_period').on(
      table.tenantId,
      table.periodStart,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type NorthStarObjectiveRow = typeof northStarObjectives.$inferSelect;
export type NewNorthStarObjectiveRow =
  typeof northStarObjectives.$inferInsert;

export type ObjectiveProgressRow = typeof objectiveProgress.$inferSelect;
export type NewObjectiveProgressRow = typeof objectiveProgress.$inferInsert;

export type PivotProposalRow = typeof pivotProposals.$inferSelect;
export type NewPivotProposalRow = typeof pivotProposals.$inferInsert;

export type FederationConsentRow = typeof federationConsents.$inferSelect;
export type NewFederationConsentRow = typeof federationConsents.$inferInsert;

export type EpsilonBudgetRow = typeof epsilonBudgets.$inferSelect;
export type NewEpsilonBudgetRow = typeof epsilonBudgets.$inferInsert;

export type EpsilonLedgerRow = typeof epsilonLedger.$inferSelect;
export type NewEpsilonLedgerRow = typeof epsilonLedger.$inferInsert;
