/**
 * Ephemeral Dashboard Telemetry persistence (ephemeral-software).
 *
 * Companion to:
 *   - Docs/STRATEGY/EPHEMERAL_SOFTWARE_SOTA.md
 *   - Docs/DESIGN/FUNCTION_ATTACHED_DASHBOARD_SPEC.md
 *   - packages/ephemeral-ui/
 *
 * Drizzle types for the SINGLE table created by migration
 * 0031_ephemeral_dashboard.sql:
 *
 *   - ephemeralDashboardTelemetry → one row per compose call by
 *                                   `composeDashboardForFunction`. The
 *                                   durable trace + the promotion
 *                                   decider's source of truth. Stores
 *                                   the function id, manifest version,
 *                                   generated recipe-shape hash, user
 *                                   + session + tenant + scope, user-
 *                                   context hash (cache-key + replay
 *                                   key), reuse counts, and promotion
 *                                   outcome. Tenant-scoped, RLS.
 *
 * The composed TabRecipe itself is NEVER persisted here — it lives in
 * process memory + the LRU compose cache per FUNCTION_ATTACHED_DASHBOARD_SPEC
 * §6. This table is the audit + the promotion gate.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// ephemeral_dashboard_telemetry — compose-time audit + reuse counter
// ============================================================================

export const ephemeralDashboardTelemetry = pgTable(
  'ephemeral_dashboard_telemetry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Stable function id — matches Wave 18B intent.kind shape. */
    functionId: text('function_id').notNull(),
    /** Bumped whenever the manifest's output_shape or actions change. */
    manifestVersion: integer('manifest_version').notNull(),
    /**
     * Recipe-shape fingerprint — sha256 over the structural projection
     * (archetype + ordered section kinds + action ids). Two structurally
     * identical recipes share this hash regardless of cosmetic variation.
     */
    generatedRecipeHash: text('generated_recipe_hash').notNull(),
    userId: text('user_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    /** Org-scope hierarchy kind/id (Wave 18Y) — nullable for global. */
    scopeKind: text('scope_kind'),
    scopeId: text('scope_id'),
    /**
     * sha256 over the projection of `UserContext` used by the composer.
     * Cache key + replay key — the same hash means the same composition
     * should have been produced.
     */
    userContextHash: text('user_context_hash').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reuseCountForThisPattern: integer('reuse_count_for_this_pattern')
      .notNull()
      .default(0),
    distinctUserCountForPattern: integer('distinct_user_count_for_pattern')
      .notNull()
      .default(0),
    wasPromoted: boolean('was_promoted').notNull().default(false),
    /**
     * Stable promoted TabRecipe id once the 10× / 3-user threshold has
     * been hit. NULL while still ephemeral.
     */
    promotionRecipeId: text('promotion_recipe_id'),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    functionRecentIdx: index('idx_edt_function_recent').on(
      t.functionId,
      t.generatedAt,
    ),
    patternReuseIdx: index('idx_edt_pattern_reuse').on(
      t.generatedRecipeHash,
      t.reuseCountForThisPattern,
    ),
    tenantScopeIdx: index('idx_edt_tenant_scope').on(t.tenantId, t.scopeId),
  }),
);

export type EphemeralDashboardTelemetryRow =
  typeof ephemeralDashboardTelemetry.$inferSelect;
export type EphemeralDashboardTelemetryInsert =
  typeof ephemeralDashboardTelemetry.$inferInsert;
