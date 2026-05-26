/**
 * Anticipatory UX persistence (Wave 17B).
 *
 * Companion to docs/DESIGN/ANTICIPATORY_UX_SPEC.md. Drizzle types for the
 * 4 tables created by migration 0017_anticipatory_ux.sql:
 *
 *   - tabRecipes            → versioned Tab Recipe registry (global).
 *   - uiTelemetryEvents     → append-only field-interaction stream.
 *   - uiEvolutionProposals  → owner-facing UI improvement queue.
 *   - brandLintViolations   → CI sweep + runtime brand-token validator
 *                              output (global).
 *
 * tabRecipes and brandLintViolations are global product config / ops
 * tooling — no tenant_id, RLS disabled. uiTelemetryEvents and
 * uiEvolutionProposals are tenant-scoped via `app.tenant_id` GUC.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  jsonb,
  uuid,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// tab_recipes — versioned Tab Recipe registry (GLOBAL)
// ============================================================================

export const tabRecipes = pgTable(
  'tab_recipes',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    status: text('status').notNull(),
    /** Stable intent literal, e.g. 'BuyerKYBStart'. */
    intent: text('intent').notNull(),
    /** Module path to the composer function. */
    composeFnRef: text('compose_fn_ref').notNull(),
    /** 0 | 1 | 2 — see AUTHORITY TIERS in the spec. */
    authorityTier: smallint('authority_tier').notNull(),
    brand: text('brand').notNull().default('borjie'),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    promotedBy: text('promoted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.id, t.version] }),
    statusIdx: index('tab_recipes_status_idx').on(t.status),
    intentIdx: index('tab_recipes_intent_idx').on(t.intent),
    promotedByIdx: index('tab_recipes_promoted_by_idx').on(t.promotedBy),
  }),
);

// ============================================================================
// ui_telemetry_events — append-only field-interaction stream
// ============================================================================

export const uiTelemetryEvents = pgTable(
  'ui_telemetry_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tabRecipeId: text('tab_recipe_id').notNull(),
    tabRecipeVersion: integer('tab_recipe_version').notNull(),
    sessionId: text('session_id'),
    /** NULL for tab-level events (e.g. render, dismiss). */
    fieldId: text('field_id'),
    /** focus | blur | change | error | tooltip_hit | abandon | submit |
     *  render | dismiss. */
    eventKind: text('event_kind').notNull(),
    /** Scrubbed payload — never contains field values. */
    payload: jsonb('payload').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    recipeIdx: index('ui_telemetry_events_recipe_idx').on(
      t.tabRecipeId,
      t.tabRecipeVersion,
      t.recordedAt,
    ),
    tenantRecordedIdx: index('ui_telemetry_events_tenant_recorded_idx').on(
      t.tenantId,
      t.recordedAt,
    ),
    fieldIdx: index('ui_telemetry_events_field_idx').on(
      t.tabRecipeId,
      t.tabRecipeVersion,
      t.fieldId,
      t.eventKind,
    ),
  }),
);

// ============================================================================
// ui_evolution_proposals — owner-facing UI improvement queue
// ============================================================================

export const uiEvolutionProposals = pgTable(
  'ui_evolution_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tabRecipeId: text('tab_recipe_id').notNull(),
    currentVersion: integer('current_version').notNull(),
    proposedVersion: integer('proposed_version').notNull(),
    /** Structured diff payload — section/field-level reorder/add/remove. */
    proposedSchemaDiff: jsonb('proposed_schema_diff').notNull(),
    /** Which telemetry signals triggered this proposal. */
    signals: jsonb('signals').notNull().default({}),
    /** Corpus citation IDs justifying the change. */
    citations: text('citations').array().notNull().default([]),
    /** pending | approved | rejected | expired | auto_applied_tier_0. */
    status: text('status').notNull().default('pending'),
    proposedAt: timestamp('proposed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    reviewerReason: text('reviewer_reason'),
    /** gradual | full | a_b. */
    rolloutStrategy: text('rollout_strategy'),
    approvalAuditHash: text('approval_audit_hash'),
  },
  (t) => ({
    tenantStatusIdx: index('ui_evolution_proposals_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.proposedAt,
    ),
    recipeIdx: index('ui_evolution_proposals_recipe_idx').on(
      t.tabRecipeId,
      t.currentVersion,
    ),
    reviewedByIdx: index('ui_evolution_proposals_reviewed_by_idx').on(t.reviewedBy),
  }),
);

// ============================================================================
// brand_lint_violations — CI sweep + runtime brand-token validator (GLOBAL)
// ============================================================================

export const brandLintViolations = pgTable(
  'brand_lint_violations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    filePath: text('file_path').notNull(),
    lineNo: integer('line_no').notNull(),
    /** raw-color | inline-style | arbitrary-spacing | non-brand-font |
     *  arbitrary-radius | arbitrary-shadow | non-token-class. */
    rule: text('rule').notNull(),
    snippet: text('snippet').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    fileIdx: index('brand_lint_violations_file_idx').on(t.filePath),
    ruleIdx: index('brand_lint_violations_rule_idx').on(t.rule, t.detectedAt),
    detectedIdx: index('brand_lint_violations_detected_idx').on(t.detectedAt),
  }),
);

export type TabRecipe = typeof tabRecipes.$inferSelect;
export type NewTabRecipe = typeof tabRecipes.$inferInsert;
export type UiTelemetryEvent = typeof uiTelemetryEvents.$inferSelect;
export type NewUiTelemetryEvent = typeof uiTelemetryEvents.$inferInsert;
export type UiEvolutionProposal = typeof uiEvolutionProposals.$inferSelect;
export type NewUiEvolutionProposal = typeof uiEvolutionProposals.$inferInsert;
export type BrandLintViolation = typeof brandLintViolations.$inferSelect;
export type NewBrandLintViolation = typeof brandLintViolations.$inferInsert;
