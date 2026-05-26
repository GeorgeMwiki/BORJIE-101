/**
 * Org Hierarchy + Terminology persistence (Wave 18X).
 *
 * Companion to docs/DESIGN/ORG_HIERARCHY_TERMINOLOGY_SPEC.md. Drizzle
 * types for the 3 tables created by migration
 * 0026_org_scope_hierarchy.sql:
 *
 *   - orgUnits                → recursive tree per tenant. Tenant-root
 *                                is implicit (NULL parent_unit_id on
 *                                top-level rows).
 *   - userScopeBindings       → many-to-many user × scope. Tracks role
 *                                + authority_tier_max + grant/revoke
 *                                lifecycle.
 *   - terminologyOverrides    → per-tenant + per-org-unit override of
 *                                the default catalogue shipped from
 *                                @borjie/org-scope.
 *
 * All three tables are tenant-scoped via the canonical `app.tenant_id`
 * GUC RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  uuid,
  smallint,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

// ============================================================================
// org_units — recursive tree per tenant
// ============================================================================

export const orgUnits = pgTable(
  'org_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** NULL parent means "top-level under the implicit tenant root". */
    parentUnitId: uuid('parent_unit_id'),
    /**
     * Stable enum value driving RBAC + recipes + reports.
     * district|branch|division|department|unit|team|crew|ward|
     * company|region|zone|subsidiary
     */
    defaultKind: text('default_kind').notNull(),
    /** Tenant-customised name for THIS unit (e.g. "Geita"). */
    displayName: text('display_name').notNull(),
    /** Tenant-customised name for the unit-type singular (e.g. "district"). */
    displayKindSingular: text('display_kind_singular').notNull(),
    /** Same, plural. */
    displayKindPlural: text('display_kind_plural').notNull(),
    /** Slash-delimited materialised ancestry, e.g. "borjie/north-zone/geita". */
    materialisedPath: text('materialised_path').notNull(),
    /** 0 for the implicit root, 1 for top-level units, ... */
    depth: integer('depth').notNull().default(0),
    /** Whether sub-units inherit authority bindings from parent. */
    authorityInheritance: boolean('authority_inheritance').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('org_units_tenant_idx').on(table.tenantId),
    tenantPathIdx: index('org_units_tenant_path_idx').on(
      table.tenantId,
      table.materialisedPath,
    ),
    parentIdx: index('org_units_parent_idx').on(table.parentUnitId),
    tenantPathUniqueIdx: uniqueIndex('org_units_tenant_path_unique_idx').on(
      table.tenantId,
      table.materialisedPath,
    ),
  }),
);

export type OrgUnitRow = typeof orgUnits.$inferSelect;
export type OrgUnitInsert = typeof orgUnits.$inferInsert;

// ============================================================================
// user_scope_bindings — many-to-many user × scope
// ============================================================================

export const userScopeBindings = pgTable(
  'user_scope_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** tenant_root | org_unit | cross_scope */
    scopeKind: text('scope_kind').notNull(),
    /** NULL when scope_kind = tenant_root, non-null otherwise. */
    orgUnitId: uuid('org_unit_id'),
    /** owner | admin | manager | employee | customer | auditor */
    role: text('role').notNull(),
    /** 0 = read-only, 1 = soft mutation, 2 = hard mutation. */
    authorityTierMax: smallint('authority_tier_max').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: text('granted_by').notNull(),
    /** NULL = active. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    userTenantIdx: index('usb_user_tenant_idx').on(table.userId, table.tenantId),
    scopeIdx: index('usb_scope_idx').on(table.tenantId, table.orgUnitId),
  }),
);

export type UserScopeBindingRow = typeof userScopeBindings.$inferSelect;
export type UserScopeBindingInsert = typeof userScopeBindings.$inferInsert;

// ============================================================================
// terminology_overrides — per-tenant + per-org-unit overrides
// ============================================================================

export const terminologyOverrides = pgTable(
  'terminology_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** NULL = tenant-wide override; non-null = scoped to a sub-org. */
    orgUnitId: uuid('org_unit_id'),
    /** Matches a key in @borjie/org-scope DEFAULT_TERMINOLOGY. */
    key: text('key').notNull(),
    singularEn: text('singular_en').notNull(),
    pluralEn: text('plural_en').notNull(),
    /** NULL means "no override, fall back to default Swahili". */
    singularSw: text('singular_sw'),
    pluralSw: text('plural_sw'),
    overriddenBy: text('overridden_by').notNull(),
    overriddenAt: timestamp('overridden_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantKeyIdx: index('terminology_overrides_tenant_key_idx').on(
      table.tenantId,
      table.key,
    ),
  }),
);

export type TerminologyOverrideRow = typeof terminologyOverrides.$inferSelect;
export type TerminologyOverrideInsert = typeof terminologyOverrides.$inferInsert;
