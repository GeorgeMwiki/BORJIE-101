/**
 * marketing_subscriptions — inbound marketing-site blog subscribers
 * persisted from `POST /api/v1/marketing/subscribe`.
 *
 * Closes KI-013 (the FE /api/subscribe handler forwarded to a gateway
 * endpoint that did not exist). Public-write, SUPER_ADMIN-read via RLS
 * (`marketing_subscriptions_insert` /
 * `marketing_subscriptions_select_super_admin`), mirroring
 * marketing_pilot_applications. Email is uniquely indexed
 * (case-insensitive) so a repeat subscribe is an idempotent upsert.
 *
 * Migration 0359.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const marketingSubscriptions = pgTable(
  'marketing_subscriptions',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').notNull().default({}),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index('idx_marketing_subscriptions_created_at').on(
      t.createdAt,
    ),
    // Functional case-insensitive unique index — mirrors the migration's
    // `(lower(email))` so a repeat subscribe is an idempotent upsert target.
    emailIdx: uniqueIndex('idx_marketing_subscriptions_email').on(
      sql`lower(${t.email})`,
    ),
  }),
);

export type MarketingSubscription =
  typeof marketingSubscriptions.$inferSelect;
export type NewMarketingSubscription =
  typeof marketingSubscriptions.$inferInsert;
