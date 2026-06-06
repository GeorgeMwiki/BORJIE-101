/**
 * Mining onboarding runs — FLOW-2.
 *
 * Companion to migration 0286. ONE row per owner onboarding-wizard run:
 * the current step, status, and an append-only `steps` jsonb holding every
 * advanced step's payload (incl. uploaded file refs) so a reload resumes
 * where the owner left off and a file-bearing step's payload is persisted,
 * not discarded.
 *
 * Backs services/api-gateway/src/routes/mining/onboarding.hono.ts
 * (POST /onboarding/start | advance | complete), consumed by
 * apps/owner-web/src/lib/queries/onboarding.ts.
 *
 * Money path (CLAUDE.md): NO money column — onboarding seeds the cockpit, it
 * never moves money. Tenant-isolation: FORCE RLS in migration 0286 on the
 * canonical `app.current_tenant_id` GUC (mirrors 0159 / 0284).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const MINING_ONBOARDING_STEPS = [
  'kyb',
  'licences',
  'sites',
  'drill_holes',
  'cockpit_seed',
  'complete',
] as const;
export type MiningOnboardingStep = (typeof MINING_ONBOARDING_STEPS)[number];

export const MINING_ONBOARDING_STATUSES = [
  'in_progress',
  'complete',
  'abandoned',
] as const;
export type MiningOnboardingStatus =
  (typeof MINING_ONBOARDING_STATUSES)[number];

export const miningOnboardingRuns = pgTable(
  'mining_onboarding_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** Owner / user who started the run (defence-in-depth scope, no IDOR). */
    createdByUserId: text('created_by_user_id').notNull(),
    /** kyb | licences | sites | drill_holes | cockpit_seed | complete. */
    currentStep: text('current_step')
      .$type<MiningOnboardingStep>()
      .notNull()
      .default('kyb'),
    /** in_progress | complete | abandoned. */
    status: text('status')
      .$type<MiningOnboardingStatus>()
      .notNull()
      .default('in_progress'),
    /** Append-only map of step -> persisted payload (incl. file refs). */
    steps: jsonb('steps').notNull().default({}),
    /** Set by /complete when the cockpit is seeded. */
    cockpitSeed: jsonb('cockpit_seed').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('idx_mining_onboarding_runs_tenant_status').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    tenantUserIdx: index('idx_mining_onboarding_runs_tenant_user').on(
      t.tenantId,
      t.createdByUserId,
      t.createdAt,
    ),
  }),
);

export type MiningOnboardingRun = typeof miningOnboardingRuns.$inferSelect;
export type NewMiningOnboardingRun = typeof miningOnboardingRuns.$inferInsert;
