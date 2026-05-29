/**
 * marketing_pilot_applications — inbound marketing-site pilot leads
 * persisted from `POST /api/v1/marketing/pilot-application`.
 *
 * Closes R24 (KI-MARKETING-1). Public-write, SUPER_ADMIN-read via
 * RLS policy (`pilot_app_insert` / `pilot_app_select_super_admin`).
 *
 * Migration 0146.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const marketingPilotApplications = pgTable(
  'marketing_pilot_applications',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    company: text('company').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    portfolioSize: integer('portfolio_size').notNull(),
    mineralFocus: text('mineral_focus').notNull(),
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
    createdAtIdx: index('idx_marketing_pilot_applications_created_at').on(
      t.createdAt,
    ),
  }),
);

export type MarketingPilotApplication =
  typeof marketingPilotApplications.$inferSelect;
export type NewMarketingPilotApplication =
  typeof marketingPilotApplications.$inferInsert;
