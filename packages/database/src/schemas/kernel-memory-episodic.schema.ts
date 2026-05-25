/**
 * Kernel memory — episodic store.
 *
 * Concrete past events: "On 2026-04-12 the user asked me about lease
 * L-417." Tied to a specific (threadId, turnId). TTL-able (default 90
 * days). Per-(tenant, user) scoped.
 *
 * The kernel writes one row per user-message and one per agent-action
 * inside a turn (fire-and-forget). The reflective consolidation cycle
 * agent reads-aggregates-purges this table.
 *
 * Companion to LITFIN's `episodic-store.ts` shape. This is the Borjie
 * multi-tenant variant: every row carries a tenantId so the store is
 * cleanly isolatable and droppable per tenant.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const kernelMemoryEpisodicKindEnum = pgEnum('kernel_memory_episodic_kind', [
  'user-message',
  'agent-action',
  'tool-result',
]);

export const kernelMemoryEpisodic = pgTable(
  'kernel_memory_episodic',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').notNull(),
    threadId: text('thread_id').notNull(),
    turnId: text('turn_id').notNull(),
    kind: kernelMemoryEpisodicKindEnum('kind').notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload').notNull().default({}),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    tenantUserTimeIdx: index('idx_kernel_mem_episodic_tenant_user_time').on(
      t.tenantId,
      t.userId,
      t.capturedAt,
    ),
    threadIdx: index('idx_kernel_mem_episodic_thread').on(t.threadId),
    expiresIdx: index('idx_kernel_mem_episodic_expires').on(t.expiresAt),
  }),
);
