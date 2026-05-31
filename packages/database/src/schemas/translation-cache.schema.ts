/**
 * Translation Cache (Migration 0155).
 *
 * Companion to `@borjie/translation` facade. Content-addressed by SHA-256
 * of (sourceLang||targetLang||register||surface||sourceText). Tenant id
 * is stored for telemetry but reads are shared (cache is identical for
 * identical content across tenants).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const translationCache = pgTable(
  'translation_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    contentHash: text('content_hash').notNull(),
    tenantId: text('tenant_id'),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    register: text('register').notNull(),
    surface: text('surface').notNull(),
    sourceText: text('source_text').notNull(),
    targetText: text('target_text').notNull(),
    provider: text('provider').notNull(),
    glossaryVersion: text('glossary_version').notNull().default('v1'),
    hits: integer('hits').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    contentHashIdx: uniqueIndex('uq_translation_cache_content').on(t.contentHash),
    lastUsedIdx: index('idx_translation_cache_last_used').on(t.lastUsedAt),
    langPairIdx: index('idx_translation_cache_lang_pair').on(t.sourceLang, t.targetLang),
  }),
);

export type TranslationCacheRow = typeof translationCache.$inferSelect;
export type TranslationCacheInsert = typeof translationCache.$inferInsert;
