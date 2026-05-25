/**
 * Org-awareness schema — Organizational Awareness layer.
 *
 * Mirrors migrations:
 *   - 0085_process_observations.sql
 *   - 0086_bottlenecks.sql
 *   - 0087_improvement_snapshots.sql
 *
 * Three additive tables:
 *   - `process_observations`   append-only time-series of process-stage events
 *   - `bottlenecks`            detected bottlenecks per tenant
 *   - `improvement_snapshots`  per-period metric snapshots for before/after
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  bigint,
  doublePrecision,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const processObservations = pgTable(
  'process_observations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    processKind: text('process_kind').notNull(),
    processInstanceId: text('process_instance_id').notNull(),
    stage: text('stage').notNull(),
    previousStage: text('previous_stage'),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id'),
    variant: text('variant').notNull().default('standard'),
    isReopen: boolean('is_reopen').notNull().default(false),
    isStuck: boolean('is_stuck').notNull().default(false),
    durationMsFromPrevious: bigint('duration_ms_from_previous', {
      mode: 'number',
    }),
    metadata: jsonb('metadata').notNull().default({}),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKindStageIdx: index('idx_process_obs_tenant_kind_stage').on(
      table.tenantId,
      table.processKind,
      table.stage,
    ),
    instanceIdx: index('idx_process_obs_instance').on(
      table.tenantId,
      table.processKind,
      table.processInstanceId,
    ),
  }),
);

export const bottlenecks = pgTable(
  'bottlenecks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    processKind: text('process_kind').notNull(),
    stage: text('stage').notNull(),
    bottleneckKind: text('bottleneck_kind').notNull(),
    severity: text('severity').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    suggestedRemediation: text('suggested_remediation'),
    status: text('status').notNull().default('open'),
    firstDetectedAt: timestamp('first_detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cooldownUntil: timestamp('cooldown_until', { withTimezone: true }),
  },
  (table) => ({
    tenantOpenIdx: index('idx_bottlenecks_tenant_open').on(
      table.tenantId,
      table.status,
      table.severity,
    ),
    kindIdx: index('idx_bottlenecks_kind').on(
      table.tenantId,
      table.processKind,
      table.stage,
      table.status,
    ),
  }),
);

export const improvementSnapshots = pgTable(
  'improvement_snapshots',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    periodKind: text('period_kind').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    value: doublePrecision('value').notNull(),
    sampleSize: integer('sample_size').notNull().default(0),
    confidenceLow: doublePrecision('confidence_low'),
    confidenceHigh: doublePrecision('confidence_high'),
    isBaseline: boolean('is_baseline').notNull().default(false),
    evidence: jsonb('evidence').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqPerPeriod: uniqueIndex('uq_improvement_snapshots').on(
      table.tenantId,
      table.metric,
      table.periodKind,
      table.periodStart,
    ),
    tenantMetricIdx: index('idx_improvement_snapshots_tenant_metric').on(
      table.tenantId,
      table.metric,
      table.periodStart,
    ),
  }),
);

export type ProcessObservationRow = typeof processObservations.$inferSelect;
export type NewProcessObservationRow =
  typeof processObservations.$inferInsert;
export type BottleneckRow = typeof bottlenecks.$inferSelect;
export type NewBottleneckRow = typeof bottlenecks.$inferInsert;
export type ImprovementSnapshotRow =
  typeof improvementSnapshots.$inferSelect;
export type NewImprovementSnapshotRow =
  typeof improvementSnapshots.$inferInsert;
