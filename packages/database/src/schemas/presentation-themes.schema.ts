/**
 * presentation_themes (migration 0209) — Piece H slide-master theme
 * registry.
 *
 * One row per theme. `tenant_id` NULL = platform built-in (visible to
 * every tenant). The presentation engine reads this table when
 * rendering a .pptx — the JSONB blob carries dimensions, colors, fonts,
 * logo position, and the list of named slide-layouts.
 *
 * RLS pattern (see 0209_presentation_themes.sql):
 *   - SELECT: tenant_id IS NULL OR tenant_id = current_app_tenant_id()
 *   - INSERT/UPDATE/DELETE: tenant_id = current_app_tenant_id()
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

export interface PresentationSlideMaster {
  readonly dimensions: { readonly w: number; readonly h: number };
  readonly colors: {
    readonly primary: string;
    readonly secondary: string;
    readonly accent: string;
    readonly text: string;
    readonly background: string;
    readonly muted: string;
  };
  readonly fonts: {
    readonly title: string;
    readonly body: string;
    readonly accent: string;
  };
  readonly logo_position: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  };
  readonly layouts: readonly string[];
}

export const presentationThemes = pgTable(
  'presentation_themes',
  {
    id: text('id').primaryKey(),
    /** NULL = platform built-in. */
    tenantId: text('tenant_id'),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    slideMasterJsonb: jsonb('slide_master_jsonb')
      .$type<PresentationSlideMaster>()
      .notNull(),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    platformSlugIdx: uniqueIndex('uq_presentation_themes_platform_slug')
      .on(t.slug)
      .where(sql`tenant_id IS NULL`),
    tenantSlugIdx: uniqueIndex('uq_presentation_themes_tenant_slug')
      .on(t.tenantId, t.slug)
      .where(sql`tenant_id IS NOT NULL`),
    tenantIdx: index('idx_presentation_themes_tenant').on(t.tenantId),
    slugCheck: check(
      'ck_presentation_themes_slug_nonempty',
      sql`length(${t.slug}) > 0`,
    ),
  }),
);

export type PresentationThemeRow = typeof presentationThemes.$inferSelect;
export type PresentationThemeInsert = typeof presentationThemes.$inferInsert;
