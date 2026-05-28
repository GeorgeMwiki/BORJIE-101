/**
 * external_party_engagements — timeline of interactions per
 * counterparty / site. Powers the engagement log surfaced inside the
 * counterparty drawer.
 *
 * Companion to:
 *   - packages/database/src/migrations/0093_full_mining_operations_scope.sql
 *   - services/api-gateway/src/routes/ops/engagements.hono.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const externalPartyEngagements = pgTable(
  'external_party_engagements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    partyId: uuid('party_id').notNull(),
    siteId: text('site_id'),
    /** meeting | inspection | shipment | payment | application |
     *  dispute | community_event | audit | site_visit | document_request |
     *  other. */
    kind: text('kind').notNull(),
    status: text('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    summary: text('summary').notNull(),
    docLinks: jsonb('doc_links').notNull().default([]),
    auditHashId: uuid('audit_hash_id'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    partyOpenedIdx: index('idx_epe_party_opened').on(t.partyId, t.openedAt),
    tenantStatusIdx: index('idx_epe_tenant_status').on(
      t.tenantId,
      t.status,
      t.openedAt,
    ),
  }),
);

export type ExternalPartyEngagement =
  typeof externalPartyEngagements.$inferSelect;
export type NewExternalPartyEngagement =
  typeof externalPartyEngagements.$inferInsert;

export const ENGAGEMENT_KINDS = [
  'meeting',
  'inspection',
  'shipment',
  'payment',
  'application',
  'dispute',
  'community_event',
  'audit',
  'site_visit',
  'document_request',
  'other',
] as const;
export type EngagementKind = (typeof ENGAGEMENT_KINDS)[number];

export const ENGAGEMENT_STATUSES = [
  'open',
  'in_progress',
  'closed',
  'cancelled',
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];
