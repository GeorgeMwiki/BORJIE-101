/**
 * Kernel memory — reflective store.
 *
 * Periodic summaries: "Weekly digest: user asked 14 times about
 * vacancy this week, sentiment trending negative." Aggregated by the
 * separate consolidation cycle agent on daily / weekly / monthly
 * cadences. This file provides only the storage contract; the
 * consolidation cycle owns the population logic.
 *
 * Per-(tenant, user) AND per-tenant variants share the same table:
 * tenant-wide digests have user_id = NULL.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  real,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const kernelMemoryReflectivePeriodEnum = pgEnum(
  'kernel_memory_reflective_period',
  ['daily', 'weekly', 'monthly'],
);

export const kernelMemoryReflective = pgTable(
  'kernel_memory_reflective',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Null for tenant-wide rollups. */
    userId: text('user_id'),
    periodKind: kernelMemoryReflectivePeriodEnum('period_kind').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    /** Array of `{ topic: string; count: number }`. */
    topTopics: jsonb('top_topics').notNull().default([]),
    /** Mean sentiment for the period in [-1, 1]. */
    sentimentAvg: real('sentiment_avg'),
    /** Array of action-item strings. */
    actionItems: jsonb('action_items').notNull().default([]),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserPeriodIdx: index(
      'idx_kernel_mem_reflective_tenant_user_period_start',
    ).on(t.tenantId, t.userId, t.periodKind, t.periodStart),
  }),
);
