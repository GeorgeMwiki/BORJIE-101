/**
 * Market data cache (migration 0120).
 *
 * Caches results from external market-data adapters (Zillow, Airbnb,
 * Rentometer, regional comparable-rent feeds, etc.) so that repeated
 * kernel queries within a TTL do not hammer the upstream provider.
 *
 * Schema:
 *   - `cache_key`  TEXT PK    sha256(provider | normalised query)
 *   - `provider`   TEXT       'zillow' | 'airbnb' | future codes
 *   - `query_json` JSONB      the normalised query the key was built from
 *   - `result_json` JSONB     the upstream's response (typed at read time
 *                             by the calling adapter)
 *   - `fetched_at` TIMESTAMPTZ when the upstream was last hit
 *   - `expires_at` TIMESTAMPTZ entries with `expires_at <= NOW()` are
 *                              treated as cache miss by the service.
 *
 * Two indexes:
 *   - `idx_market_data_cache_provider` for provider-scoped purges.
 *   - `idx_market_data_cache_expires`  for the periodic expired-purge sweep.
 *
 * NOT tenant-scoped — this is platform-tier external data; the same
 * Zillow result for "Brooklyn 2BR" is reusable across every tenant
 * asking the same question.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const marketDataCache = pgTable(
  'market_data_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    provider: text('provider').notNull(),
    queryJson: jsonb('query_json').notNull(),
    resultJson: jsonb('result_json').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    providerIdx: index('idx_market_data_cache_provider').on(t.provider),
    expiresIdx: index('idx_market_data_cache_expires').on(t.expiresAt),
  }),
);
