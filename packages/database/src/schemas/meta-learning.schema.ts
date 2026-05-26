/**
 * Meta-learning conductor persistence (Wave SELFIMPROVE).
 *
 * Companion to Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md.
 * Drizzle types for the two tables created by migration
 * 0047_selfimprove_omni_p2.sql:
 *
 *   - metaLearningRuns       → one row per conductor run; status
 *                              lifecycle scheduled → running →
 *                              succeeded | failed; decision in
 *                              promote | demote | no-op | rollback;
 *                              audit-chained per
 *                              (tenant_id, capability_id).
 *   - metaLearningExamples   → one row per curated example,
 *                              referenced by meta_run_id; prompt /
 *                              completion / reward / included.
 *
 * Both tables use the canonical `app.tenant_id` GUC RLS policy.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  boolean,
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// meta_learning_runs
// ============================================================================

export const metaLearningRuns = pgTable(
  'meta_learning_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** scheduled | running | succeeded | failed. */
    status: text('status').notNull().default('scheduled'),
    capabilityId: uuid('capability_id').notNull(),
    examplesCount: integer('examples_count').notNull().default(0),
    evalMetricBefore: real('eval_metric_before'),
    evalMetricAfter: real('eval_metric_after'),
    /** promote | demote | no-op | rollback (nullable until decided). */
    decision: text('decision'),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash'),
  },
  (table) => ({
    tenantStartedIdx: index('idx_meta_learning_runs_tenant_started').on(
      table.tenantId,
      table.startedAt,
    ),
    tenantCapabilityIdx: index('idx_meta_learning_runs_tenant_capability').on(
      table.tenantId,
      table.capabilityId,
      table.startedAt,
    ),
  }),
);

export type MetaLearningRunRow = typeof metaLearningRuns.$inferSelect;
export type NewMetaLearningRunRow = typeof metaLearningRuns.$inferInsert;

// ============================================================================
// meta_learning_examples
// ============================================================================

export const metaLearningExamples = pgTable(
  'meta_learning_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    metaRunId: uuid('meta_run_id').notNull(),
    prompt: jsonb('prompt').notNull(),
    completion: jsonb('completion').notNull(),
    reward: real('reward').notNull(),
    included: boolean('included').notNull().default(true),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    runIdx: index('idx_meta_learning_examples_run').on(table.metaRunId),
    tenantRunIdx: index('idx_meta_learning_examples_tenant_run').on(
      table.tenantId,
      table.metaRunId,
    ),
  }),
);

export type MetaLearningExampleRow = typeof metaLearningExamples.$inferSelect;
export type NewMetaLearningExampleRow = typeof metaLearningExamples.$inferInsert;

// silence unused-import warnings if the consumer only uses one shape.
export const _uniqueIndex = uniqueIndex;
