/**
 * portal_tabs — the MD-authored "infinite dynamic tabs" store.
 *
 * Companion to migration 0170. Backs the `PortalTab` Zod document in
 * `@borjie/portal-genui` (types.ts): the brain (Mr. Mwikila) detects a
 * tab-generation intent from chat, drafts a complete tab — sections of typed
 * fields + widgets + persona permissions — zod-validates it, and persists one
 * row here so the tab survives sign-out and re-appears on the next login.
 *
 * Dynamic SIBLING of portal_layouts (0164)
 * ----------------------------------------
 * portal_layouts stores the per-user FRAME (topbar / sidebar / dashboard
 * cells). portal_tabs stores the dynamic tabs that hang off that frame. Same
 * storage model: typed header columns (tenantId, userId, tabKey, schemaVersion,
 * parentTabId, createdAt, updatedAt) live OUTSIDE the JSONB `tab` blob so the
 * unique index, RLS, and lineage lookups work without GIN extractors.
 *
 * Source-of-truth note
 * --------------------
 * The portal-genui engine's persistence adapter
 * (`packages/portal-genui/src/persistence/drizzle-tab-repo.ts`) speaks plain
 * parameterised SQL against these exact column names — it does NOT import this
 * Drizzle table (the engine stays React/Drizzle-free). This schema therefore
 * exists for type-safe consumers inside `@borjie/database` + migration tests;
 * the column set MUST stay in lockstep with both the adapter's SQL and
 * migration 0170. The `portal_tabs` table introspection test locks that.
 *
 * Money path (CLAUDE.md hard rule)
 * --------------------------------
 * NO money column BY DESIGN. A tab is a UI/forms document. Any money a generated
 * form ultimately captures still flows through the gated action-executor verbs
 * (LedgerService owns the money path). Nothing money-shaped is writable here.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0170 on
 * `current_setting('app.current_tenant_id', true)` (mirrors 0164). UNIQUE on
 * (tenant_id, tab_key) — one tab_key per tenant. The app additionally predicates
 * on tenant_id in every query (belt-and-braces).
 */

import {
  pgTable,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// portal_tabs — one row per MD-authored dynamic PortalTab document
// ============================================================================

export const portalTabs = pgTable(
  'portal_tabs',
  {
    /** Stable tab document id (engine-minted, e.g. `tab_<hex>`). */
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /**
     * Owning user. NULL means a tenant-default tab visible to the persona set;
     * non-NULL means a user-specific tab. Carried for provenance; isolation is
     * by TENANT.
     */
    userId: text('user_id'),
    /** Stable routing key (e.g. `hr.payroll`). Unique per tenant (0170). */
    tabKey: text('tab_key').notNull(),
    /** PortalTab schema version — currently 1 (PORTAL_TAB_SCHEMA_VERSION). */
    schemaVersion: integer('schema_version').notNull().default(1),
    /** Whole validated `PortalTab` document as JSON. Validated by the engine. */
    tab: jsonb('tab').notNull(),
    /** Parent doc this was forked from, for "previous version" lineage. */
    parentTabId: text('parent_tab_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Listing hot path — tenant-default + per-user reads. */
    tenantUserIdx: index('portal_tabs_tenant_user_idx').on(
      t.tenantId,
      t.userId,
    ),
    /** Lineage lookup for "previous version" diffs. */
    parentIdx: index('portal_tabs_parent_idx').on(t.parentTabId),
    /** One tab_key per tenant (matches the UNIQUE INDEX in migration 0170). */
    tenantTabKeyUq: uniqueIndex('portal_tabs_tenant_tab_key_uq').on(
      t.tenantId,
      t.tabKey,
    ),
  }),
);

export type PortalTabRow = typeof portalTabs.$inferSelect;
export type NewPortalTabRow = typeof portalTabs.$inferInsert;
