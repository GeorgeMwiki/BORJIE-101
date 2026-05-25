/**
 * section_layouts (migration 0182) — adaptive-layout persistence mirror.
 *
 * The adaptive layout engine (`packages/dynamic-sections/src/lib/
 * adaptive-layout`) is a pure, deterministic, stateless function.
 * This table is its persistence side-channel — the engine writes the
 * resolved section ordering whenever a user explicitly reorders /
 * pins / hides a section from the UI, so a returning user lands on
 * the same surface they configured.
 *
 * The engine does NOT read this table to compute the layout on a
 * cold render; that would tie behaviour to a network call. Instead,
 * the table seeds {@link UserBehaviorPattern.recentActions} on
 * hydration and stores any explicit user overrides (pin / hide) so
 * the next render of the engine can fold them in as a synthetic
 * `user-override` policy (added in a follow-up).
 *
 * Composite key (tenant_id, user_id, route) — three independent
 * surfaces (owner.dashboard / tenant.dashboard / admin.dashboard)
 * get independent layouts per user.
 *
 * Tenant-scoped with RLS. See the companion migration
 * `0182_section_layouts.sql` for the policy definitions; the
 * pattern mirrors migration 0166/0169 (ENABLE + FORCE RLS, tenant-
 * isolation_select + tenant_isolation_modify, REVOKE FROM anon).
 *
 * section_order is JSONB so the engine can persist
 * {@link LayoutDecision.sections} without column-explosion. pinned
 * and hidden are TEXT[] for fast contains-checks in any future
 * query that wants "show me every user who pinned section X".
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const sectionLayouts = pgTable(
  'section_layouts',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /**
     * Route key (e.g. 'owner.dashboard', 'tenant.payments').
     * Same value the adaptive-layout engine uses for
     * {@link LayoutContext.route}.
     */
    route: text('route').notNull(),
    /**
     * Resolved section order — JSON-encoded SectionId[]. Mirrors
     * {@link LayoutDecision.sections}. Stored as JSONB so future
     * polymorphic enrichments (e.g. per-section badge state) don't
     * require a schema migration.
     */
    sectionOrder: jsonb('section_order').notNull().default([]),
    /**
     * Explicit user pins. Wins over policy recommendations.
     * TEXT[] (not JSONB) so PG contains/overlap operators stay
     * cheap. Mirrors {@link LayoutDecision.pinned}.
     */
    pinned: text('pinned').array().notNull().default([]),
    /**
     * Explicit user hides. Wins over policy recommendations.
     * Mirrors {@link LayoutDecision.hidden}.
     */
    hidden: text('hidden').array().notNull().default([]),
    /**
     * Free-form JSON for follow-up enrichments: detected intent
     * snapshot, frustration snapshot at last update, rationale for
     * the persisted ordering. Today, mostly empty.
     */
    metadata: jsonb('metadata').notNull().default({}),
    lastUpdated: timestamp('last_updated', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId, t.route] }),
    /**
     * Tenant-scoped index for "show me every user's layout on this
     * tenant for this route" — used by the per-tenant analytics that
     * surface "what does our typical owner pin?".
     */
    tenantRouteIdx: index('section_layouts_tenant_route_idx').on(
      t.tenantId,
      t.route,
    ),
    /**
     * (tenant_id, user_id, last_updated DESC) for the "most recent
     * layout per user" sweep used by the morning consolidation cycle.
     */
    tenantUserUpdatedIdx: index('section_layouts_tenant_user_updated_idx').on(
      t.tenantId,
      t.userId,
      t.lastUpdated,
    ),
  }),
);

/**
 * Row-shape aliases — useful for consumers that read this table
 * via repository methods and need the precise TS types.
 */
export type SectionLayoutRow = typeof sectionLayouts.$inferSelect;
export type SectionLayoutInsert = typeof sectionLayouts.$inferInsert;
