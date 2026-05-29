/**
 * Saved Searches — owner-defined alert rules.
 *
 * Companion to:
 *   - packages/database/src/migrations/0124_saved_searches.sql
 *   - services/api-gateway/src/routes/owner/saved-searches.hono.ts
 *   - services/api-gateway/src/workers/saved-search-worker.ts
 *
 * Roadmap R2 — saved-search alerts. One row per tenant + user + named
 * query. The worker re-runs the query on the row's `frequency` cadence
 * and dispatches an owner-messaging alert when the match count grows
 * past `last_match_count` (i.e. new matches arrived).
 *
 * Source enum is open-ended (no SQL CHECK) so new corpora can be added
 * without a migration. Allowed values today: marketplace | opportunities
 * | regulatory.
 *
 * Tenant-isolated via `app.current_tenant_id` RLS policy (FORCE).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------------
// Enums — TS string-literal unions; SQL enforces via CHECK constraint.
// ----------------------------------------------------------------------------

export const SAVED_SEARCH_FREQUENCIES = [
  'hourly',
  'daily',
  'weekly',
] as const;
export type SavedSearchFrequency = (typeof SAVED_SEARCH_FREQUENCIES)[number];

export const SAVED_SEARCH_SOURCES = [
  'marketplace',
  'opportunities',
  'regulatory',
] as const;
export type SavedSearchSource = (typeof SAVED_SEARCH_SOURCES)[number];

// ----------------------------------------------------------------------------
// Table
// ----------------------------------------------------------------------------

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    label: text('label').notNull(),
    /** Free-form JSON describing the query — commodity, geo, price band, etc. */
    queryJson: jsonb('query_json').notNull().default({}),
    /** hourly | daily | weekly. */
    frequency: text('frequency').notNull().default('daily'),
    /** marketplace | opportunities | regulatory. */
    source: text('source').notNull().default('marketplace'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastMatchCount: integer('last_match_count').notNull().default(0),
    lastAlertAt: timestamp('last_alert_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('saved_searches_tenant_idx').on(
      t.tenantId,
      t.userId,
      t.createdAt,
    ),
    dueIdx: index('saved_searches_due_idx').on(t.frequency, t.lastRunAt),
  }),
);

// ----------------------------------------------------------------------------
// Type re-exports
// ----------------------------------------------------------------------------

export type SavedSearchRow = typeof savedSearches.$inferSelect;
export type NewSavedSearchRow = typeof savedSearches.$inferInsert;
