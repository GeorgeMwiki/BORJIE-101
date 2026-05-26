/**
 * Information Synthesis SOTA persistence (Wave M7).
 *
 * Companion to Docs/DESIGN/INFORMATION_SYNTHESIS_SOTA_SPEC.md. Drizzle
 * types for the 2 tables created by migration 0038_info_synthesis.sql:
 *
 *   - synthRuns     → one row per pipeline invocation: tenant, query,
 *                     corpus identifiers, lifecycle status, hash chain.
 *   - synthOutputs  → one row per synthesis output produced by a run:
 *                     the rendered text, structured citations,
 *                     calibrated confidence, detected disagreements.
 *
 * Both tables are tenant-scoped via the canonical `app.tenant_id` GUC
 * RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  real,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// synth_runs — pipeline invocation ledger
// ============================================================================

export const synthRuns = pgTable(
  'synth_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    /** Artifact identifiers (text[]) supplied as the synthesizer corpus. */
    corpusIds: text('corpus_ids').array().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** pending | running | succeeded | failed. */
    status: text('status').notNull().default('pending'),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (t) => ({
    tenantRecentIdx: index('idx_synth_runs_tenant_recent').on(
      t.tenantId,
      t.startedAt,
    ),
    statusIdx: index('idx_synth_runs_status').on(
      t.tenantId,
      t.status,
      t.startedAt,
    ),
    auditHashIdx: index('idx_synth_runs_audit_hash').on(t.auditHash),
  }),
);

export type SynthRunRow = typeof synthRuns.$inferSelect;
export type SynthRunInsert = typeof synthRuns.$inferInsert;

// ============================================================================
// synth_outputs — one row per emitted synthesis
// ============================================================================

export const synthOutputs = pgTable(
  'synth_outputs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    synthRunId: uuid('synth_run_id')
      .notNull()
      .references(() => synthRuns.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Rendered synthesis body — markdown by convention. */
    output: text('output').notNull(),
    /** SpanCitation[]: the per-claim source anchors. */
    citations: jsonb('citations').notNull().default([]),
    /** Calibrated 0..1 confidence — Brier/ECE-adjusted. */
    calibratedConfidence: real('calibrated_confidence').notNull().default(0),
    /** Disagreement[]: cluster-level contradictions surfaced separately. */
    disagreements: jsonb('disagreements').notNull().default([]),
    auditHash: text('audit_hash').notNull(),
    emittedAt: timestamp('emitted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    runIdx: index('idx_synth_outputs_run').on(t.synthRunId, t.emittedAt),
    tenantRecentIdx: index('idx_synth_outputs_tenant_recent').on(
      t.tenantId,
      t.emittedAt,
    ),
    auditHashIdx: index('idx_synth_outputs_audit_hash').on(t.auditHash),
  }),
);

export type SynthOutputRow = typeof synthOutputs.$inferSelect;
export type SynthOutputInsert = typeof synthOutputs.$inferInsert;
