/**
 * Mutation Authority persistence (Wave 18S).
 *
 * Companion to docs/DESIGN/MUTATION_AUTHORITY_SPEC.md. Drizzle types
 * for the 5 tables created by migration 0023_mutation_authority.sql:
 *
 *   - mutationRecipes                   → versioned recipe registry (global)
 *   - mutationProposals                 → tenant-scoped proposal state machine
 *   - mutationApprovals                 → owner + second-authoriser signatures
 *   - mutationHistory                   → append-only result ledger
 *   - secondAuthoriserAssignments       → per-tenant double-verify pairing
 *
 * mutationRecipes is global product config — no tenant_id, RLS off in
 * the migration. The other four are tenant-scoped (either directly via
 * tenant_id or transitively via mutation_proposals); RLS uses the
 * canonical `app.tenant_id` GUC pattern.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  boolean,
  bigint,
  jsonb,
  uuid,
  primaryKey,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// mutation_recipes — versioned recipe registry (GLOBAL)
// ============================================================================

export const mutationRecipes = pgTable(
  'mutation_recipes',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    status: text('status').notNull(),
    /** ui | data | document | action. */
    class: text('class').notNull(),
    /** 0 | 1 | 2. */
    authorityTier: smallint('authority_tier').notNull(),
    isCritical: boolean('is_critical').notNull().default(false),
    /** fully | partial | irreversible. */
    reversibility: text('reversibility').notNull(),
    composeFnRef: text('compose_fn_ref').notNull(),
    executeFnRef: text('execute_fn_ref').notNull(),
    /** ReadonlyArray<CitationContract> serialised as JSONB. */
    requiredCitations: jsonb('required_citations').notNull().default([]),
    brand: text('brand').notNull().default('borjie'),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.version] }),
    statusIdx: index('mutation_recipes_status_idx').on(t.status),
    classIdx: index('mutation_recipes_class_idx').on(t.class),
  }),
);

// ============================================================================
// mutation_proposals — tenant-scoped, pending → terminal
// ============================================================================

export const mutationProposals = pgTable(
  'mutation_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    recipeId: text('recipe_id').notNull(),
    recipeVersion: integer('recipe_version').notNull(),
    /** 'mr_mwikila' | 'owner_explicit:<uuid>' */
    proposedBy: text('proposed_by').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** { kind, id } shape — opaque to the runtime. */
    subject: jsonb('subject').notNull(),
    /** Preview payload — recipe-defined diff structure. */
    preview: jsonb('preview').notNull(),
    researchEvidenceIds: text('research_evidence_ids')
      .array()
      .notNull()
      .default([]),
    costOrValueAtStakeUsdCents: bigint('cost_or_value_at_stake_usd_cents', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    /** fully | partial | irreversible. */
    reversibility: text('reversibility').notNull(),
    authorityTier: smallint('authority_tier').notNull(),
    requiresDoubleVerify: boolean('requires_double_verify')
      .notNull()
      .default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** pending | approved_primary | approved_full | rejected | executed | aborted | expired. */
    status: text('status').notNull().default('pending'),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantStatusIdx: index('mutation_proposals_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    recipeIdx: index('mutation_proposals_recipe_idx').on(
      t.recipeId,
      t.recipeVersion,
    ),
    expiresIdx: index('mutation_proposals_expires_idx').on(t.expiresAt),
  }),
);

// ============================================================================
// mutation_approvals — owner + second-authoriser sigs
// ============================================================================

export const mutationApprovals = pgTable(
  'mutation_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => mutationProposals.id, { onDelete: 'cascade' }),
    approverUserId: text('approver_user_id').notNull(),
    /** owner | second_authoriser. */
    approverRole: text('approver_role').notNull(),
    /** approved | rejected. */
    decision: text('decision').notNull(),
    reasoning: text('reasoning').notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    noSelfDoubleApprove: unique('no_self_double_approve').on(
      t.proposalId,
      t.approverUserId,
    ),
    proposalIdx: index('mutation_approvals_proposal_idx').on(t.proposalId),
    approverIdx: index('mutation_approvals_approver_idx').on(t.approverUserId),
  }),
);

// ============================================================================
// mutation_history — append-only result ledger
// ============================================================================

export const mutationHistory = pgTable(
  'mutation_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    proposalId: uuid('proposal_id')
      .notNull()
      .unique()
      .references(() => mutationProposals.id, { onDelete: 'restrict' }),
    /** executed | failed | aborted. */
    status: text('status').notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    rollbackToken: text('rollback_token'),
    sideEffectsSummary: text('side_effects_summary').notNull(),
    downstreamArtifacts: jsonb('downstream_artifacts').notNull().default([]),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    proposalIdx: index('mutation_history_proposal_idx').on(t.proposalId),
    statusIdx: index('mutation_history_status_idx').on(t.status),
  }),
);

// ============================================================================
// second_authoriser_assignments — per-tenant double-verify pairing
// ============================================================================

export const secondAuthoriserAssignments = pgTable(
  'second_authoriser_assignments',
  {
    tenantId: text('tenant_id').notNull(),
    primaryUserId: text('primary_user_id').notNull(),
    secondAuthoriserUserId: text('second_authoriser_user_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    active: boolean('active').notNull().default(true),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.primaryUserId] }),
    tenantIdx: index('second_authoriser_tenant_idx').on(t.tenantId),
    activeIdx: index('second_authoriser_active_idx').on(t.tenantId, t.active),
  }),
);
