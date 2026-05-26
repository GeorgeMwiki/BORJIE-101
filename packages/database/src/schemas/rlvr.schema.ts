/**
 * RLVR Post-Training Pipeline persistence (Wave 19C).
 *
 * Companion to Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md. Drizzle types
 * for the 4 tables created by migration 0065_rlvr.sql (renumbered from
 * 0041 to resolve collision with 0041_graph_rag.sql; alphabetic
 * precedence keeps graph_rag at slot 0041):
 *
 *   - rlvrRuns               → one row per end-to-end RLVR pipeline
 *                              run. Lifecycle status + verifier_set +
 *                              PO-14 hash chain.
 *   - rlvrTraces             → captured Mr. Mwikila traces. Carries
 *                              both raw and salted-hash-redacted form;
 *                              only the redacted form may leave the
 *                              tenant boundary.
 *   - rlvrVerifications      → per-(trace, verifier) verdict in
 *                              (pass, fail, partial, skip) + reward
 *                              ∈ [0, 1] + evidence jsonb.
 *   - rlvrCuratedExamples    → (prompt, completion, reward) tuples
 *                              produced by the curator; `included`
 *                              and `exclusion_reason` are mutually
 *                              exclusive.
 *
 * All four tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). Consumed by `@borjie/post-training-rlvr`.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  real,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// rlvr_runs — one row per end-to-end RLVR pipeline run
// ============================================================================

export const rlvrRuns = pgTable(
  'rlvr_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** tra_filings | royalty_audits | brand_compliance | citation_grounding | mixed | synthetic_test */
    kind: text('kind').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** pending | running | verifying | curating | redacting | ready_for_handoff | handed_off | completed | cancelled | failed */
    status: text('status').notNull().default('pending'),
    /** Array of verifier names this run consults. */
    verifierSet: text('verifier_set').array().notNull().default([]),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_rlvr_runs_tenant').on(
      table.tenantId,
      table.startedAt,
    ),
    statusIdx: index('idx_rlvr_runs_status').on(
      table.tenantId,
      table.status,
      table.startedAt,
    ),
  }),
);

// ============================================================================
// rlvr_traces — captured Mr. Mwikila traces (raw + redacted)
// ============================================================================

export const rlvrTraces = pgTable(
  'rlvr_traces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rlvrRunId: uuid('rlvr_run_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** Raw trace — may contain PII. NEVER leaves tenant boundary. */
    trace: jsonb('trace').notNull(),
    /** Salted-hashed copy. The only form permitted for external handoff. */
    tenantRedactedTrace: jsonb('tenant_redacted_trace'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    runIdx: index('idx_rlvr_traces_run').on(table.rlvrRunId, table.capturedAt),
    tenantIdx: index('idx_rlvr_traces_tenant').on(
      table.tenantId,
      table.capturedAt,
    ),
  }),
);

// ============================================================================
// rlvr_verifications — per-(trace, verifier) verdict
// ============================================================================

export const rlvrVerifications = pgTable(
  'rlvr_verifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rlvrTraceId: uuid('rlvr_trace_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** Stable verifier identifier (e.g. 'citation-resolves', 'tra-schema'). */
    verifierName: text('verifier_name').notNull(),
    /** pass | fail | partial | skip */
    verdict: text('verdict').notNull(),
    /** Scalar reward in [0, 1]. */
    reward: real('reward').notNull().default(0),
    /** Verifier-specific evidence (URL status, schema issues, etc.). */
    evidence: jsonb('evidence').notNull().default({}),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    traceIdx: index('idx_rlvr_verifications_trace').on(
      table.rlvrTraceId,
      table.verifierName,
    ),
    verdictIdx: index('idx_rlvr_verifications_verdict').on(
      table.tenantId,
      table.verdict,
      table.verifiedAt,
    ),
  }),
);

// ============================================================================
// rlvr_curated_examples — post-curation training examples
// ============================================================================

export const rlvrCuratedExamples = pgTable(
  'rlvr_curated_examples',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    rlvrRunId: uuid('rlvr_run_id').notNull(),
    rlvrTraceId: uuid('rlvr_trace_id'),
    tenantId: text('tenant_id').notNull(),
    /** Redacted prompt jsonb — never raw PII. */
    prompt: jsonb('prompt').notNull(),
    /** Redacted completion jsonb. */
    completion: jsonb('completion').notNull(),
    reward: real('reward').notNull().default(0),
    included: boolean('included').notNull().default(false),
    /** Required IFF included = false. */
    exclusionReason: text('exclusion_reason'),
    curatedAt: timestamp('curated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    runIdx: index('idx_rlvr_curated_run').on(
      table.rlvrRunId,
      table.included,
      table.curatedAt,
    ),
    tenantIdx: index('idx_rlvr_curated_tenant').on(
      table.tenantId,
      table.included,
      table.curatedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type RlvrRunRow = typeof rlvrRuns.$inferSelect;
export type NewRlvrRunRow = typeof rlvrRuns.$inferInsert;

export type RlvrTraceRow = typeof rlvrTraces.$inferSelect;
export type NewRlvrTraceRow = typeof rlvrTraces.$inferInsert;

export type RlvrVerificationRow = typeof rlvrVerifications.$inferSelect;
export type NewRlvrVerificationRow = typeof rlvrVerifications.$inferInsert;

export type RlvrCuratedExampleRow = typeof rlvrCuratedExamples.$inferSelect;
export type NewRlvrCuratedExampleRow = typeof rlvrCuratedExamples.$inferInsert;
