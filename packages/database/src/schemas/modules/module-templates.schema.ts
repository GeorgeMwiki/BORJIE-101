/**
 * module_templates (migration 0218) — platform-built-in & tenant-fork
 * template bundles.
 *
 * Ten platform-built-in templates ship with Borjie:
 *   ESTATE / HR / FLEET / PROCUREMENT / LEGAL / FINANCE
 *   STRATEGY / COMPLIANCE / CRM / INVENTORY
 *
 * Templates are PLATFORM-WIDE (not tenant-scoped). All authenticated
 * users may SELECT; INSERT/UPDATE/DELETE forbidden from authenticated
 * (only service-role / migration seeds may modify).
 *
 * The migration seeds 10 stubs with minimal `default_spec_jsonb`; the
 * real spec_jsonb is UPSERTed at runtime by the
 * @borjie/module-templates package's boot routine.
 */

import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const MODULE_TEMPLATE_SLUGS = [
  'ESTATE',
  'HR',
  'FLEET',
  'PROCUREMENT',
  'LEGAL',
  'FINANCE',
  'STRATEGY',
  'COMPLIANCE',
  'CRM',
  'INVENTORY',
] as const;

export type ModuleTemplateSlug = (typeof MODULE_TEMPLATE_SLUGS)[number];

export const moduleTemplates = pgTable(
  'module_templates',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    titleEn: text('title_en').notNull(),
    titleSw: text('title_sw'),
    description: text('description'),
    defaultSpecJsonb: jsonb('default_spec_jsonb')
      .$type<Record<string, unknown>>()
      .notNull(),
    icon: text('icon'),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex('module_templates_slug_unique').on(t.slug),
    builtInIdx: index('module_templates_is_built_in_idx').on(t.isBuiltIn),
    slugCheck: check(
      'module_templates_slug_nonempty_check',
      sql`length(slug) > 0`,
    ),
  }),
);

export type ModuleTemplateRow = typeof moduleTemplates.$inferSelect;
export type ModuleTemplateInsert = typeof moduleTemplates.$inferInsert;
