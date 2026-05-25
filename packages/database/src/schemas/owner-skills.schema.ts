/**
 * Owner-installable Skills marketplace.
 *
 * Phase E.7 — owner-side skill registry. Distinct from the platform-wide
 * `skill_registry` (Voyager procedural memory) — these are explicit,
 * owner-curated workflows the brain runs on cron / events / on-demand.
 *
 * Authorship:
 *   - `author_tenant_id IS NULL`  → MD-authored (platform-shipped skill)
 *   - `author_tenant_id IS NOT NULL` → community / cross-tenant share
 *
 * Each row represents an INSTALL for a specific tenant. The unique
 * (installed_by_tenant_id, slug) index lets owners disable+re-install
 * cleanly without orphaning prior runs.
 */

import {
  pgTable,
  text,
  uuid,
  jsonb,
  timestamp,
  boolean,
  integer,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

export const ownerSkills = pgTable(
  'owner_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null = MD-authored (platform-shipped). */
    authorTenantId: uuid('author_tenant_id'),
    installedByTenantId: uuid('installed_by_tenant_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description').notNull(),
    promptTemplate: text('prompt_template').notNull(),
    /** Array of tool names the skill is allowed to call. JSON array. */
    toolAllowlist: jsonb('tool_allowlist').notNull().default([]),
    /** 'cron' | 'event' | 'manual' */
    triggerKind: text('trigger_kind').notNull(),
    triggerConfig: jsonb('trigger_config').default({}),
    enabled: boolean('enabled').notNull().default(false),
    // D2 — withTimezone:true required so the Drizzle declarator matches the
    // timestamptz column installed by migration 0163 (otherwise downstream
    // consumers cannot tell a TZ-aware column from a naive one — type-safety leak).
    installedAt: timestamp('installed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    runCount: integer('run_count').notNull().default(0),
  },
  (t) => ({
    installedSlugUniq: uniqueIndex('uniq_owner_skills_installer_slug').on(
      t.installedByTenantId,
      t.slug,
    ),
    triggerKindIdx: index('idx_owner_skills_trigger_kind').on(
      t.installedByTenantId,
      t.triggerKind,
    ),
    enabledIdx: index('idx_owner_skills_enabled').on(
      t.installedByTenantId,
      t.enabled,
    ),
  }),
);

export type OwnerSkillRow = typeof ownerSkills.$inferSelect;
export type NewOwnerSkillRow = typeof ownerSkills.$inferInsert;
