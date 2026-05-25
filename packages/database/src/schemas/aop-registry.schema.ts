/**
 * aop_registry — Drizzle schema (migration 0167).
 *
 * Persistent backing for the `AOPRegistryStore` port declared in
 * `packages/central-intelligence/src/agent/aops/aop-registry.ts`.
 *
 * Three sibling tables:
 *
 *   - `aop_specs`            — one row per (id, version); append-only.
 *   - `aop_regression_sets`  — one row per id; overwrite-on-id allowed.
 *   - `aop_active_versions`  — (id → active version) mapping; flipped
 *                              independently of insertion order so a
 *                              regression failure on a new version
 *                              doesn't auto-promote it.
 *
 * Tenant-scoping note:
 *   The port itself is tenant-agnostic (AOPs are typically platform-
 *   global Decagon-style specs). For multi-tenant deployments the
 *   schema carries an optional `scope_tenant_id` so the adapter can
 *   filter the listSpecs / listRegressionSets / listActiveVersions
 *   reads to a single tenant when its constructor receives a scope.
 *   NULL `scope_tenant_id` = platform-wide AOP (the default).
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - AOPs contain SYSTEM PROMPTS, never user personal data.
 *   - Tamper-resistance: `aop_specs` is append-only by convention.
 *     A NEW version is required to change behaviour.
 *   - Regression sets carry historical transcripts — the host is
 *     responsible for PII redaction before the transcript reaches
 *     the table (transcripts are produced by the eval harness, not
 *     the live kernel).
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

export const aopSpecs = pgTable(
  'aop_specs',
  {
    id: text('id').notNull(),
    version: text('version').notNull(),
    /** NULL = platform-global AOP. */
    scopeTenantId: text('scope_tenant_id'),
    /** Frozen AOPSpec JSON: system_prompt, tools, model, regression_set_id, owned_by, created_at. */
    spec: jsonb('spec').notNull(),
    insertedAt: timestamp('inserted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // (id, version) compound primary key — append-only contract.
    pk: primaryKey({ columns: [t.id, t.version] }),
    insertedAtIdx: index('idx_aop_specs_inserted_at').on(t.insertedAt),
    scopeIdx: index('idx_aop_specs_scope').on(t.scopeTenantId),
  }),
);

export const aopRegressionSets = pgTable(
  'aop_regression_sets',
  {
    id: text('id').primaryKey(),
    /** NULL = platform-global regression set. */
    scopeTenantId: text('scope_tenant_id'),
    /** Frozen RegressionSet JSON: id, transcripts[]. */
    payload: jsonb('payload').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scopeIdx: index('idx_aop_regression_sets_scope').on(t.scopeTenantId),
  }),
);

export const aopActiveVersions = pgTable(
  'aop_active_versions',
  {
    id: text('id').primaryKey(),
    /** NULL = platform-global active flag for this AOP id. */
    scopeTenantId: text('scope_tenant_id'),
    version: text('version').notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** When scope_tenant_id is non-null, (scope, id) is unique. */
    scopeIdUniq: uniqueIndex('uniq_aop_active_versions_scope_id').on(
      t.scopeTenantId,
      t.id,
    ),
  }),
);

export type AopSpecRow = typeof aopSpecs.$inferSelect;
export type AopRegressionSetRow = typeof aopRegressionSets.$inferSelect;
export type AopActiveVersionRow = typeof aopActiveVersions.$inferSelect;
