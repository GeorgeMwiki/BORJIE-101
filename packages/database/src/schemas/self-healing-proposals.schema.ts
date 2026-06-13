/**
 * Self-Healing Proposals — the INTERNAL-ADMIN self-healing console queue.
 *
 * Every UI/wiring blocker the MAPE-K loop processes
 * (packages/portal-genui/src/self-healing/self-heal.ts) is recorded here for
 * the Borjie PLATFORM team to triage. Needs-approval, code-gated repair
 * proposals (corrupt-spec / render-error / unwired-rule / dead-export) sit
 * alongside auto-healed observations (the crystallization-candidate signal:
 * unknown render kinds, unmapped bindings). The OWNER never sees this — these
 * are Borjie engineering issues, not tenant operations.
 *
 * Platform-internal: `tenant_id` is nullable triage context only, NOT an
 * access boundary. The table is FORCE-RLS with a service-role-only bypass
 * policy (migration 0349), pinned in the rls-coverage GLOBAL_SPINE_TABLES
 * registry. The internal-admin routes read + decide via withServiceRoleContext.
 *
 * Companion to:
 *   - packages/database/src/migrations/0349_self_healing_proposals.sql
 *   - services/api-gateway/src/composition/portal-genui/self-healing-store.ts
 *   - services/api-gateway/src/routes/mining/internal/self-healing.hono.ts
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const selfHealingProposals = pgTable(
  'self_healing_proposals',
  {
    id: text('id').primaryKey(),
    blockerKind: text('blocker_kind').notNull(),
    repairClass: text('repair_class').notNull(),
    locus: text('locus').notNull(),
    detail: text('detail'),
    title: text('title').notNull(),
    suggestedFix: text('suggested_fix').notNull(),
    insight: text('insight').notNull(),
    actionPlan: jsonb('action_plan')
      .notNull()
      .$type<ReadonlyArray<string>>()
      .default([]),
    autoApplicable: boolean('auto_applicable').notNull().default(false),
    /** Nullable triage context — which tenant's render hit it. NOT a boundary. */
    tenantId: text('tenant_id'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    /** blocker_kind || ':' || locus — the UNIQUE dedupe target. */
    dedupeKey: text('dedupe_key').notNull(),
    /** pending | auto-healed | approved | denied. */
    status: text('status').notNull().default('pending'),
    decidedByActorId: text('decided_by_actor_id'),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeKey: uniqueIndex('self_healing_proposals_dedupe_key').on(t.dedupeKey),
    statusSeen: index('self_healing_proposals_status_seen_idx').on(
      t.status,
      t.lastSeenAt,
    ),
  }),
);

export type SelfHealingProposalRow = typeof selfHealingProposals.$inferSelect;
export type SelfHealingProposalInsert =
  typeof selfHealingProposals.$inferInsert;

/** The lifecycle states a proposal can be in. */
export const SELF_HEALING_STATUSES = [
  'pending',
  'auto-healed',
  'approved',
  'denied',
] as const;
export type SelfHealingStatus = (typeof SELF_HEALING_STATUSES)[number];
