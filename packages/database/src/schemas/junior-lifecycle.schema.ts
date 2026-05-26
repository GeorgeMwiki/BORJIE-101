/**
 * Junior Dynamic Lifecycle persistence (Wave 18V-DYNAMIC).
 *
 * Companion to migration `0028_junior_dynamic_lifecycle.sql`. This
 * schema is intentionally a SIBLING to `junior-architecture.schema.ts`
 * (Wave 18V) — that file is being edited concurrently by Wave 18V-FIX,
 * so we keep the dynamic-spawning extensions file-isolated.
 *
 * Spec: `Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md`.
 *
 * NOTE: the new columns added to `junior_personas` by 0028 are NOT
 * re-declared in a Drizzle table here — the existing
 * `junior-architecture.schema.ts` keeps owning that table. Consumers
 * read the new columns via either:
 *   - the raw SQL surface (drizzle's `sql<T>` helper), or
 *   - the in-memory repository in
 *     `packages/agent-platform/src/junior-spawner/storage/`.
 *
 * This file owns the brand-new `junior_turn_feedback` table only.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// junior_turn_feedback — per-turn satisfaction signal
// ============================================================================

export const juniorTurnFeedback = pgTable(
  'junior_turn_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** junior_personas.id — the junior that took the turn. */
    juniorId: text('junior_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** agent_turns.id — the turn this feedback belongs to. */
    turnId: uuid('turn_id').notNull(),
    /** Normalised 0..1 satisfaction. Null when feedback is qualitative-only. */
    satisfactionScore: numeric('satisfaction_score', { precision: 3, scale: 2 }),
    /**
     * Upstream signal kind:
     *   - 'explicit_positive'   — thumbs-up
     *   - 'explicit_negative'   — thumbs-down
     *   - 'implicit_completed'  — turn completed without revision
     *   - 'implicit_abandoned'  — user navigated away mid-turn
     */
    feedbackKind: text('feedback_kind').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    juniorRecordedIdx: index('junior_turn_feedback_junior_recorded_idx').on(
      t.juniorId,
      t.recordedAt,
    ),
    tenantIdx: index('junior_turn_feedback_tenant_idx').on(
      t.tenantId,
      t.recordedAt,
    ),
  }),
);

export type JuniorTurnFeedbackRow = typeof juniorTurnFeedback.$inferSelect;
export type JuniorTurnFeedbackInsert = typeof juniorTurnFeedback.$inferInsert;
