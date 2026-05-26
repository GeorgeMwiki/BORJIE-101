/**
 * Dynamic Authored Recipes persistence (Wave 18M).
 *
 * Companion to Docs/DESIGN/DYNAMIC_RECIPE_AUTHORING_SPEC.md. Drizzle
 * types for the single table created by migration
 * 0066_dynamic_authored_recipes.sql:
 *
 *   - dynamicAuthoredRecipes → LLM-authored, lifecycle-governed
 *                              registry of dynamic recipes (tab | doc |
 *                              media | campaign | tool). Tenant-scoped
 *                              via the canonical `app.tenant_id` GUC
 *                              RLS policy.
 *
 * Schema is intentionally narrow: one immutable spec jsonb per
 * (tenant, kind, name, version), with prev_hash + audit_hash for
 * forensic replay against the per-tenant authoring chain.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// dynamic_authored_recipes — LLM-authored recipe registry
// ============================================================================

export const dynamicAuthoredRecipes = pgTable(
  'dynamic_authored_recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** tab | doc | media | campaign | tool. */
    kind: text('kind').notNull(),
    /** Human-friendly recipe name. */
    name: text('name').notNull(),
    /** Semver-ish version string. */
    version: text('version').notNull(),
    /** Validated, frozen spec — shape depends on `kind`. */
    spec: jsonb('spec').notNull(),
    /** draft | shadow | live | locked | deprecated. */
    lifecycleState: text('lifecycle_state').notNull().default('draft'),
    authoredAt: timestamp('authored_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** `mr-mwikila` for LLM-authored; `tenant-user:<uuid>` for direct. */
    authoredBy: text('authored_by').notNull(),
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    uniqueVersion: uniqueIndex(
      'uq_dynamic_authored_recipes_unique_version',
    ).on(t.tenantId, t.kind, t.name, t.version),
    tenantKindLifecycleIdx: index(
      'idx_dynamic_authored_recipes_tenant_kind_lifecycle',
    ).on(t.tenantId, t.kind, t.lifecycleState, t.authoredAt),
    auditHashIdx: index('idx_dynamic_authored_recipes_audit_hash').on(
      t.auditHash,
    ),
  }),
);

export type DynamicAuthoredRecipeRow =
  typeof dynamicAuthoredRecipes.$inferSelect;
export type DynamicAuthoredRecipeInsert =
  typeof dynamicAuthoredRecipes.$inferInsert;
