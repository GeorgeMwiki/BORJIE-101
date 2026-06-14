/**
 * marketing_contact_submissions — inbound marketing-site contact-form
 * inquiries persisted from `POST /api/v1/marketing/contact`.
 *
 * Closes KI-013 (the FE /api/contact handler forwarded to a gateway
 * endpoint that did not exist). Public-write, SUPER_ADMIN-read via RLS
 * (`marketing_contact_submissions_insert` /
 * `marketing_contact_submissions_select_super_admin`), mirroring
 * marketing_pilot_applications.
 *
 * Migration 0359.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const marketingContactSubmissions = pgTable(
  'marketing_contact_submissions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    org: text('org').notNull().default(''),
    kind: text('kind').notNull().default('general'),
    message: text('message').notNull(),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('idx_marketing_contact_submissions_created_at').on(
      t.createdAt,
    ),
  }),
);

export type MarketingContactSubmission =
  typeof marketingContactSubmissions.$inferSelect;
export type NewMarketingContactSubmission =
  typeof marketingContactSubmissions.$inferInsert;
