/**
 * modules (migration 0216) — Piece B per-tenant module instances.
 *
 * A module is a tenant-spawned vertical slice ("HR", "Estate", "Fleet")
 * that owns its slice of core_entity (filtered by module_id), its UI
 * sections, its vector namespace, its scoped tool catalogue, and its
 * lifecycle state (DRAFT → PROPOSED → APPROVED → LIVE → DEPRECATED →
 * ARCHIVED — only PROPOSED→APPROVED requires K5 four-eye).
 *
 * RLS: tenant_id = current_app_tenant_id() on SELECT and modify
 * (gold-standard pattern from 0185).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants, users } from '../tenant.schema.js';

export const MODULE_LIFECYCLE_STATES = [
  'DRAFT',
  'PROPOSED',
  'APPROVED',
  'LIVE',
  'DEPRECATED',
  'ARCHIVED',
] as const;

export type ModuleLifecycleState = (typeof MODULE_LIFECYCLE_STATES)[number];

export const modules = pgTable(
  'modules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    titleSw: text('title_sw'),
    /** FK to module_templates.id — wired by migration 0218. */
    templateId: text('template_id'),
    /** FK to module_specs.id — wired by migration 0217. */
    specId: text('spec_id'),
    uiLayoutJsonb: jsonb('ui_layout_jsonb')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    vectorNamespace: text('vector_namespace').notNull(),
    scopedToolIds: text('scoped_tool_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::TEXT[]`),
    auditChainRoot: text('audit_chain_root'),
    lifecycleState: text('lifecycle_state')
      .$type<ModuleLifecycleState>()
      .notNull()
      .default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('modules_tenant_idx')
      .on(t.tenantId)
      .where(sql`deleted_at IS NULL`),
    tenantLifecycleIdx: index('modules_tenant_lifecycle_idx')
      .on(t.tenantId, t.lifecycleState)
      .where(sql`deleted_at IS NULL`),
    tenantSlugUnique: uniqueIndex('modules_tenant_slug_unique')
      .on(t.tenantId, t.slug)
      .where(sql`deleted_at IS NULL`),
    vectorNamespaceIdx: index('modules_vector_namespace_idx').on(
      t.vectorNamespace,
    ),
    lifecycleCheck: check(
      'modules_lifecycle_state_check',
      sql`lifecycle_state IN (
          'DRAFT', 'PROPOSED', 'APPROVED', 'LIVE', 'DEPRECATED', 'ARCHIVED'
        )`,
    ),
  }),
);

export type ModuleRow = typeof modules.$inferSelect;
export type ModuleInsert = typeof modules.$inferInsert;
