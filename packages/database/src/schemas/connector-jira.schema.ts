/**
 * Jira connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `jira_records` table. Stores issues, epics, sprints, worklogs
 * keyed by `entity_kind`.
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

export const jiraRecords = pgTable(
  'jira_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Atlassian site cloud-id or Server base URL. */
    account: text('account').notNull(),
    /** `issue` | `epic` | `sprint` | `worklog`. */
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
    tenantUpdatedIdx: index('idx_jira_records_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
    uq: uniqueIndex('jira_records_uq').on(
      t.tenantId,
      t.account,
      t.entityKind,
      t.entityId,
    ),
  }),
);

export type JiraRecord = typeof jiraRecords.$inferSelect;
export type NewJiraRecord = typeof jiraRecords.$inferInsert;
