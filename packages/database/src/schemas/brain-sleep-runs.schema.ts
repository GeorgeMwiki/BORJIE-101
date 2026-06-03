/**
 * Brain sleep-pass durability — migration 0276 (LP-21a).
 *
 * Two SYSTEM tables backing `services/sleep-pass-orchestrator`'s durable
 * run + emission audit trail, replacing the old in-memory `Map`:
 *
 *   brain_sleep_runs       one row per pass invocation (running → done |
 *                          failed | timeout | skipped), with item counts,
 *                          duration, notes + error text. The freshest
 *                          started_at drives the per-pass min-interval skip;
 *                          stale 'running' rows are reaped (presumed crash).
 *   brain_sleep_emissions  one row per "thing the brain dreamed about", FK →
 *                          run_id ON DELETE CASCADE; emission_jsonb is the
 *                          verbatim payload surfaced by the admin browse route.
 *
 * Security model: these are cross-tenant brain-job rows written under the
 * service-role connection — there is NO `app.current_tenant_id` GUC. tenant_id
 * is nullable and is NOT the isolation mechanism. Both tables have RLS
 * FORCE-enabled with a permissive service-managed policy (mirrors migration
 * 0188 / Supabase auth.* tables); isolation comes from REVOKE ALL on
 * anon/authenticated so the rows are never served over the public PostgREST API.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ─── Table 1: brain_sleep_runs ────────────────────────────────────────────────

export const brainSleepRuns = pgTable(
  'brain_sleep_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable kebab-case pass id, e.g. 'dead-letter-replay'. */
    passId: text('pass_id').notNull(),
    /** NULL for platform-wide passes; set when a pass is tenant-scoped. */
    tenantId: text('tenant_id'),
    /** 'running' | 'done' | 'failed' | 'timeout' | 'skipped' (DB CHECK). */
    status: text('status').notNull().default('running'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    itemsEmitted: integer('items_emitted').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    notesText: text('notes_text'),
    errorText: text('error_text'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    /** Freshest run for a pass — min-interval skip + stuck-row reap. */
    passStartedIdx: index('idx_brain_sleep_runs_pass_started').on(
      t.passId,
      t.startedAt,
    ),
  }),
);

export type BrainSleepRunRow = typeof brainSleepRuns.$inferSelect;
export type NewBrainSleepRunRow = typeof brainSleepRuns.$inferInsert;

// ─── Table 2: brain_sleep_emissions ──────────────────────────────────────────

export const brainSleepEmissions = pgTable(
  'brain_sleep_emissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** FK → brain_sleep_runs(id) ON DELETE CASCADE. */
    runId: uuid('run_id')
      .notNull()
      .references(() => brainSleepRuns.id, { onDelete: 'cascade' }),
    /** Kebab-case emission kind: 'lesson', 'nudge', 'counterfactual', … */
    emissionKind: text('emission_kind').notNull(),
    /** Verbatim emission payload. */
    emissionJsonb: jsonb('emission_jsonb').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** All emissions for a run, newest first. */
    runIdx: index('idx_brain_sleep_emissions_run').on(t.runId, t.createdAt),
  }),
);

export type BrainSleepEmissionRow = typeof brainSleepEmissions.$inferSelect;
export type NewBrainSleepEmissionRow = typeof brainSleepEmissions.$inferInsert;
