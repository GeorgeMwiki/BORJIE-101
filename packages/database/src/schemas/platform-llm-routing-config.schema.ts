/**
 * platform_llm_routing_config — LLM control-plane routing store.
 *
 * The Borjie internal admin console's CONTROL PLANE over model selection.
 * One row per `scope` (a single JSONB `config` document per scope), where
 * scope is either `global` (platform-wide default) or `tenant:<tenantId>`
 * (per-tenant override). Mirrors the platform_feature_flags scope convention
 * so the two platform-config stores read the same way.
 *
 * The `config` JSONB carries the full LlmRoutingConfig:
 *   { coreModel, orderedFallbacks[], ensemble?{enabled,members[],
 *     combineStrategy,judgeModel?}, perUseCase?{useCase->modelId} }
 * The brain-llm-router's `validateRoutingConfig` duck-types it before the hot
 * path; a malformed row is treated as absent (fail-safe → static TASK_LADDER).
 *
 * PLATFORM-METADATA (NOT tenant business data): service-role-only access; the
 * `tenant:<id>` scope is a string key NAMING which tenant an override applies
 * to, not a row a tenant JWT path can read. Admin-only enforced at the route
 * layer via requireRole(SUPER_ADMIN). RLS is FORCE'd service-role-only.
 *
 * Migration 0320. Companion adapter is
 * `packages/database/src/services/platform/llm-routing-config.service.ts`.
 */
import { pgTable, text, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';

export const platformLlmRoutingConfig = pgTable(
  'platform_llm_routing_config',
  {
    id: text('id').primaryKey(),
    /** `global` or `tenant:<tenantId>`. Stored verbatim; one keyed row per scope. */
    scope: text('scope').notNull(),
    /** The full LlmRoutingConfig document (validated by the router on read). */
    config: jsonb('config').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull().default('system'),
    lastSetAt: timestamp('last_set_at', { withTimezone: true }).notNull().defaultNow(),
    lastSetBy: text('last_set_by').notNull().default('system'),
  },
  (t) => ({
    scopeUq: unique('uq_platform_llm_routing_config_scope').on(t.scope),
    scopeIdx: index('idx_platform_llm_routing_config_scope').on(t.scope),
  }),
);
