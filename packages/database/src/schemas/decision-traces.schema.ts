/**
 * decision_traces (migration 0185) — F10 DecisionTrace persistence.
 *
 * One row per finalised {@link DecisionTraceFinalised} emitted by
 * `@borjie/observability`. The audit shape mirrors LITFIN's
 * structured per-decision trace abstraction: a unit-of-explanation
 * a human auditor cares about (which alternative branches were
 * considered, which one was chosen, why).
 *
 * Tenant-scoped via RLS (see companion migration
 * `0185_decision_traces.sql`). The admin replay UI uses the
 * service-role client to bypass RLS (platform-staff surface).
 *
 * Column conventions:
 *   - `id` is the trace UUID emitted by `startDecisionTrace`. Acts as
 *     the unique idempotency key for retried publishes.
 *   - `inputs`, `branches`, `attributes`, `output` are JSONB so the
 *     audit shape survives schema additions without column churn.
 *   - `branches` is a JSONB ARRAY (single column holding the whole
 *     branch list) — easier to scan + render in the replay UI than a
 *     separate row-per-branch child table for write-once audit data.
 *   - `tenant_id` is nullable so platform-tier decisions (e.g. the
 *     identity middleware resolving a tenant from a JWT — there isn't
 *     a tenant yet at that point) can still record a trace.
 *
 * Index: `(tenant_id, started_at DESC)` for the admin list view's
 * "recent traces for tenant" filter. The admin UI also filters by
 * outcome, but that's a low-cardinality enum so a partial index
 * isn't worth the write cost.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';

export const decisionTraces = pgTable(
  'decision_traces',
  {
    /** Trace UUID — matches `DecisionTraceFinalised.traceId`. */
    id: text('id').primaryKey(),
    /**
     * Tenant id the decision was made FOR. NULL for platform-tier
     * decisions made before a tenant context exists (e.g. the
     * tenant-resolution middleware itself recording why it resolved
     * tenant X). RLS policy treats NULL as platform-only — visible
     * only to the service-role admin client.
     */
    tenantId: text('tenant_id'),
    /** Action name, e.g. `approvals.approve` / `payments.disburse`. */
    name: text('name').notNull(),
    /** ISO 8601 wall-clock when the trace opened. */
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    /** ISO 8601 wall-clock when `finalize()` was called. */
    finalisedAt: timestamp('finalised_at', { withTimezone: true }).notNull(),
    /** Duration in ms (`finalisedAt - startedAt`, monotonically >= 0). */
    durationMs: integer('duration_ms').notNull().default(0),
    /** JSON-cloneable inputs the decision saw. */
    inputs: jsonb('inputs').notNull().default({}),
    /**
     * Branches considered. JSONB array of DecisionBranch shapes
     * (id, label, rationale, score?, metadata?, recordedAt). Stored as
     * a single column so the replay UI can render the timeline in one
     * read.
     */
    branches: jsonb('branches').notNull().default([]),
    /** Id of the chosen branch, or NULL if the decision refused all. */
    chosenBranchId: text('chosen_branch_id'),
    /** Rationale text attached to the chosen branch. */
    chosenRationale: text('chosen_rationale'),
    /**
     * Coarse outcome enum: 'approved' | 'rejected' | 'executed' |
     * 'refused' | 'failed'. Stored as TEXT (not a pg enum) so we can
     * widen the set without a follow-up migration — audit data should
     * never block a schema evolution.
     */
    outcome: text('outcome').notNull(),
    /** Free-form attributes attached via `trace.addAttribute(...)`. */
    attributes: jsonb('attributes').notNull().default({}),
    /** Final decision payload (any JSON-cloneable value, or `null`). */
    output: jsonb('output'),
    /** Error message when `outcome = 'failed'`. */
    error: text('error'),
    /** Actor / user id for traceability. */
    userId: text('user_id'),
    /** Correlation id (joins to API request log). */
    requestId: text('request_id'),
    /** Parent trace id when this trace is nested inside another. */
    parentTraceId: text('parent_trace_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /**
     * Primary lookup pattern from the admin replay UI: "recent traces
     * for tenant X, newest first". DESC index keeps the paginated
     * list view trivially cheap.
     */
    tenantStartedAtIdx: index('decision_traces_tenant_started_idx').on(
      t.tenantId,
      t.startedAt,
    ),
    /** Filter "show me every failure for tenant X". */
    tenantOutcomeIdx: index('decision_traces_tenant_outcome_idx').on(
      t.tenantId,
      t.outcome,
    ),
    /** Replay individual trace by id — auto-created by PK, here for symmetry. */
    nameStartedAtIdx: index('decision_traces_name_started_idx').on(
      t.name,
      t.startedAt,
    ),
  }),
);

/** Row-shape type aliases used by repository methods. */
export type DecisionTraceRow = typeof decisionTraces.$inferSelect;
export type DecisionTraceInsert = typeof decisionTraces.$inferInsert;
