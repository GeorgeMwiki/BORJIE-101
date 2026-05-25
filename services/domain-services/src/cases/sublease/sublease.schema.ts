/**
 * Drizzle schema for sublease_requests + tenant_groups.
 * Mirrors migration 0017. Spec: MISSING_FEATURES_DESIGN.md §7.
 */

import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';

export const subleaseRequests = pgTable(
  'sublease_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    parentLeaseId: text('parent_lease_id').notNull(),
    requestedBy: text('requested_by').notNull(),
    subtenantCandidateId: text('subtenant_candidate_id'),
    reason: text('reason'),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),

    rentResponsibility: text('rent_responsibility').notNull().default('primary_tenant'),
    splitPercent: jsonb('split_percent'),

    status: text('status').notNull().default('pending'),
    approvalRequestId: text('approval_request_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (t) => ({
    tenantIdx: index('sublease_requests_tenant_idx').on(t.tenantId),
    parentIdx: index('sublease_requests_parent_idx').on(t.parentLeaseId),
    requestedByIdx: index('sublease_requests_requested_by_idx').on(t.requestedBy),
    statusIdx: index('sublease_requests_status_idx').on(t.status),
  })
);

export const tenantGroups = pgTable(
  'tenant_groups',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    primaryLeaseId: text('primary_lease_id').notNull(),
    members: jsonb('members').notNull().default([]),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
  },
  (t) => ({
    tenantIdx: index('tenant_groups_tenant_idx').on(t.tenantId),
    primaryLeaseIdx: index('tenant_groups_primary_lease_idx').on(t.primaryLeaseId),
  })
);
