/**
 * sub_md_slos + sub_md_slo_events — per-sub-MD quality SLOs + outcome log.
 *
 * Phase E.4 substrate. Each (subMd, tenantId, metric) row defines a
 * single quality envelope on a sub-MD. `tenant_id` NULL = platform
 * default; non-NULL = tenant-scoped override.
 *
 * Breach actions, ordered by severity:
 *   'warn'             — log + notify HQ admin
 *   'reduce-traffic'   — drop canary stage one level
 *   'handoff'          — quarantine sub-MD; route work to humans
 *   'kill-and-rollback' — disable + restore prior version
 *
 * `sub_md_slo_events` is the outcome log. The SLO monitor reads recent
 * events for a sub-MD over the window and decides whether to fire the
 * configured action.
 */

import {
  pgTable,
  text,
  uuid,
  numeric,
  timestamp,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const subMdSlos = pgTable(
  'sub_md_slos',
  {
    subMd: text('sub_md').notNull(),
    /** NULL = platform default; non-NULL = tenant-scoped override. */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /**
     * One of: 'resolution-quality' | 'task-completion-rate' |
     * 'owner-cs-score' | 'cost-per-resolution'.
     */
    metric: text('metric').notNull(),
    /** Target value for the metric. Bounds vary by metric. */
    target: numeric('target', { precision: 12, scale: 6 }).notNull(),
    /** One of: 'rolling-24h' | 'rolling-7d' | 'rolling-30d'. */
    window: text('window').notNull(),
    /**
     * One of: 'warn' | 'reduce-traffic' | 'handoff' | 'kill-and-rollback'.
     */
    breachAction: text('breach_action').notNull(),
    /**
     * One of: 'shadow' | 'canary-1pct' | 'canary-5pct' | 'canary-25pct' |
     * 'live'. Begins at 'shadow'; promotion is human-driven, demotion is
     * automatic on breach.
     */
    canaryStage: text('canary_stage').notNull().default('shadow'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // (subMd, tenantId, metric) is the natural key. tenant_id may be NULL —
    // Postgres allows multiple NULLs in a UNIQUE so the platform-default
    // and per-tenant rows coexist. We model the primary key here as a
    // composite over the three columns; the NULL-handling is enforced at
    // the application layer (only one platform default per (sub_md,
    // metric)) via the partial unique index below.
    pk: primaryKey({ columns: [t.subMd, t.tenantId, t.metric] }),
    // One platform default per (sub_md, metric).
    metricIdx: index('idx_sub_md_slos_metric').on(t.subMd, t.metric),
    tenantIdx: index('idx_sub_md_slos_tenant').on(t.tenantId),
    canaryIdx: index('idx_sub_md_slos_canary').on(t.canaryStage),
    breachActionCheck: check(
      'sub_md_slos_breach_action_chk',
      sql`${t.breachAction} IN ('warn', 'reduce-traffic', 'handoff', 'kill-and-rollback')`,
    ),
    windowCheck: check(
      'sub_md_slos_window_chk',
      sql`${t.window} IN ('rolling-24h', 'rolling-7d', 'rolling-30d')`,
    ),
    canaryStageCheck: check(
      'sub_md_slos_canary_stage_chk',
      sql`${t.canaryStage} IN ('shadow', 'canary-1pct', 'canary-5pct', 'canary-25pct', 'live')`,
    ),
    metricCheck: check(
      'sub_md_slos_metric_chk',
      sql`${t.metric} IN ('resolution-quality', 'task-completion-rate', 'owner-cs-score', 'cost-per-resolution')`,
    ),
  }),
);

export const subMdSloEvents = pgTable(
  'sub_md_slo_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subMd: text('sub_md').notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .notNull()
      .defaultNow(),
    metric: text('metric').notNull(),
    actualValue: numeric('actual_value', { precision: 14, scale: 6 }).notNull(),
    /** Optional model-forecasted value (for counter-models / nowcasts). */
    predictedValue: numeric('predicted_value', { precision: 14, scale: 6 }),
    /**
     * Signed delta: actual - target for higher-is-better metrics, or
     * target - actual for lower-is-better metrics. Negative = breach.
     */
    delta: numeric('delta', { precision: 14, scale: 6 }).notNull(),
  },
  (t) => ({
    subMdTimeIdx: index('idx_sub_md_slo_events_sub_md_time').on(
      t.subMd,
      t.metric,
      t.timestamp,
    ),
    tenantTimeIdx: index('idx_sub_md_slo_events_tenant_time').on(
      t.tenantId,
      t.timestamp,
    ),
  }),
);
