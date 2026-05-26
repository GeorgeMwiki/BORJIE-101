/**
 * wave_progress + wave_revival_attempts — durable orchestration tables
 * for the wave-resilience-manager service.
 *
 * Spec: Docs/DESIGN/AGENT_SELF_REVIVAL_SPEC.md (Wave 18DD).
 * Migration: drizzle/0059_wave_resilience.sql (renumbered from 0029 to
 * resolve collision with 0029_cognitive_memory.sql; alphabetic precedence
 * keeps cognitive_memory at slot 0029).
 *
 * Platform-level tables — no RLS, no tenant scoping. Access is
 * restricted at the application layer by API key.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  date,
  index,
  primaryKey,
  unique,
} from 'drizzle-orm/pg-core';

/**
 * Append-only per-checkpoint ledger for agent waves.
 *
 * One row per status transition / checkpoint. Each row is sealed via
 * `@borjie/audit-hash-chain` (`audit_hash` chains back to the previous
 * row's hash).
 */
export const waveProgress = pgTable(
  'wave_progress',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    waveId: text('wave_id').notNull(),
    agentId: text('agent_id').notNull(),
    /** Null for platform-level waves (most resilience-tracked waves). */
    tenantId: text('tenant_id'),
    status: text('status').notNull().default('dispatched'),
    checkpointSeq: integer('checkpoint_seq').notNull().default(0),
    checkpointLabel: text('checkpoint_label'),
    checkpointPayload: jsonb('checkpoint_payload'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    waveRecentIdx: index('idx_wp_wave_recent').on(t.waveId, t.createdAt),
    statusIdx: index('idx_wp_status').on(t.status, t.heartbeatAt),
  }),
);

/**
 * One row per (wave_id, attempt_number). Tracks the lifecycle of each
 * automated revival attempt.
 *
 * `outcome` values: 'completed' | 'crashed_again' | 'gave_up'. NULL
 * means the attempt is still in flight (resumed_at is set, completed_at
 * is not).
 */
export const waveRevivalAttempts = pgTable(
  'wave_revival_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    waveId: text('wave_id').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    originalDispatchAt: timestamp('original_dispatch_at', {
      withTimezone: true,
    }).notNull(),
    crashedAt: timestamp('crashed_at', { withTimezone: true }).notNull(),
    resumedAt: timestamp('resumed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    outcome: text('outcome'),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    waveIdx: index('idx_wra_wave').on(t.waveId, t.attemptNumber),
    waveAttemptUq: unique('wave_revival_attempts_unique').on(
      t.waveId,
      t.attemptNumber,
    ),
  }),
);

export type WaveProgressRow = typeof waveProgress.$inferSelect;
export type NewWaveProgressRow = typeof waveProgress.$inferInsert;
export type WaveRevivalAttemptRow = typeof waveRevivalAttempts.$inferSelect;
export type NewWaveRevivalAttemptRow = typeof waveRevivalAttempts.$inferInsert;

/**
 * Per-day per-tenant revival-attempt counter (Wave 18DD-config, founder
 * decision #5). Composite PK on (attempted_on, tenant_id_norm) where
 * `tenant_id_norm` is the COALESCE(tenant_id, '') generated column —
 * collapsing NULL → '' lets the platform-wide aggregate row share the
 * same uniqueness guarantee as tenant-scoped rows.
 *
 * Migration: drizzle/0032_wave_resilience_daily_counter.sql.
 */
export const dailyRevivalCounters = pgTable(
  'daily_revival_counters',
  {
    attemptedOn: date('attempted_on').notNull(),
    /** NULL = platform-wide aggregate row. */
    tenantId: text('tenant_id'),
    tenantIdNorm: text('tenant_id_norm')
      .notNull()
      .generatedAlwaysAs(sql`COALESCE(tenant_id, '')`),
    attemptCount: integer('attempt_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      name: 'daily_revival_counters_pk',
      columns: [t.attemptedOn, t.tenantIdNorm],
    }),
    todayIdx: index('idx_drc_today').on(t.attemptedOn),
  }),
);

export type DailyRevivalCounterRow = typeof dailyRevivalCounters.$inferSelect;
export type NewDailyRevivalCounterRow =
  typeof dailyRevivalCounters.$inferInsert;
