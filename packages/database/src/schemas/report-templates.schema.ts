/**
 * report_templates (migration 0208) — Piece H report-engine template
 * registry.
 *
 * One row per template. `tenant_id` NULL means a platform-shipped
 * built-in (visible to all tenants); non-NULL is a tenant-authored
 * override. The render engine reads this table on render, resolves
 * the section placeholders against live tenant data via repositories
 * (no LLM-generated SQL), and emits PDF / DOCX / PPTX in tenant brand.
 *
 * Partial unique indexes guarantee:
 *   - one (NULL, slug) tuple platform-wide
 *   - one (tenant_id, slug) tuple per tenant
 *
 * RLS pattern (see 0208_report_templates.sql):
 *   - SELECT: tenant_id IS NULL OR tenant_id = current_app_tenant_id()
 *   - INSERT/UPDATE/DELETE: tenant_id = current_app_tenant_id()
 *
 * Drizzle does not emit the RLS policies — the migration wires them.
 */

import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Each entry in `sectionsJsonb` is one section. The renderer resolves
 * `dataSource` by calling the matching repository / KPI engine, then
 * substitutes the result into the rendered output according to `kind`:
 *   - 'narrative'  → plain paragraphs
 *   - 'table'      → tabular data
 *   - 'chart'      → Vega-Lite spec + chart image
 *   - 'kpi_grid'   → grid of metric cards
 */
export interface ReportTemplateSection {
  readonly section_id: string;
  readonly title: string;
  readonly data_source: string;
  readonly kind: 'narrative' | 'table' | 'chart' | 'kpi_grid';
}

export const reportTemplates = pgTable(
  'report_templates',
  {
    id: text('id').primaryKey(),
    /** NULL = platform built-in, visible across all tenants. */
    tenantId: text('tenant_id'),
    slug: text('slug').notNull(),
    displayNameEn: text('display_name_en').notNull(),
    displayNameSw: text('display_name_sw'),
    /** JSONB list of {section_id, title, data_source, kind}. */
    sectionsJsonb: jsonb('sections_jsonb')
      .$type<ReportTemplateSection[]>()
      .notNull(),
    /** Subset of {pdf, docx, pptx}. */
    outputFormats: text('output_formats')
      .array()
      .notNull()
      .default(sql`ARRAY['pdf', 'docx', 'pptx']::TEXT[]`),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Platform-wide built-ins: only one row per slug, tenant_id NULL. */
    platformSlugIdx: uniqueIndex('uq_report_templates_platform_slug')
      .on(t.slug)
      .where(sql`tenant_id IS NULL`),
    /** Tenant overrides: one row per (tenant_id, slug). */
    tenantSlugIdx: uniqueIndex('uq_report_templates_tenant_slug')
      .on(t.tenantId, t.slug)
      .where(sql`tenant_id IS NOT NULL`),
    tenantIdx: index('idx_report_templates_tenant').on(t.tenantId),
    builtInIdx: index('idx_report_templates_built_in').on(t.isBuiltIn),
    slugCheck: check(
      'ck_report_templates_slug_nonempty',
      sql`length(${t.slug}) > 0`,
    ),
  }),
);

export type ReportTemplateRow = typeof reportTemplates.$inferSelect;
export type ReportTemplateInsert = typeof reportTemplates.$inferInsert;
