/**
 * Agentic plan / subagent + sandbox-preview schema — Borjie mining domain
 * (migration 0281).
 *
 * Brings Mr. Mwikila to Claude-Code-parity "plan mode" + "agent teams" + a
 * worktree-style sandbox where the brain STAGES a mutation, the owner reviews
 * payload + rationale, then commits (atomic real-table write + an append-only
 * audit row) or rejects (rejection log). Nothing the brain stages reaches a
 * real table until the owner commits.
 *
 * Ported from the BN md-agentic stack (itself a LitFin iter-32 plan-mode +
 * iter-36 agent-teams / sandbox-writes port) and retargeted to Borjie's
 * mining-estate domain.
 *
 * Companion files:
 *   - packages/database/src/migrations/0281_md_agentic_sandbox.sql
 *   - services/api-gateway/src/composition/md-agentic-repository.ts
 *   - services/api-gateway/src/composition/md-sandbox-payload.ts
 *   - services/api-gateway/src/routes/md-agentic.hono.ts
 *   - services/api-gateway/src/composition/brain-tools/md-agentic-tools.ts
 *
 * Five tables:
 *   - md_plans            one row per proposed multi-step plan (proposal
 *                         only — execution stays governed step-by-step)
 *   - md_subagent_runs    one row per dispatched subagent — honest-degrade:
 *                         persisted at status 'pending'; aggregate reads
 *                         persisted results and NEVER fabricates output
 *   - md_sandbox_writes   one row per STAGED mutation awaiting owner review
 *   - md_sandbox_commits  append-only audit row written on commit
 *   - md_sandbox_rejects  append-only rejection log
 *
 * Sandbox target allowlist: the gap-2 org/team tables only
 * (staff_members / staff_kpis / org_tasks / org_escalations, migration 0280),
 * so a committed write lands inside the same tenant isolation.
 *
 * Tenant scope (CLAUDE.md hard rule): tenant-scoped FORCE RLS on the canonical
 * `app.current_tenant_id` GUC. `tenant_id` is TEXT (Borjie convention) —
 * never the legacy `app.tenant_id`. Every query the repository runs is also
 * tenant-filtered defensively.
 *
 * Multi-currency (CLAUDE.md hard rule): NOTHING here hard-codes a jurisdiction
 * currency. A staged payload that carries money is opaque JSONB validated at
 * commit time; no currency code lives here.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ── enum value catalogs (mirrored as CHECK constraints in mig 0281) ────

/** Plan lifecycle. */
export const MD_PLAN_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'executing',
  'completed',
  'cancelled',
] as const;
export type MdPlanStatus = (typeof MD_PLAN_STATUSES)[number];

/** Subagent role catalog (Claude-Code-parity agent teams). */
export const MD_SUBAGENT_ROLES = [
  'explorer',
  'reviewer',
  'synthesizer',
  'researcher',
  'executor',
] as const;
export type MdSubagentRole = (typeof MD_SUBAGENT_ROLES)[number];

/**
 * Subagent run lifecycle. 'unavailable' is the honest-degrade terminal —
 * dispatch persists 'pending'; with no executor wired the run never leaves
 * 'pending' and aggregate reports 'unavailable' (never fabricates output).
 */
export const MD_SUBAGENT_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'budget_exceeded',
  'unavailable',
] as const;
export type MdSubagentStatus = (typeof MD_SUBAGENT_STATUSES)[number];

/** Aggregation strategies over a team's subagent results. */
export const MD_AGGREGATIONS = [
  'majority_vote',
  'best_of_n',
  'merge_all',
  'first_success',
] as const;
export type MdAggregation = (typeof MD_AGGREGATIONS)[number];

/** Sandbox write target tables — the gap-2 org/team tables only. */
export const MD_SANDBOX_TARGET_TABLES = [
  'staff_members',
  'staff_kpis',
  'org_tasks',
  'org_escalations',
] as const;
export type MdSandboxTargetTable = (typeof MD_SANDBOX_TARGET_TABLES)[number];

/** Sandbox write operation. */
export const MD_SANDBOX_OPERATIONS = ['insert', 'update'] as const;
export type MdSandboxOperation = (typeof MD_SANDBOX_OPERATIONS)[number];

/** Sandbox write lifecycle. */
export const MD_SANDBOX_STATUSES = [
  'pending',
  'committed',
  'rejected',
  'expired',
] as const;
export type MdSandboxStatus = (typeof MD_SANDBOX_STATUSES)[number];

// ── md_plans ───────────────────────────────────────────────────────────

