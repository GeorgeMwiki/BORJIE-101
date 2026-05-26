/**
 * HubSpot connector persistence — Wave OMNI-P1.
 *
 * Companion to migration 0046_omni_p1.sql. Drizzle types for the
 * `hubspot_records` table.
 *
 * Tenant-scoped. RLS via the canonical `app.tenant_id` GUC policy.
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

export const hubspotRecords = pgTable(
  'hubspot_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** HubSpot portal id. */
    account: text('account').notNull(),
    /** CRM object kind — `contacts`, `deals`, `tickets`, `marketing_emails`. */
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    /** Selected, salted-hash-redacted properties from `raw`. */
    properties: jsonb('properties').notNull().default({}),
    /** `hs_lastmodifieddate` watermark. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    raw: jsonb('raw').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantUpdatedIdx: index('idx_hubspot_records_tenant_updated').on(
      t.tenantId,
      t.updatedAt,
    ),
    uq: uniqueIndex('hubspot_records_uq').on(
      t.tenantId,
      t.account,
      t.objectType,
      t.objectId,
    ),
  }),
);

export type HubspotRecord = typeof hubspotRecords.$inferSelect;
export type NewHubspotRecord = typeof hubspotRecords.$inferInsert;
