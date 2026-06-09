/**
 * module_templates — the GLOBAL built-in module catalogue.
 *
 * NOT tenant-scoped: every tenant reads the SAME built-in templates (there is
 * no `tenant_id` column). One row per built-in module the orchestrator can
 * instantiate into a tenant's `modules` registry. Carries a stable `slug`
 * (globally UNIQUE), a bilingual title (EN required, SW optional), and the
 * `default_spec` JSONB the instantiation seeds from.
 *
 * Companion to migration 0323_module_spawning_registry.sql. Because there is no
 * tenant boundary, 0323 FORCE-enables RLS with a READ-ALL SELECT policy
 * (USING true — any caller may read the catalogue) plus a SERVICE-ROLE-ONLY
 * write policy (INSERT/UPDATE/DELETE gated on
 * `current_setting('app.is_service_role', true) = 'true'`), plus the standard
 * pg_roles-guarded REVOKE ALL FROM anon. A tenant can READ templates but NEVER
 * write them.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// module_templates — global built-in module catalogue (no tenant boundary).
// ============================================================================

export const moduleTemplates = pgTable(
  'module_templates',
  {
    id: text('id').primaryKey(),
    /** Globally-unique stable slug (e.g. 'tailings-register'). */
    slug: text('slug').notNull(),
    /** English display title (required — EN is the default locale). */
    titleEn: text('title_en').notNull(),
    /** Swahili display title (bilingual; nullable until translated). */
    titleSw: text('title_sw'),
    /** The seed spec the orchestrator instantiates into a tenant's module. */
    defaultSpec: jsonb('default_spec')
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Globally-unique slug — the catalogue lookup + dedup key. */
    slugUniq: uniqueIndex('module_templates_slug_uniq').on(t.slug),
  }),
);

export type ModuleTemplateRow = typeof moduleTemplates.$inferSelect;
export type ModuleTemplateInsert = typeof moduleTemplates.$inferInsert;