export const mdPlans = pgTable(
  'md_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    /** Ordered list of { stepIndex, tool, input, rationale }. */
    steps: jsonb('steps').notNull().default([]),
    estimatedImpact: text('estimated_impact'),
    status: text('status').notNull().default('proposed'),
    proposedByUserId: text('proposed_by_user_id'),
    originSessionId: text('origin_session_id'),
    metadata: jsonb('metadata').notNull().default({}),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('md_plans_tenant_status').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
  }),
);

export type MdPlan = typeof mdPlans.$inferSelect;
export type NewMdPlan = typeof mdPlans.$inferInsert;

// ── md_subagent_runs ───────────────────────────────────────────────────

export const mdSubagentRuns = pgTable(
  'md_subagent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Logical team grouping — all members of one dispatch share this. */
    teamRunId: uuid('team_run_id').notNull(),
    /** Optional plan that spawned this team (ON DELETE SET NULL). */
    planId: uuid('plan_id').references(() => mdPlans.id, {
      onDelete: 'set null',
    }),
    role: text('role').notNull(),
    brief: text('brief').notNull(),
    allowedTools: jsonb('allowed_tools').notNull().default([]),
    tokenBudget: integer('token_budget').notNull().default(0),
    aggregation: text('aggregation').notNull().default('merge_all'),
    status: text('status').notNull().default('pending'),
    /** Populated by an executor (when wired) — never fabricated. */
    result: jsonb('result'),
    error: text('error'),
    spawnedByUserId: text('spawned_by_user_id'),
    originSessionId: text('origin_session_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTeamIdx: index('md_subagent_runs_tenant_team').on(
      t.tenantId,
      t.teamRunId,
      t.status,
    ),
    tenantStatusIdx: index('md_subagent_runs_tenant_status').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
  }),
);

export type MdSubagentRun = typeof mdSubagentRuns.$inferSelect;
export type NewMdSubagentRun = typeof mdSubagentRuns.$inferInsert;

// ── md_sandbox_writes ──────────────────────────────────────────────────

export const mdSandboxWrites = pgTable(
  'md_sandbox_writes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    targetTable: text('target_table').notNull(),
    operation: text('operation').notNull(),
    /** Required for operation='update' (CHECK in the migration). */
    targetRowId: uuid('target_row_id'),
    proposedPayload: jsonb('proposed_payload').notNull(),
    rationale: text('rationale'),
    status: text('status').notNull().default('pending'),
    planId: uuid('plan_id').references(() => mdPlans.id, {
      onDelete: 'set null',
    }),
    proposedByUserId: text('proposed_by_user_id'),
    originSessionId: text('origin_session_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('md_sandbox_writes_tenant_status').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    tenantTableIdx: index('md_sandbox_writes_tenant_table').on(
      t.tenantId,
      t.targetTable,
      t.status,
    ),
  }),
);

export type MdSandboxWrite = typeof mdSandboxWrites.$inferSelect;
export type NewMdSandboxWrite = typeof mdSandboxWrites.$inferInsert;

// ── md_sandbox_commits ─────────────────────────────────────────────────

export const mdSandboxCommits = pgTable(
  'md_sandbox_commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sandboxWriteId: uuid('sandbox_write_id')
      .notNull()
      .references(() => mdSandboxWrites.id, { onDelete: 'cascade' }),
    targetTable: text('target_table').notNull(),
    operation: text('operation').notNull(),
    targetRowId: uuid('target_row_id'),
    /** Pre-commit row snapshot for UPDATE — rollback evidence. */
    preCommitSnapshot: jsonb('pre_commit_snapshot'),
    committedPayload: jsonb('committed_payload').notNull().default({}),
    committedByUserId: text('committed_by_user_id'),
    originSessionId: text('origin_session_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantWriteIdx: index('md_sandbox_commits_tenant_write').on(
      t.tenantId,
      t.sandboxWriteId,
    ),
    tenantCreatedIdx: index('md_sandbox_commits_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type MdSandboxCommit = typeof mdSandboxCommits.$inferSelect;
export type NewMdSandboxCommit = typeof mdSandboxCommits.$inferInsert;

// ── md_sandbox_rejects ─────────────────────────────────────────────────

export const mdSandboxRejects = pgTable(
  'md_sandbox_rejects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    sandboxWriteId: uuid('sandbox_write_id')
      .notNull()
      .references(() => mdSandboxWrites.id, { onDelete: 'cascade' }),
    targetTable: text('target_table').notNull(),
    reason: text('reason').notNull(),
    rejectedByUserId: text('rejected_by_user_id'),
    originSessionId: text('origin_session_id'),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantWriteIdx: index('md_sandbox_rejects_tenant_write').on(
      t.tenantId,
      t.sandboxWriteId,
    ),
    tenantCreatedIdx: index('md_sandbox_rejects_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

export type MdSandboxReject = typeof mdSandboxRejects.$inferSelect;
export type NewMdSandboxReject = typeof mdSandboxRejects.$inferInsert;
