/**
 * GDPR deletion requests — Wave 9 enterprise polish.
 *
 * Tenant admins lodge a deletion request for a customer; super-admins
 * execute it (pseudonymizes PII across linked tables while preserving
 * referential integrity for aggregate reporting).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const gdprDeletionRequests = pgTable(
  'gdpr_deletion_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerId: text('customer_id').notNull(),
    status: text('status').notNull().default('pending'),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    executedBy: text('executed_by'),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    pseudonymId: text('pseudonym_id'),
    affectedTables: jsonb('affected_tables').notNull().default([]),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantIdx: index('idx_gdpr_reqs_tenant').on(table.tenantId),
    customerIdx: index('idx_gdpr_reqs_customer').on(
      table.tenantId,
      table.customerId,
    ),
    statusIdx: index('idx_gdpr_reqs_status').on(table.status),
  }),
);
