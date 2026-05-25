/**
 * Feature Flags + per-tenant overrides — Wave 9 enterprise polish.
 *
 * Two-table model:
 *   - `feature_flags`                  platform-wide catalog keyed by flagKey.
 *   - `tenant_feature_flag_overrides`  per-tenant overrides (tenantId, flagKey)
 *                                       with `enabled` bool.
 *
 * Resolution is handled by the service layer: tenant override wins when
 * present, otherwise the platform default for the flag applies.
 */

import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    flagKey: text('flag_key').notNull().unique(),
    description: text('description'),
    defaultEnabled: boolean('default_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    keyIdx: index('idx_feature_flags_key').on(table.flagKey),
  }),
);

export const tenantFeatureFlagOverrides = pgTable(
  'tenant_feature_flag_overrides',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    flagKey: text('flag_key')
      .notNull()
      .references(() => featureFlags.flagKey, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueTenantFlag: unique().on(table.tenantId, table.flagKey),
    tenantIdx: index('idx_tenant_ff_tenant').on(table.tenantId),
    flagIdx: index('idx_tenant_ff_flag').on(table.flagKey),
  }),
);

export const featureFlagsRelations = relations(featureFlags, ({ many }) => ({
  overrides: many(tenantFeatureFlagOverrides),
}));

export const tenantFeatureFlagOverridesRelations = relations(
  tenantFeatureFlagOverrides,
  ({ one }) => ({
    flag: one(featureFlags, {
      fields: [tenantFeatureFlagOverrides.flagKey],
      references: [featureFlags.flagKey],
    }),
  }),
);
