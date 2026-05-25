/**
 * Sensor catalog — registry of every LLM sensor the brain can call.
 *
 * Phase D D7 — replaces the hard-coded `HAIKU/SONNET/OPUS/DEEPSEEK`
 * constants in `sensor-routing.service.ts` with a DB-backed catalog so:
 *
 *   - new sensors (Gemini 2.6, Llama 4.x …) appear without a deploy
 *   - per-sensor price/quota/availability metadata is centralised
 *   - admins can mark a sensor `inactive` to drain it from every chain
 *     without touching the routing table
 *
 * One row per logical sensor id (e.g. `claude.opus-4-7`,
 * `claude.sonnet-4-6`). `provider` is the registered AIProvider id
 * the router will dispatch to. `pricing` is microdollar per 1M tokens
 * for both input/output so the cost-estimator can stay decoupled from
 * the provider config.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const SENSOR_CATALOG_TIERS = ['basic', 'standard', 'advanced'] as const;
export type SensorCatalogTier = (typeof SENSOR_CATALOG_TIERS)[number];

export const sensorCatalog = pgTable(
  'sensor_catalog',
  {
    /** Stable sensor id, e.g. 'claude.opus-4-7'. */
    id: text('id').primaryKey(),
    /** AIProvider id this sensor dispatches to (e.g. 'anthropic'). */
    provider: text('provider').notNull(),
    /** Underlying model id used in API calls. */
    model: text('model').notNull(),
    displayName: text('display_name').notNull(),
    tier: text('tier').notNull().default('standard'),
    /** Per-call ceiling. Microdollars (1 USD = 1_000_000). */
    defaultMaxBudgetUsdMicroPerCall: bigint(
      'default_max_budget_usd_micro_per_call',
      { mode: 'number' },
    )
      .notNull()
      .default(0),
    /** Per-call max output tokens. */
    defaultMaxTokens: integer('default_max_tokens').notNull().default(2000),
    /** Microdollars per 1M input tokens. */
    pricingInputUsdMicroPer1M: bigint('pricing_input_usd_micro_per_1m', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    /** Microdollars per 1M output tokens. */
    pricingOutputUsdMicroPer1M: bigint('pricing_output_usd_micro_per_1m', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    /** False means the router skips this sensor on every chain. */
    active: boolean('active').notNull().default(true),
    /** Optional structured metadata blob (context window, modalities…). */
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    providerIdx: index('idx_sensor_catalog_provider').on(t.provider),
    activeTierIdx: index('idx_sensor_catalog_active_tier').on(t.active, t.tier),
  }),
);
