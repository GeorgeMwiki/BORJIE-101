/**
 * GitLab connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `gitlab_records` table.
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

export const gitlabRecords = pgTable(
  'gitlab_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** GitLab group path (self-hosted base URL allowed). */
    account: text('account').notNull(),
    /** `project` | `merge_request` | `issue` | `pipeline`. */
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
    tenantUpdatedIdx: index('idx_gitlab_records_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
    uq: uniqueIndex('gitlab_records_uq').on(
      t.tenantId,
      t.account,
      t.entityKind,
      t.entityId,
    ),
  }),
);

export type GitlabRecord = typeof gitlabRecords.$inferSelect;
export type NewGitlabRecord = typeof gitlabRecords.$inferInsert;
