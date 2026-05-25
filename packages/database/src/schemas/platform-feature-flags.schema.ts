/**
 * platform_feature_flags — HQ-tier feature flag store.
 *
 * Central Command Phase B (B1 — HQ Tool Drizzle Adapters). Backs the
 * `platform.read_feature_flag` + `platform.set_feature_flag` HQ tools.
 *
 * Existing `feature_flags` + `tenant_feature_flag_overrides` only support
 * BOOLEAN values. The HQ tool surface needs `boolean | string` values
 * AND a full audit history (who last set, when), so we create a new
 * table rather than mutating the legacy enterprise-polish ones.
 *
 * Resolution model:
 *   - one row per `(scope, flag_name)` pair, unique
 *   - `scope = 'global'`        — the platform-wide default
 *   - `scope = 'tenant:<id>'`   — per-tenant override
 *
 * Migration 0137. Companion adapter is
 * `packages/database/src/services/platform/feature-flags.service.ts`.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';

export const platformFeatureFlags = pgTable(
  'platform_feature_flags',
  {
    id: text('id').primaryKey(),
    /**
     * Either the literal string `global` or `tenant:<tenantId>`. The
     * HQ-tool schema validates the shape at the boundary; the DB stores
     * it verbatim so reads stay cheap (no derived join needed to find
     * the per-tenant override).
     */
    scope: text('scope').notNull(),
    flagName: text('flag_name').notNull(),
    /**
     * JSONB lets us store either `true | false` or a free-form string
     * (e.g. a variant name, a tier identifier) without committing to
     * a second column. The HQ tool's `FeatureFlagValueSchema` defines
     * the exact union — we duck-type at read time.
     */
    flagValue: jsonb('flag_value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by').notNull(),
    lastSetAt: timestamp('last_set_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSetBy: text('last_set_by').notNull(),
  },
  (t) => ({
    scopeFlagUq: unique('uq_platform_feature_flags_scope_flag').on(
      t.scope,
      t.flagName,
    ),
    flagNameIdx: index('idx_platform_feature_flags_flag_name').on(t.flagName),
    scopeIdx: index('idx_platform_feature_flags_scope').on(t.scope),
  }),
);
