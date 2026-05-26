/**
 * Salesforce connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `salesforce_records` table.
 *
 * Tenant-scoped. RLS via the canonical `app.tenant_id` GUC policy.
 * The shared `connector_credentials` / `connector_cursors` tables
 * (migration 0042) carry tokens and watermarks — this table only
 * carries ingested SObject content.
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

export const salesforceRecords = pgTable(
  'salesforce_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Borjie tenant — RLS scope. */
    tenantId: text('tenant_id').notNull(),
    /** Salesforce org id. One tenant may connect multiple orgs. */
    account: text('account').notNull(),
    /** SObject API name — `Account`, `Opportunity`, `Contact`, `Case`. */
    sobjectType: text('sobject_type').notNull(),
    /** Salesforce 18-char id. */
    sobjectId: text('sobject_id').notNull(),
    /** Selected, salted-hash-redacted fields lifted from `raw`. */
    fields: jsonb('fields').notNull().default({}),
    /** SOQL cursor — drives the next polling watermark. */
    lastModifiedDate: timestamp('last_modified_date', {
      withTimezone: true,
    }).notNull(),
    /** Immutable upstream payload after PII redaction. */
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** SHA-256 chained into ai_audit_chain. */
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantLmdIdx: index('idx_salesforce_records_tenant_lmd').on(
      t.tenantId,
      t.lastModifiedDate,
    ),
    uq: uniqueIndex('salesforce_records_uq').on(
      t.tenantId,
      t.account,
      t.sobjectType,
      t.sobjectId,
    ),
  }),
);

export type SalesforceRecord = typeof salesforceRecords.$inferSelect;
export type NewSalesforceRecord = typeof salesforceRecords.$inferInsert;
