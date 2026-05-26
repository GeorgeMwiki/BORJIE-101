/**
 * GitHub connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `github_records` table. Stores repos, PRs, issues, releases keyed
 * by `entity_kind`.
 *
 * Distinct from junior-spawner's GitHub touchpoints — this connector
 * carries the audit-hash chain for full ingest provenance.
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

export const githubRecords = pgTable(
  'github_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** GitHub org or user login. */
    account: text('account').notNull(),
    /** `repo` | `pull_request` | `issue` | `release`. */
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
    tenantUpdatedIdx: index('idx_github_records_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
    uq: uniqueIndex('github_records_uq').on(
      t.tenantId,
      t.account,
      t.entityKind,
      t.entityId,
    ),
  }),
);

export type GithubRecord = typeof githubRecords.$inferSelect;
export type NewGithubRecord = typeof githubRecords.$inferInsert;
