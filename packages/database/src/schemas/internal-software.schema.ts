/**
 * On-Demand Internal Software persistence (Wave M8-M9).
 *
 * Companion to Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md. Drizzle
 * types for the 2 tables created by migration 0039_internal_software.sql:
 *
 *   - internalTools     → registry of MD-generated tools. Each row is
 *                          one sealed bundle (form + handler + archetype
 *                          + audit hook), with its lifecycle state and
 *                          authority tier.
 *   - internalToolRuns  → one row per tool execution. Records the actor,
 *                          inputs, outputs, and audit hash for forensic
 *                          replay.
 *
 * Both tables are tenant-scoped via the canonical `app.tenant_id` GUC
 * RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// internal_tools — registry of MD-generated tools
// ============================================================================

export const internalTools = pgTable(
  'internal_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** report | workflow | dashboard | extractor | watcher. */
    kind: text('kind').notNull(),
    /** Immutable ToolSpec shape: { form, handler, archetype, audit_hook }. */
    spec: jsonb('spec').notNull(),
    /** draft | staged | live | archived. */
    lifecycleState: text('lifecycle_state').notNull().default('draft'),
    /** T1 (default — read-only / informational) or T2 (mutating). */
    authorityTier: text('authority_tier').notNull().default('T1'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (t) => ({
    tenantLiveIdx: index('idx_internal_tools_tenant_live').on(
      t.tenantId,
      t.lifecycleState,
      t.createdAt,
    ),
    kindIdx: index('idx_internal_tools_kind').on(
      t.tenantId,
      t.kind,
      t.createdAt,
    ),
    auditHashIdx: index('idx_internal_tools_audit_hash').on(t.auditHash),
  }),
);

export type InternalToolRow = typeof internalTools.$inferSelect;
export type InternalToolInsert = typeof internalTools.$inferInsert;

// ============================================================================
// internal_tool_runs — per-execution ledger
// ============================================================================

export const internalToolRuns = pgTable(
  'internal_tool_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    toolId: uuid('tool_id')
      .notNull()
      .references(() => internalTools.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inputs: jsonb('inputs').notNull().default({}),
    outputs: jsonb('outputs').notNull().default({}),
    ranBy: uuid('ran_by').notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    toolIdx: index('idx_internal_tool_runs_tool').on(t.toolId, t.ranAt),
    tenantIdx: index('idx_internal_tool_runs_tenant').on(t.tenantId, t.ranAt),
    auditHashIdx: index('idx_internal_tool_runs_audit_hash').on(t.auditHash),
  }),
);

export type InternalToolRunRow = typeof internalToolRuns.$inferSelect;
export type InternalToolRunInsert = typeof internalToolRuns.$inferInsert;
