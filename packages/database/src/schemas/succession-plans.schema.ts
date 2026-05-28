/**
 * Succession Plans — Wave ESTATE-OS.
 *
 * Companion to:
 *   - packages/database/src/migrations/0094_mining_estate_holdings.sql
 *   - services/api-gateway/src/routes/estate/succession-plans.hono.ts
 *
 * Multi-generational view per estate group. Tracks current principal,
 * designated successor, contingency, will doc reference, and
 * `next_review_due_at` which drives reminders via the existing
 * reminders worker.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const SUCCESSION_PLAN_STATUSES = [
  'drafted',
  'witnessed',
  'registered',
  'contested',
  'executed',
] as const;
export type SuccessionPlanStatus = (typeof SUCCESSION_PLAN_STATUSES)[number];

export const successionPlans = pgTable(
  'succession_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    estateGroupId: uuid('estate_group_id').notNull(),
    currentPrincipalName: text('current_principal_name').notNull(),
    designatedSuccessorName: text('designated_successor_name').notNull(),
    designatedSuccessorRelation: text('designated_successor_relation').notNull(),
    designatedSuccessorNida: text('designated_successor_nida'),
    contingencySuccessorName: text('contingency_successor_name'),
    /** Optional pointer to a will document. */
    willDocId: uuid('will_doc_id'),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    nextReviewDueAt: timestamp('next_review_due_at', {
      withTimezone: true,
    }).notNull(),
    status: text('status').notNull().default('drafted'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    groupIdx: index('idx_succession_plans_group').on(
      t.tenantId,
      t.estateGroupId,
    ),
    reviewDueIdx: index('idx_succession_plans_review_due').on(
      t.nextReviewDueAt,
    ),
  }),
);

export type SuccessionPlanRow = typeof successionPlans.$inferSelect;
export type SuccessionPlanInsert = typeof successionPlans.$inferInsert;
