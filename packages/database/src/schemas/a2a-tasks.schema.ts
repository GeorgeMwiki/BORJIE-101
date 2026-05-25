/**
 * a2a_tasks — Drizzle schema (migration 0168).
 *
 * Persistent backing for the `TaskStore` port declared in
 * `packages/agent-platform/src/a2a/task-lifecycle.ts`. Each row is the
 * canonical record for one A2A v1.0 task. Status transitions:
 *
 *     submitted -> working -> { completed | failed | canceled }
 *
 * The in-memory store stays the default; this adapter is opt-in at the
 * agent-platform composition root.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - tenant_id mandatory ⇒ multi-tenant isolation enforced at the SQL
 *     layer (pairs with RLS migration 0155). The A2A spec itself
 *     doesn't include a tenant — we add it on the adapter side so a
 *     compromised session_id can't be replayed across tenants.
 *   - `message` + `artifacts` carry user-facing content; the host is
 *     responsible for PII review before passing them to the adapter
 *     (the kernel's PII-redaction pass runs upstream).
 *   - `error` is bounded to 4_000 chars to keep replayable logs small
 *     and bounded for export under DSAR.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const a2aTasks = pgTable(
  'a2a_tasks',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    /** Multi-tenant isolation. Adapter requires tenantId in put/get/list. */
    tenantId: text('tenant_id').notNull(),
    status: text('status').notNull(),
    /** Original user → agent message; frozen JSON. */
    message: jsonb('message').notNull(),
    /** Append-only artifacts list; frozen JSON. */
    artifacts: jsonb('artifacts').notNull().default([]),
    error: text('error'),
    /** ISO-8601 createdAt — task creation time. */
    createdAtIso: text('created_at_iso').notNull(),
    /** ISO-8601 updatedAt — last state transition. */
    updatedAtIso: text('updated_at_iso').notNull(),
    /** Insertion timestamp — useful for retention sweeps. */
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionTenantIdx: index('idx_a2a_tasks_tenant_session').on(
      t.tenantId,
      t.sessionId,
    ),
    statusIdx: index('idx_a2a_tasks_status').on(t.status),
  }),
);

export type A2aTaskRow = typeof a2aTasks.$inferSelect;
export type NewA2aTaskRow = typeof a2aTasks.$inferInsert;
