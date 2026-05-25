/**
 * Kernel memory — procedural store.
 *
 * Recurring workflows the user does: "User typically pulls the arrears
 * report on Mondays." Records the tool-sequence pattern + trigger
 * keywords + invocations / successes counts so the kernel can match
 * future user messages to known patterns and rank suggestions by
 * historical success rate.
 *
 * Per-(tenant, user) scoped. The composite UNIQUE on (tenant_id,
 * user_id, pattern_name) allows idempotent upserts that bump invocations
 * and successes without duplicating rows.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const kernelMemoryProcedural = pgTable(
  'kernel_memory_procedural',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').notNull(),
    patternName: text('pattern_name').notNull(),
    /** Ordered array of tool names — the canonical sequence for this pattern. */
    toolSequence: jsonb('tool_sequence').notNull().default([]),
    /** Lower-cased trigger words / phrases. Matching uses overlap count. */
    triggerKeywords: jsonb('trigger_keywords').notNull().default([]),
    invocations: integer('invocations').notNull().default(0),
    successes: integer('successes').notNull().default(0),
    lastInvokedAt: timestamp('last_invoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantUserPatternIdx: uniqueIndex(
      'uniq_kernel_mem_procedural_tenant_user_pattern',
    ).on(t.tenantId, t.userId, t.patternName),
    tenantUserIdx: index('idx_kernel_mem_procedural_tenant_user').on(
      t.tenantId,
      t.userId,
    ),
  }),
);
