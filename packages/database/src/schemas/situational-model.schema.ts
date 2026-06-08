/**
 * Situational-model persistence (Wave 1, organ #2 — the resident mind's
 * standing situational state).
 *
 * Companion to the `SituationalModelStore` port in
 * `@borjie/central-intelligence` (kernel/situational-model). Drizzle types for
 * the one table created by migration 0317_situational_model.sql:
 *
 *   - situationalModelEntities → one row per (tenant_id, kind, entity_id). The
 *     ACT-R "optimized learning" base-level summary (reference_count,
 *     first/last_referenced_at) keeps the row bounded; `attributes` holds the
 *     domain measurements the motivation drives read; `associations` holds the
 *     spreading-activation link strengths. Activation/salience itself is NEVER
 *     stored — it is computed on read from this row + the read-instant.
 *     Tenant-scoped, RLS (canonical `app.current_tenant_id` GUC + service-role
 *     bypass), migration 0317.
 *
 * The volatile in-memory + blackboard-slot adapters live in
 * `@borjie/central-intelligence`. This Drizzle table backs the DURABLE
 * counterpart selected at the composition root when a live DB handle is
 * available — so the situational model SURVIVES a process restart. NULL-tenant
 * rows are never written by this store.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ============================================================================
// situational_model_entities — the per-tenant standing situational state.
// ============================================================================

export const situationalModelEntities = pgTable(
  'situational_model_entities',
  {
    tenantId: text('tenant_id').notNull(),
    /** licence | counterparty | site | arrears | equipment | cash. */
    kind: text('kind').notNull(),
    entityId: text('entity_id').notNull(),
    label: text('label').notNull(),
    /** Domain measurements the motivation drives evaluate (opaque). */
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** Spreading-activation link strengths to other `${kind}:${id}` keys. */
    associations: jsonb('associations')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    /** ACT-R base-level frequency term. */
    referenceCount: integer('reference_count').notNull().default(1),
    /** Span anchor for the base-level recency decay. */
    firstReferencedAt: timestamp('first_referenced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Drives the explicit recency spike. */
    lastReferencedAt: timestamp('last_referenced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.kind, t.entityId] }),
    tenantIdx: index('idx_situational_model_tenant').on(t.tenantId),
    tenantLastRefIdx: index('idx_situational_model_tenant_last_ref').on(
      t.tenantId,
      t.lastReferencedAt,
    ),
  }),
);

export type SituationalModelEntityRow =
  typeof situationalModelEntities.$inferSelect;
export type SituationalModelEntityInsert =
  typeof situationalModelEntities.$inferInsert;
