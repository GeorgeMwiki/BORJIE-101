/**
 * Five-Layer Loop Architecture persistence (Wave M3-M4).
 *
 * Companion to Docs/DESIGN/FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md.
 * Drizzle types for the 3 tables created by migration
 * 0035_loop_architecture.sql:
 *
 *   - loopRuns                 → one row per end-to-end loop
 *                                execution. Captures kind, tenant,
 *                                timing, status, hash-chain pointers.
 *                                Tenant-scoped, RLS.
 *   - loopLayerOutcomes        → one row per executed layer
 *                                (sensors / policy / tools / quality /
 *                                learning). Captures outcome jsonb,
 *                                latency, cost, audit hash. Tenant-
 *                                scoped, RLS.
 *   - loopQualitySignals       → one row per quality signal emitted
 *                                by the Layer 4 composite gate.
 *                                Captures signal name, score, weight,
 *                                evidence. Tenant-scoped, RLS.
 *
 * All three tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  real,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// loop_runs — one row per end-to-end loop execution
// ============================================================================

export const loopRuns = pgTable(
  'loop_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Loop classification — reactive | tab_tick | deep_research | autonomous_24_7 | recipe_lifecycle | … */
    loopKind: text('loop_kind').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** running | ok | no_input | denied | gated | tool_error | quality_failed | learning_error */
    status: text('status').notNull().default('running'),
    /** Hash over (tenant_id, loop_kind, started_at, prev_hash, layer outcomes). */
    auditHash: text('audit_hash').notNull(),
    /** Pointer to the previous loop_run's audit_hash for this tenant. NULL for first row. */
    prevHash: text('prev_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantStartedIdx: index('idx_loop_runs_tenant_started').on(
      table.tenantId,
      table.startedAt,
    ),
    kindIdx: index('idx_loop_runs_kind').on(
      table.tenantId,
      table.loopKind,
      table.startedAt,
    ),
    openIdx: index('idx_loop_runs_open').on(table.tenantId, table.status),
  }),
);

// ============================================================================
// loop_layer_outcomes — one row per executed layer
// ============================================================================

export const loopLayerOutcomes = pgTable(
  'loop_layer_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loopRunId: uuid('loop_run_id')
      .notNull()
      .references(() => loopRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    /** sensors | policy | tools | quality | learning */
    layer: text('layer').notNull(),
    /** Per-layer typed outcome — schema is layer-specific, stored as jsonb. */
    outcome: jsonb('outcome').notNull().default({}),
    latencyMs: integer('latency_ms').notNull().default(0),
    costUsdCents: integer('cost_usd_cents').notNull().default(0),
    auditHash: text('audit_hash').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdx: index('idx_loop_layer_outcomes_run').on(
      table.loopRunId,
      table.recordedAt,
    ),
    tenantLayerIdx: index('idx_loop_layer_outcomes_tenant_layer').on(
      table.tenantId,
      table.layer,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// loop_quality_signals — one row per gate signal in Layer 4
// ============================================================================

export const loopQualitySignals = pgTable(
  'loop_quality_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    loopRunId: uuid('loop_run_id')
      .notNull()
      .references(() => loopRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull(),
    /** Signal name — groundedness | calibration | brand | authority | budget | … */
    signal: text('signal').notNull(),
    /** Score in [0,1]; gate-specific semantics (1.0 = pass, 0.0 = fail). */
    score: real('score').notNull(),
    /** Composite weight, nonneg. Default 1.0. */
    weight: real('weight').notNull().default(1.0),
    /** Evidence payload — gate-specific jsonb (failed claims, ids, etc.). */
    evidence: jsonb('evidence').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    runIdx: index('idx_loop_quality_signals_run').on(
      table.loopRunId,
      table.recordedAt,
    ),
    signalIdx: index('idx_loop_quality_signals_signal').on(
      table.tenantId,
      table.signal,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type LoopRunRow = typeof loopRuns.$inferSelect;
export type NewLoopRunRow = typeof loopRuns.$inferInsert;

export type LoopLayerOutcomeRow = typeof loopLayerOutcomes.$inferSelect;
export type NewLoopLayerOutcomeRow = typeof loopLayerOutcomes.$inferInsert;

export type LoopQualitySignalRow = typeof loopQualitySignals.$inferSelect;
export type NewLoopQualitySignalRow = typeof loopQualitySignals.$inferInsert;
