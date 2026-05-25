/**
 * currency_preferences — per-scope display-currency choice.
 *
 * Borjie is built for the world (starting with TZ). Every user
 * picks the currency they want numbers reported in. Resolution chain:
 *
 *     user override → tenant default → platform default (seeded USD)
 *
 * The table stores all three tiers in one shape with a discriminator
 * column so the resolver can fold them with a single COALESCE.
 *
 * Scope semantics:
 *   - scope_kind = 'user'             scope_id = user id
 *   - scope_kind = 'tenant'           scope_id = tenant id
 *   - scope_kind = 'platform-default' scope_id = '*'  (singleton)
 *
 * Currency is a free-form ISO-4217 code (TEXT, UPPER, 3 chars). We
 * deliberately do NOT enum-constrain it — new currencies must be
 * addable without a migration. The `currency_rates` table is the
 * complementary FX source; if a chosen currency has no rate row,
 * the FX normaliser falls back gracefully.
 */

import {
  pgTable,
  text,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const currencyPreferences = pgTable(
  'currency_preferences',
  {
    scopeKind: text('scope_kind').notNull(),     // 'user' | 'tenant' | 'platform-default'
    scopeId: text('scope_id').notNull(),         // userId | tenantId | '*'
    currency: text('currency').notNull(),        // ISO-4217 — uppercase
    source: text('source'),                      // 'self-selected' | 'admin-set' | 'seed'
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scopeKind, t.scopeId] }),
    kindIdx: index('idx_currency_preferences_kind').on(t.scopeKind),
  }),
);
