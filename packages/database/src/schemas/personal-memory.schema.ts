/**
 * Unified Personal Knowledge Base — `personal_memory_cells`.
 *
 * Companion to migration 0088 and `Docs/research/unified-personal-kb.md`
 * §10. The federated personal-memory store: one row per (person_id,
 * cell_kind, key) triple. Stores Asha's personal preferences, ongoing
 * contexts, recurring facts, calibration deltas, and sentiment
 * snapshots — the data she would lose today every time she switches
 * between Mine A, Mine B, Mine C, and Refiner D.
 *
 * RLS posture (FEDERATED — NO ROW LEVEL SECURITY):
 *
 *   This table mirrors the precedent of `platform_memory_cells` in
 *   `cognitive-memory.schema.ts` §159. NO RLS is enabled. There is NO
 *   `tenant_id` column. Access is gated by `person_id` only, via the
 *   future `app.current_person_id` GUC predicate bound at the api-
 *   gateway middleware layer.
 *
 *   Symmetric isolation between person-memory and tenant-memory is
 *   enforced at the brain orchestrator boundary-tagger layer
 *   (Docs/research/unified-personal-kb.md §5). Tenant queries cannot
 *   see person rows; person queries cannot see tenant rows. Both are
 *   UNION-ALLed at the orchestrator with explicit `origin` tags so
 *   the reply composer can drop cross-tenant candidate tokens before
 *   they reach the LLM.
 *
 * `source_tenant_id` and `source_thread_id` are provenance ONLY — they
 * are never used to filter access. They exist to power the audit chain
 * and the "where did this fact come from?" introspection in the
 * persona-runtime debug UI.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';

import { persons } from './persons.schema.js';

// ============================================================================
// personal_memory_cells — federated personal memory (NO RLS, no tenant_id)
// ============================================================================

export const personalMemoryCells = pgTable(
  'personal_memory_cells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    /**
     * preference   — durable likes/dislikes ("call me Asha, not Madam").
     * context      — current state ("recovering from flu this week").
     * recurring-fact — stable life facts ("my mother died Aug 2024").
     * calibration  — per-user model calibration ("prefers conservative
     *                buy thresholds").
     * sentiment    — recent emotional snapshot ("stressed about Mine B
     *                payroll deadline").
     */
    cellKind: text('cell_kind').notNull(),
    /** Cell key — domain identifier inside its `cell_kind` family. */
    key: text('key').notNull(),
    /** Structured value payload. */
    value: jsonb('value').notNull(),
    /** [0,1] confidence dial. Default 1.0 (user-stated). */
    confidence: numeric('confidence', { precision: 3, scale: 2 })
      .notNull()
      .default('1.0'),
    /**
     * Provenance only — which tenant context produced this cell.
     * NEVER used to filter access. NULL when the cell came from a
     * person-level interaction (e.g. settings screen, voice intro).
     */
    sourceTenantId: uuid('source_tenant_id'),
    /** Provenance only — origin conversation thread. */
    sourceThreadId: uuid('source_thread_id'),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Optional TTL; NULL means the cell does not expire. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    personKindIdx: index('idx_personal_memory_person_kind').on(
      t.personId,
      t.cellKind,
    ),
    /**
     * One cell per (person, kind, key) triple. Upserts replace the
     * value + confidence + captured_at when the same key fires again.
     */
    personKindKeyUnique: unique('uq_personal_memory_person_kind_key').on(
      t.personId,
      t.cellKind,
      t.key,
    ),
  }),
);

export type PersonalMemoryCellRow = typeof personalMemoryCells.$inferSelect;
export type PersonalMemoryCellInsert =
  typeof personalMemoryCells.$inferInsert;
