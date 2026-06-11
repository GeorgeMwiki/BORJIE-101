/**
 * modules — the per-tenant module-spawning registry (Piece B, Pass 2).
 *
 * One row per MD-authored / template-instantiated module a tenant owns. The
 * module is the durable handle that the module-orchestrator spawns: it carries
 * the human slug + bilingual title, the originating `template_id` / `spec_id`,
 * the isolated `vector_namespace`, the JSONB list of `scoped_tool_ids` the
 * module's juniors may reach, and a coarse `lifecycle_state` (DRAFT →
 * ACTIVE → ARCHIVED). `module_specs` rows hang off this table by `module_id`.
 *
 * Companion to migration 0323_module_spawning_registry.sql and the
 * `services/api-gateway/src/composition/module-spawning-wiring.ts` adapters.
 * Tenant-scoped (tenant_id TEXT, no FK — same shape as the
 * situational_model / md_commitments families). FORCE-enables RLS in 0323 with
 * a tenant-isolation policy on the canonical `app.current_tenant_id` GUC + a
 * service-role bypass; a tenant can NEVER read another tenant's modules.
 *
 * UNIQUE(tenant_id, slug) makes the spawn idempotent — the same module is never
 * double-created within a tenant.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// modules — per-tenant module-spawning registry.
// ============================================================================

export const modules = pgTable(
  'modules',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Human-stable slug, unique within a tenant (e.g. 'tailings-register'). */
    slug: text('slug').notNull(),
    /** Display title (EN default). */
    title: text('title').notNull(),
    /** Swahili display title (bilingual; nullable until translated). */
    titleSw: text('title_sw'),
    /** Originating module_templates.id when instantiated from a built-in. */
    templateId: text('template_id'),
    /** Latest applied module_specs.id (the spec that shaped this module). */
    specId: text('spec_id'),
    /** Isolated pgvector namespace for this module's corpus. */
    vectorNamespace: text('vector_namespace').notNull(),
    /** JSONB array of tool ids this module's juniors may reach. */
    scopedToolIds: jsonb('scoped_tool_ids')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Coarse lifecycle: DRAFT | ACTIVE | ARCHIVED. */
    lifecycleState: text('lifecycle_state').notNull().default('DRAFT'),
    /** The user who authored / spawned this module (forensic replay). */
    createdByUserId: text('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft-delete tombstone; NULL == live. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    /** Spawn idempotency — the same slug is never double-created per tenant. */
    tenantSlugUniq: uniqueIndex('modules_tenant_slug_uniq').on(
      t.tenantId,
      t.slug,
    ),
    /** List-by-tenant is the registry read (a surface lists every module). */
    tenantIdx: index('idx_modules_tenant').on(t.tenantId),
  }),
);

export type ModuleRow = typeof modules.$inferSelect;
export type ModuleInsert = typeof modules.$inferInsert;
