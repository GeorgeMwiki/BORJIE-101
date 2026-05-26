/**
 * Linear connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `linear_records` table. Stores issues, projects, cycles, and
 * comments under one schema, keyed by `entity_kind`.
 *
 * Tenant-scoped. RLS via `app.tenant_id`.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const linearRecords = pgTable(
  'linear_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Linear team key (workspace-scope). */
    account: text('account').notNull(),
    /** `issue` | `project` | `cycle` | `comment`. */
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    fields: jsonb('fields').notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantUpdatedIdx: index('idx_linear_records_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
    uq: uniqueIndex('linear_records_uq').on(
      t.tenantId,
      t.account,
      t.entityKind,
      t.entityId,
    ),
  }),
);

export type LinearRecord = typeof linearRecords.$inferSelect;
export type NewLinearRecord = typeof linearRecords.$inferInsert;
