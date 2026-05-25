/**
 * Semantic cache log — Phase D D4 (LLM cost reduction telemetry).
 *
 * Append-only one-row-per-lookup telemetry for the semantic-cache
 * layer in `@borjie/central-intelligence/kernel/semantic-cache`.
 *
 * Costs are stored as BIGINT micro-dollars (1e-6 USD) so float drift
 * never accumulates across rollups. Mirrors the convention in
 * `ai-cost.schema.ts`.
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const semanticCacheLog = pgTable(
  'semantic_cache_log',
  {
    id: text('id').primaryKey(),
    /** NULL for platform-tier (sovereign) turns. */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Surface identifier (e.g. 'tenant-portal'). */
    surface: text('surface').notNull(),
    /** Persona id at lookup time (e.g. 'tenant-resident'). */
    personaId: text('persona_id').notNull(),
    /** 'hit' | 'miss' | 'skip'. */
    outcome: text('outcome').notNull(),
    /** 'greeting' | 'question' | 'command' | … (kept TEXT for forward compat). */
    intent: text('intent').notNull(),
    /** Cosine similarity on hit; NULL on miss/skip. */
    similarity: doublePrecision('similarity'),
    /** Threshold applied at the moment of the lookup. */
    threshold: doublePrecision('threshold').notNull(),
    /** Model the cost is computed against (saved on hit, would-spend on miss). */
    modelId: text('model_id').notNull(),
    /** Cost saved (hit) or that would have been spent (miss). Micro-USD. */
    costUsdMicros: bigint('cost_usd_micros', { mode: 'number' })
      .notNull()
      .default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    /** Reason for a 'skip' outcome (NULL on hit/miss). */
    skipReason: text('skip_reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTimeIdx: index('idx_semantic_cache_log_tenant_time').on(
      t.tenantId,
      t.occurredAt,
    ),
    outcomeTimeIdx: index('idx_semantic_cache_log_outcome_time').on(
      t.outcome,
      t.occurredAt,
    ),
    tenantOutcomeIdx: index('idx_semantic_cache_log_tenant_outcome').on(
      t.tenantId,
      t.outcome,
      t.occurredAt,
    ),
  }),
);
