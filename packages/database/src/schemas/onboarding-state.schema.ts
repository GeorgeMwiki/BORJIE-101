/**
 * Onboarding state — Wave COMPANY-BRAIN (C-5).
 *
 * Companion to:
 *   - packages/database/src/migrations/0141_onboarding_state.sql
 *   - services/api-gateway/src/services/onboarding-jumpstart/*
 *   - services/api-gateway/src/services/ingestion-intent-inferrer/*
 *   - services/api-gateway/src/routes/owner/brain-ingest.hono.ts
 *
 * One row per tenant. The Day-1 jumpstart fires exactly once — the
 * status column gates the celebratory chat block and welcome event so
 * subsequent uploads only run the intent inferrer, not the demo flow.
 *
 * MEMORY DURABILITY: this row is upsert-only at the application layer.
 * The migration ships no DELETE policy. See Docs/OPS/MEMORY_DURABILITY.md.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const ONBOARDING_STATUSES = [
  'pending',
  'ready',
  'demoed',
  'dismissed',
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const onboardingState = pgTable(
  'onboarding_state',
  {
    tenantId: uuid('tenant_id').primaryKey(),
    firstIngestAt: timestamp('first_ingest_at', { withTimezone: true }),
    jumpstartedAt: timestamp('jumpstarted_at', { withTimezone: true }),
    firstIntentAt: timestamp('first_intent_at', { withTimezone: true }),
    status: text('status').$type<OnboardingStatus>().notNull().default('pending'),
    firstIntentJson: jsonb('first_intent_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('onboarding_state_status_idx').on(t.status),
  }),
);

export type OnboardingStateRow = typeof onboardingState.$inferSelect;
export type NewOnboardingStateRow = typeof onboardingState.$inferInsert;
