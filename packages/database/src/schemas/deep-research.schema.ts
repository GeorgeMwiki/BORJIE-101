/**
 * Deep Research persistence (Wave 17C).
 *
 * Companion to docs/DESIGN/DEEP_RESEARCH_SPEC.md. Drizzle types for the
 * 6 tables created by migration 0018_deep_research.sql:
 *
 *   - researchPlans       → top-level plan rows.
 *   - researchSteps       → ordered DAG of tool calls per plan.
 *   - researchArtifacts   → typed retrieval artifacts with provenance.
 *   - researchResults     → synthesized output + span citations + audit
 *                            hash.
 *   - researchSessions    → long-running Deep Dive checkpointing.
 *   - continuousWatches   → owner-configured poll/threshold watches.
 *
 * All tenant-scoped; RLS enforced at the database layer.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  uuid,
  unique,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// Forward references handled via the SQL ALTER TABLE; in Drizzle land we
// just import the table objects since they all live in the same module.

// ============================================================================
// research_plans — top-level research plan
// ============================================================================

export const researchPlans = pgTable(
  'research_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** reactive_query | anticipatory_sweep | daily_briefing | deep_dive |
     *  continuous_watch. */
    mode: text('mode').notNull(),
    query: text('query').notNull(),
    /** mr_mwikila | owner_explicit | worker_cron. */
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    budgetMs: integer('budget_ms'),
    budgetUsdCents: integer('budget_usd_cents'),
    spentUsdCents: integer('spent_usd_cents').notNull().default(0),
    /** planned | running | paused | complete | failed. */
    status: text('status').notNull().default('planned'),
    /** FK to research_results.id — wired post-table-creation in SQL. */
    resultId: uuid('result_id'),
    auditHash: text('audit_hash'),
  },
  (t) => ({
    tenantStatusModeIdx: index('research_plans_tenant_status_mode_idx').on(
      t.tenantId,
      t.status,
      t.mode,
    ),
    tenantCreatedIdx: index('research_plans_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

// ============================================================================
// research_steps — ordered tool calls within a plan
// ============================================================================

export const researchSteps = pgTable(
  'research_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => researchPlans.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    /** web_search | web_fetch | corpus_query | commodity_price |
     *  regulatory_diff | pdf_extract | image_ocr | table_parse |
     *  news_scan | fx_rate. */
    tool: text('tool').notNull(),
    toolInput: jsonb('tool_input').notNull(),
    /** pending | running | done | failed | skipped. */
    status: text('status').notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    costUsdCents: integer('cost_usd_cents'),
    durationMs: integer('duration_ms'),
    error: text('error'),
  },
  (t) => ({
    seqUnique: unique('research_steps_seq_unique').on(t.planId, t.seq),
    planSeqIdx: index('research_steps_plan_seq_idx').on(t.planId, t.seq),
    statusIdx: index('research_steps_status_idx').on(t.planId, t.status),
    toolIdx: index('research_steps_tool_idx').on(t.tool, t.status),
  }),
);

// ============================================================================
// research_artifacts — typed retrieval artifacts with provenance
// ============================================================================

export const researchArtifacts = pgTable(
  'research_artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stepId: uuid('step_id')
      .notNull()
      .references(() => researchSteps.id, { onDelete: 'cascade' }),
    /** web | corpus | feed | pdf | image | table. */
    sourceKind: text('source_kind').notNull(),
    sourceUri: text('source_uri').notNull(),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    content: text('content').notNull(),
    extractedEntities: jsonb('extracted_entities').notNull().default([]),
    /** 0.00 .. 1.00 from the Scorer. */
    qualityScore: numeric('quality_score', { precision: 3, scale: 2 }),
    /** paid_promotion | opinion | unverified | ai_generated | … */
    biasFlags: text('bias_flags').array().notNull().default([]),
    citationId: text('citation_id').notNull(),
  },
  (t) => ({
    stepIdx: index('research_artifacts_step_idx').on(t.stepId),
    citationIdx: index('research_artifacts_citation_idx').on(t.citationId),
    sourceKindIdx: index('research_artifacts_source_kind_idx').on(t.sourceKind),
  }),
);

// ============================================================================
// research_results — synthesized output + span citations + audit hash
// ============================================================================

export const researchResults = pgTable(
  'research_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => researchPlans.id, { onDelete: 'cascade' }),
    summaryMd: text('summary_md').notNull(),
    /** SpanCitation[] payload from packages/ai-copilot retrieval. */
    spanCitations: jsonb('span_citations').notNull().default([]),
    /** high | medium | low. */
    confidence: text('confidence').notNull(),
    /** Disagreement records — never silently averaged. */
    disagreements: jsonb('disagreements').notNull().default([]),
    auditHash: text('audit_hash').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    planIdx: index('research_results_plan_idx').on(t.planId),
    generatedIdx: index('research_results_generated_idx').on(t.generatedAt),
    confidenceIdx: index('research_results_confidence_idx').on(t.confidence),
  }),
);

// ============================================================================
// research_sessions — long-running Deep Dive checkpointing
// ============================================================================

export const researchSessions = pgTable(
  'research_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    activePlanId: uuid('active_plan_id').references(() => researchPlans.id, {
      onDelete: 'set null',
    }),
    /** Checkpoint payload — crash-resumable. */
    state: jsonb('state').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastProgressAt: timestamp('last_progress_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** running | paused | complete | failed. */
    status: text('status').notNull().default('running'),
    /** Budget gates in USD (e.g. [5, 15]) — dive pauses when spend
     *  crosses any gate and waits for owner re-confirmation. */
    ownerSignOffRequiredAtUsd: numeric('owner_sign_off_required_at_usd')
      .array()
      .notNull()
      .default([]),
  },
  (t) => ({
    tenantStatusIdx: index('research_sessions_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    activePlanIdx: index('research_sessions_active_plan_idx').on(t.activePlanId),
    lastProgressIdx: index('research_sessions_last_progress_idx').on(
      t.tenantId,
      t.lastProgressAt,
    ),
  }),
);

// ============================================================================
// continuous_watches — owner-configured poll/threshold watches
// ============================================================================

export const continuousWatches = pgTable(
  'continuous_watches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    cadenceMinutes: integer('cadence_minutes').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    /** Threshold config, e.g. { price_pct_change_above: 5 }. */
    thresholds: jsonb('thresholds').notNull().default({}),
    /** active | paused | expired | deleted. */
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    tenantStatusIdx: index('continuous_watches_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    creatorIdx: index('continuous_watches_creator_idx').on(t.createdByUserId),
  }),
);

export type ResearchPlan = typeof researchPlans.$inferSelect;
export type NewResearchPlan = typeof researchPlans.$inferInsert;
export type ResearchStep = typeof researchSteps.$inferSelect;
export type NewResearchStep = typeof researchSteps.$inferInsert;
export type ResearchArtifact = typeof researchArtifacts.$inferSelect;
export type NewResearchArtifact = typeof researchArtifacts.$inferInsert;
export type ResearchResult = typeof researchResults.$inferSelect;
export type NewResearchResult = typeof researchResults.$inferInsert;
export type ResearchSession = typeof researchSessions.$inferSelect;
export type NewResearchSession = typeof researchSessions.$inferInsert;
export type ContinuousWatch = typeof continuousWatches.$inferSelect;
export type NewContinuousWatch = typeof continuousWatches.$inferInsert;
