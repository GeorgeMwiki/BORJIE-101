/**
 * price_recommendations (migration 0287) — Agent PhL dynamic-pricing durable
 * store.
 *
 * One row per AI-native mineral-price proposal. The proposal is computed by a
 * REAL Anthropic LLM call clamped by the jurisdiction's price-control cap, then
 * stored with status `proposed`. The ApprovalService (NOT this table) owns the
 * actual price mutation — nothing here changes a live price.
 *
 * Money is stored as integer minor-units (`*_price_minor`) PLUS an explicit
 * ISO-4217 `currency_code` (CLAUDE.md hard rule — never a currency literal,
 * never a float). `delta_pct` / `regulatory_cap_pct` are percentages.
 *
 * Tenant scope (CLAUDE.md hard rule — mirrors voice_turns / migration 0287):
 * tenant_id is TEXT and FK→tenants; the durable table FORCE-enables RLS on the
 * canonical `app.current_tenant_id` GUC bound by the api-gateway
 * databaseMiddleware. The Drizzle repo also filters every read by tenantId for
 * defence-in-depth.
 *
 * The jsonb `citations` column is typed (`$type`) as the PhL Citation shape so
 * the Drizzle repo round-trips it without a cast; the type is declared locally
 * to keep `@borjie/database` free of an `@borjie/ai-copilot` import (the
 * dependency direction is ai-copilot → database, never the reverse).
 *
 * Companion to:
 *   - packages/database/src/migrations/0287_ai_native_price_recommendations.sql
 *   - services/api-gateway/src/composition/ai-native/drizzle-repos.ts
 */

import {
  pgTable,
  text,
  bigint,
  doublePrecision,
  boolean,
  jsonb,
  date,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

/**
 * PhL `Citation` shape (mirrors `ai-copilot/.../phl-common/types.ts`). Declared
 * locally — see the file header for why we do NOT import it.
 */
export interface PriceRecommendationCitation {
  readonly kind: string;
  readonly ref: string;
  readonly note?: string;
}

export const priceRecommendations = pgTable(
  'price_recommendations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pitId: text('pit_id').notNull(),
    siteId: text('site_id'),
    currencyCode: text('currency_code').notNull(),
    currentPriceMinor: bigint('current_price_minor', {
      mode: 'number',
    }).notNull(),
    recommendedPriceMinor: bigint('recommended_price_minor', {
      mode: 'number',
    }).notNull(),
    deltaPct: doublePrecision('delta_pct').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    suggestedReviewDate: date('suggested_review_date').notNull(),
    citations: jsonb('citations')
      .notNull()
      .$type<ReadonlyArray<PriceRecommendationCitation>>()
      .default([]),
    regulatoryCapPct: doublePrecision('regulatory_cap_pct'),
    capBreached: boolean('cap_breached').notNull().default(false),
    explanation: text('explanation').notNull().default(''),
    modelVersion: text('model_version').notNull(),
    promptHash: text('prompt_hash').notNull(),
    status: text('status').notNull().default('proposed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPitCreatedIdx: index(
      'idx_price_recommendations_tenant_pit_created',
    ).on(t.tenantId, t.pitId, t.createdAt.desc()),
    tenantCreatedIdx: index('idx_price_recommendations_tenant_created').on(
      t.tenantId,
      t.createdAt.desc(),
    ),
    statusCheck: check(
      'price_recommendations_status_chk',
      sql`${t.status} IN ('proposed')`,
    ),
    confidenceCheck: check(
      'price_recommendations_confidence_chk',
      sql`${t.confidence} BETWEEN 0 AND 1`,
    ),
  }),
);

export type PriceRecommendationRecord =
  typeof priceRecommendations.$inferSelect;
export type NewPriceRecommendationRecord =
  typeof priceRecommendations.$inferInsert;
