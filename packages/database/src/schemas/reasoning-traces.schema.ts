/**
 * Reasoning Traces + PRM Training Examples + MCTS Search Tree Dumps
 *
 * Drizzle types for the three tables created by migration
 * 0040_reasoning_traces.sql. Companion to:
 *   - Docs/DESIGN/PRM_MCTS_REASONING_SPEC.md
 *   - packages/process-reward-model
 *
 * All three tables are tenant-scoped, RLS-bound via the canonical
 * `app.tenant_id` GUC pattern.
 *
 *   1. reasoningTraces        — full (state, step, observation)
 *                                trajectory captures. `outcomeLabel`
 *                                is NULL until the trace's terminal
 *                                outcome is verified (regulator portal
 *                                / payment cleared / human-ratified).
 *
 *   2. prmTrainingExamples    — labeled (state, step, label) pairs
 *                                derived from the Math-Shepherd
 *                                completer technique. The training
 *                                substrate for the learned PRM
 *                                (Phase 2, covered by 19C).
 *
 *   3. mctsSearchTreeDumps    — per-invocation MCTS audit + replay
 *                                store. Stores the (capped) tree, the
 *                                budget snapshot, the selected path,
 *                                and the termination reason.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  smallint,
  uuid,
  jsonb,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// reasoning_traces
// ============================================================================

export const reasoningTraces = pgTable(
  'reasoning_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id').notNull(),
    intentKind: text('intent_kind').notNull(),
    /** Full ordered list of `(step, observation)` pairs as JSONB. */
    trajectoryJsonb: jsonb('trajectory_jsonb').notNull(),
    /** NULL until verified; 0 = negative, 1 = positive. */
    outcomeLabel: smallint('outcome_label'),
    /** 'regulator_portal' | 'payment' | 'human' | NULL. */
    outcomeSource: text('outcome_source'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    labeledAt: timestamp('labeled_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantRecentIdx: index('idx_reasoning_traces_tenant_recent').on(
      t.tenantId,
      t.capturedAt,
    ),
    intentLabelIdx: index('idx_reasoning_traces_intent_label').on(
      t.intentKind,
      t.outcomeLabel,
    ),
    turnIdx: index('idx_reasoning_traces_turn').on(t.tenantId, t.turnId),
  }),
);

export type ReasoningTraceRow = typeof reasoningTraces.$inferSelect;
export type ReasoningTraceInsert = typeof reasoningTraces.$inferInsert;

// ============================================================================
// prm_training_examples
// ============================================================================

export const prmTrainingExamples = pgTable(
  'prm_training_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    traceId: uuid('trace_id').notNull(),
    stateJsonb: jsonb('state_jsonb').notNull(),
    stepJsonb: jsonb('step_jsonb').notNull(),
    /** 0 = negative, 1 = positive (Math-Shepherd derived). */
    label: smallint('label').notNull(),
    completerAgreementRatio: doublePrecision('completer_agreement_ratio').notNull(),
    derivedAt: timestamp('derived_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantRecentIdx: index('idx_prm_training_examples_tenant_recent').on(
      t.tenantId,
      t.derivedAt,
    ),
    traceIdx: index('idx_prm_training_examples_trace').on(t.traceId),
    labelIdx: index('idx_prm_training_examples_label').on(t.tenantId, t.label),
  }),
);

export type PrmTrainingExampleRow = typeof prmTrainingExamples.$inferSelect;
export type PrmTrainingExampleInsert = typeof prmTrainingExamples.$inferInsert;

// ============================================================================
// mcts_search_tree_dumps
// ============================================================================

export const mctsSearchTreeDumps = pgTable(
  'mcts_search_tree_dumps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    turnId: text('turn_id').notNull(),
    rootIntentJsonb: jsonb('root_intent_jsonb').notNull(),
    /** Compressed tree as jsonb. Capped at 256 KB; oversize falls back to summary. */
    treeJsonb: jsonb('tree_jsonb').notNull(),
    budgetJsonb: jsonb('budget_jsonb').notNull(),
    selectedPathJsonb: jsonb('selected_path_jsonb').notNull(),
    /**
     * One of 'budget_exhausted' | 'confident_root_choice' |
     * 'wall_clock_exceeded' | 'no_expansion_possible'.
     */
    terminatedReason: text('terminated_reason').notNull(),
    wallMs: integer('wall_ms').notNull(),
    rolloutsRun: integer('rollouts_run').notNull(),
    bestValue: doublePrecision('best_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantRecentIdx: index('idx_mcts_search_tree_dumps_tenant_recent').on(
      t.tenantId,
      t.createdAt,
    ),
    turnIdx: index('idx_mcts_search_tree_dumps_turn').on(t.tenantId, t.turnId),
    terminatedIdx: index('idx_mcts_search_tree_dumps_terminated').on(
      t.terminatedReason,
    ),
  }),
);

export type MctsSearchTreeDumpRow = typeof mctsSearchTreeDumps.$inferSelect;
export type MctsSearchTreeDumpInsert = typeof mctsSearchTreeDumps.$inferInsert;
