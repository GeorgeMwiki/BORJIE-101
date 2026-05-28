/**
 * Workforce Role Tab Configs + Change Requests — Wave WORKFORCE-FIXED-TABS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0091_workforce_role_tab_configs.sql
 *   - services/api-gateway/src/routes/workforce/tab-configs.hono.ts
 *   - apps/owner-web/src/app/(routes)/workforce-tabs/page.tsx
 *   - apps/workforce-mobile/src/lib/hooks/useWorkforceTabConfig.ts
 *   - packages/persona-runtime/src/workforce-tab-catalog.ts
 *
 * Two Drizzle tables:
 *
 *   workforce_role_tab_configs    — owner-set per-(role,scope) enabled
 *                                   tab list + density. One row per
 *                                   (tenant, role, site_scope).
 *
 *   workforce_tab_change_requests — worker-submitted requests to enable /
 *                                   disable tabs. Owner decides; on
 *                                   approve the diff is auto-applied.
 *
 * Both tables are tenant-scoped via the canonical
 * `current_setting('app.tenant_id', true)` GUC RLS pattern. FORCE RLS
 * per CLAUDE.md.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

// ============================================================================
// workforce_role_tab_configs — owner-set fixed-tab catalog per role+scope
// ============================================================================

export const workforceRoleTabConfigs = pgTable(
  'workforce_role_tab_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** owner | manager | supervisor | pit_operator | geologist | treasury |
     *  safety_officer | compliance_clerk. Enforced by API zod schema. */
    role: text('role').notNull(),
    /** 'global' or a site_id uuid rendered as text. */
    siteScope: text('site_scope').notNull(),
    /** Ordered subset of WORKFORCE_TAB_CATALOG ids. 'chat' is mandatory. */
    enabledTabIds: text('enabled_tab_ids').array().notNull(),
    /** comfortable | compact. */
    layoutDensity: text('layout_density').notNull().default('comfortable'),
    /** Supabase user id of the owner / admin who last updated this row. */
    updatedByUserId: text('updated_by_user_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hash-chained audit-trail link. Set on every owner PUT. */
    hashChainId: uuid('hash_chain_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
  },
  (t) => ({
    tenantRoleScopeIdx: uniqueIndex(
      'uq_workforce_role_tab_configs_tenant_role_scope',
    ).on(t.tenantId, t.role, t.siteScope),
    tenantRoleIdx: index('idx_workforce_role_tab_configs_tenant_role').on(
      t.tenantId,
      t.role,
    ),
  }),
);

export type WorkforceRoleTabConfig =
  typeof workforceRoleTabConfigs.$inferSelect;
export type NewWorkforceRoleTabConfig =
  typeof workforceRoleTabConfigs.$inferInsert;

// ============================================================================
// workforce_tab_change_requests — worker-submitted requests, owner-decided
// ============================================================================

export const workforceTabChangeRequests = pgTable(
  'workforce_tab_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Supabase user id of the worker who submitted the request. */
    requesterUserId: text('requester_user_id').notNull(),
    /** Worker's role at request time (denormalised for audit reads). */
    requesterRole: text('requester_role').notNull(),
    /** Optional site scope the request applies to. NULL = global. */
    siteId: uuid('site_id'),
    /** Worker-supplied justification. */
    reason: text('reason').notNull(),
    /** {addTabs?: text[], removeTabs?: text[], densityChange?: text}. */
    requestedChanges: jsonb('requested_changes').notNull(),
    /** pending | approved | rejected | applied | cancelled. */
    status: text('status').notNull().default('pending'),
    /** Supabase user id of the owner / admin who decided the request. */
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    /** Hash-chained audit-trail link. */
    auditHashId: uuid('audit_hash_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_workforce_tab_change_requests_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
    requesterIdx: index('idx_workforce_tab_change_requests_requester').on(
      t.tenantId,
      t.requesterUserId,
      t.createdAt,
    ),
  }),
);

export type WorkforceTabChangeRequest =
  typeof workforceTabChangeRequests.$inferSelect;
export type NewWorkforceTabChangeRequest =
  typeof workforceTabChangeRequests.$inferInsert;

// ============================================================================
// Shared types for the requested_changes jsonb document.
// ============================================================================

export interface WorkforceTabRequestedChanges {
  readonly addTabs?: ReadonlyArray<string>;
  readonly removeTabs?: ReadonlyArray<string>;
  readonly densityChange?: 'comfortable' | 'compact';
}
