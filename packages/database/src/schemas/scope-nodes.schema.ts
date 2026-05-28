/**
 * scope_nodes + scope_taxonomy_preferences — Wave SCOPE-SEGMENTATION.
 *
 * Single hierarchical taxonomy tree so the MD can roll up / compare /
 * drill across any user-defined scope (pit, site, region, subsidiary,
 * cohort, parcel, …) plus a per-tenant display label override.
 *
 * Companion to:
 *   - packages/database/src/migrations/0096_scope_nodes_taxonomy.sql
 *   - services/api-gateway/src/routes/scope/scope.hono.ts
 *   - services/api-gateway/src/services/md-intelligence/scope-roller.ts
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// scope_nodes
// ============================================================================

export const scopeNodes = pgTable(
  'scope_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    parentId: uuid('parent_id'),
    /** pit | site | region | country | subsidiary | jv | cohort |
     *  parcel | crew | shift | group | other. */
    kindCanonical: text('kind_canonical').notNull(),
    name: text('name').notNull(),
    identifiers: jsonb('identifiers').notNull().default({}),
    attributes: jsonb('attributes').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantParentIdx: index('idx_scope_nodes_tenant_parent').on(
      t.tenantId,
      t.parentId,
    ),
    tenantKindIdx: index('idx_scope_nodes_tenant_kind').on(
      t.tenantId,
      t.kindCanonical,
      t.active,
    ),
  }),
);

export type ScopeNode = typeof scopeNodes.$inferSelect;
export type NewScopeNode = typeof scopeNodes.$inferInsert;

export const SCOPE_NODE_KINDS = [
  'pit',
  'site',
  'region',
  'country',
  'subsidiary',
  'jv',
  'cohort',
  'parcel',
  'crew',
  'shift',
  'group',
  'other',
] as const;
export type ScopeNodeKind = (typeof SCOPE_NODE_KINDS)[number];

// ============================================================================
// scope_taxonomy_preferences
// ============================================================================

export const scopeTaxonomyPreferences = pgTable(
  'scope_taxonomy_preferences',
  {
    tenantId: text('tenant_id').primaryKey(),
    displayLabelEn: jsonb('display_label_en').notNull().default({}),
    displayLabelSw: jsonb('display_label_sw').notNull().default({}),
    defaultKind: text('default_kind').notNull().default('site'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export type ScopeTaxonomyPreference =
  typeof scopeTaxonomyPreferences.$inferSelect;
export type NewScopeTaxonomyPreference =
  typeof scopeTaxonomyPreferences.$inferInsert;
