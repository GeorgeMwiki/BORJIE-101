/**
 * support_cases — Mr. Mwikila's PERSISTENT technical-support memory.
 *
 * Companion to migration 0164. One root-caused support/diagnosis case per user
 * issue (a payment failure, a general question). The case is the DURABLE MEMORY
 * that lets the MD never lose context across sessions/devices: at every brain
 * turn the OPEN/active cases for (tenant, user) are recalled (a cheap query, NOT
 * an LLM call) and injected so the MD always remembers "we were debugging your
 * M-Pesa failure; here is what is fixed and what remains".
 *
 * Evidence-required (CLAUDE.md hard rule)
 * ---------------------------------------
 * `evidenceIds` carries the audit / payment_intent / webhook record ids that
 * PROVE the diagnosis. The payment-inspector refuses to return a diagnosis with
 * an empty evidence chain, so a case is never opened without proof, and the
 * Auditor agent rejects empty-evidence responses.
 *
 * Money path (CLAUDE.md hard rule)
 * --------------------------------
 * This table carries NO money column BY DESIGN. Diagnosis is READ-ONLY; any
 * actual fix routes through the existing gated action-executor verbs
 * (LedgerService owns the money path). There is nothing money-shaped here.
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0164 on
 * `current_setting('app.current_tenant_id', true)` (mirrors 0162/0163). The
 * service additionally predicates on `user_id` in every query (belt-and-braces).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// support_cases — one persistent support/diagnosis case per user issue
// ============================================================================

export const supportCases = pgTable(
  'support_cases',
  {
    id: text('id').primaryKey(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** The user the support specialist is serving (per-user scoping). */
    userId: text('user_id').notNull(),
    /** Optional brain thread the case was raised in. */
    threadId: text('thread_id'),
    title: text('title').notNull(),
    /** 'payment' | 'general' (free text — the service uses a small closed set). */
    category: text('category').notNull().default('general'),
    /** open | diagnosing | awaiting_user | resolved | escalated (CHECK in 0164). */
    status: text('status').notNull().default('open'),
    /** low | medium | high | critical (CHECK in 0164). */
    severity: text('severity').notNull().default('medium'),
    /** Human-facing one-line summary of the issue. */
    summary: text('summary'),
    /** Machine-classified root cause (e.g. `insufficient_balance`). */
    rootCause: text('root_cause'),
    /**
     * jsonb array of { label, state:'done'|'remaining'|'blocked', note } so the
     * case can show the user what is fixed / remaining at a glance.
     */
    steps: jsonb('steps').notNull().default([]),
    /**
     * jsonb array of the audit / payment_intent / webhook record ids that PROVE
     * the diagnosis (evidence-required — never empty for a real diagnosis).
     */
    evidenceIds: jsonb('evidence_ids').notNull().default([]),
    /** Human-facing resolution text once the issue is closed. */
    resolution: text('resolution'),
    /** Reference to the escalation row in the support queue (NULL until escalated). */
    escalationRef: text('escalation_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    // Recall hot path: this user's OPEN/active cases for this tenant.
    tenantUserStatusIdx: index('support_cases_tenant_user_status_idx').on(
      t.tenantId,
      t.userId,
      t.status,
    ),
    // Tenant-wide triage / support-queue listing by status.
    tenantStatusIdx: index('support_cases_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
  }),
);

export type SupportCase = typeof supportCases.$inferSelect;
export type NewSupportCase = typeof supportCases.$inferInsert;

/** Closed set of case statuses (mirrors the 0164 CHECK constraint). */
export const SUPPORT_CASE_STATUSES = [
  'open',
  'diagnosing',
  'awaiting_user',
  'resolved',
  'escalated',
] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];

/** Closed set of case severities (mirrors the 0164 CHECK constraint). */
export const SUPPORT_CASE_SEVERITIES = [
  'low',
  'medium',
  'high',
  'critical',
] as const;
export type SupportCaseSeverity = (typeof SUPPORT_CASE_SEVERITIES)[number];

/** One row of the `steps` jsonb array. */
export interface SupportCaseStep {
  readonly label: string;
  readonly state: 'done' | 'remaining' | 'blocked';
  readonly note?: string;
}
