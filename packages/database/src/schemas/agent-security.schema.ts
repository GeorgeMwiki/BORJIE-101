/**
 * Agent Security Guard persistence (SEC-4).
 *
 * Companion to Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md. Drizzle
 * types for the 5 tables created by migration 0054_agent_security.sql:
 *
 *   - promptInjectionAttempts → direct + indirect prompt-injection
 *                                detections, hash-chained.
 *   - toolUseViolations       → rejected tool calls (authority
 *                                escalation, schema violations, etc.).
 *   - outputFilterBlocks      → scrubbed outputs (markdown-image exfil,
 *                                PII, system-prompt leakage).
 *   - agentSecuritySignals    → generic catch-all signal stream feeding
 *                                dispatch-router.
 *   - redTeamRuns             → scenario-runner outcomes for the daily
 *                                CI red-team workflow.
 *
 * All five tables use the canonical `app.tenant_id` GUC RLS policy
 * (migration 0003 pattern). Consumed by `@borjie/agent-security-guard`.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  boolean,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// prompt_injection_attempts — direct + indirect injection detections
// ============================================================================

export const promptInjectionAttempts = pgTable(
  'prompt_injection_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id'),
    channel: text('channel').notNull(),
    rawInput: text('raw_input').notNull(),
    redactedInput: text('redacted_input').notNull(),
    attackKind: text('attack_kind').notNull(),
    /** low | medium | high | critical */
    severity: text('severity').notNull(),
    blocked: boolean('blocked').notNull().default(true),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_prompt_injection_attempts_tenant').on(
      table.tenantId,
      table.detectedAt,
    ),
    kindIdx: index('idx_prompt_injection_attempts_kind').on(
      table.tenantId,
      table.attackKind,
      table.detectedAt,
    ),
    severityIdx: index('idx_prompt_injection_attempts_severity').on(
      table.tenantId,
      table.severity,
      table.detectedAt,
    ),
  }),
);

// ============================================================================
// tool_use_violations — rejected tool calls from the sandbox
// ============================================================================

export const toolUseViolations = pgTable(
  'tool_use_violations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    agentKind: text('agent_kind').notNull(),
    toolName: text('tool_name').notNull(),
    attemptedArgs: jsonb('attempted_args').notNull().default({}),
    /** authority_escalation | unknown_tool | schema_violation |
     *  missing_confirmation | recursion_limit | cross_tenant | rate_limit */
    violationKind: text('violation_kind').notNull(),
    blocked: boolean('blocked').notNull().default(true),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_tool_use_violations_tenant').on(
      table.tenantId,
      table.occurredAt,
    ),
    toolIdx: index('idx_tool_use_violations_tool').on(
      table.tenantId,
      table.toolName,
      table.occurredAt,
    ),
    kindIdx: index('idx_tool_use_violations_kind').on(
      table.tenantId,
      table.violationKind,
      table.occurredAt,
    ),
  }),
);

// ============================================================================
// output_filter_blocks — scrubbed outputs
// ============================================================================

export const outputFilterBlocks = pgTable(
  'output_filter_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    channel: text('channel').notNull(),
    outputExcerpt: text('output_excerpt').notNull(),
    filterRule: text('filter_rule').notNull(),
    blockedAt: timestamp('blocked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_output_filter_blocks_tenant').on(
      table.tenantId,
      table.blockedAt,
    ),
    ruleIdx: index('idx_output_filter_blocks_rule').on(
      table.tenantId,
      table.filterRule,
      table.blockedAt,
    ),
  }),
);

// ============================================================================
// agent_security_signals — generic signal stream
// ============================================================================

export const agentSecuritySignals = pgTable(
  'agent_security_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    signalKind: text('signal_kind').notNull(),
    /** low | medium | high | critical */
    severity: text('severity').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_agent_security_signals_tenant').on(
      table.tenantId,
      table.recordedAt,
    ),
    kindIdx: index('idx_agent_security_signals_kind').on(
      table.tenantId,
      table.signalKind,
      table.recordedAt,
    ),
    severityIdx: index('idx_agent_security_signals_severity').on(
      table.tenantId,
      table.severity,
      table.recordedAt,
    ),
  }),
);

// ============================================================================
// red_team_runs — scenario-runner results
// ============================================================================

export const redTeamRuns = pgTable(
  'red_team_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    scenario: text('scenario').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    attacksAttempted: integer('attacks_attempted').notNull().default(0),
    attacksBlocked: integer('attacks_blocked').notNull().default(0),
    attacksSucceeded: integer('attacks_succeeded').notNull().default(0),
    /** running | passed | failed | error | cancelled */
    status: text('status').notNull().default('running'),
    auditHash: text('audit_hash').notNull(),
    prevHash: text('prev_hash').notNull(),
  },
  (table) => ({
    tenantIdx: index('idx_red_team_runs_tenant').on(
      table.tenantId,
      table.startedAt,
    ),
    scenarioIdx: index('idx_red_team_runs_scenario').on(
      table.tenantId,
      table.scenario,
      table.startedAt,
    ),
    statusIdx: index('idx_red_team_runs_status').on(
      table.tenantId,
      table.status,
      table.startedAt,
    ),
  }),
);

// ============================================================================
// Inferred types — public surface
// ============================================================================

export type PromptInjectionAttemptRow =
  typeof promptInjectionAttempts.$inferSelect;
export type NewPromptInjectionAttemptRow =
  typeof promptInjectionAttempts.$inferInsert;

export type ToolUseViolationRow = typeof toolUseViolations.$inferSelect;
export type NewToolUseViolationRow = typeof toolUseViolations.$inferInsert;

export type OutputFilterBlockRow = typeof outputFilterBlocks.$inferSelect;
export type NewOutputFilterBlockRow = typeof outputFilterBlocks.$inferInsert;

export type AgentSecuritySignalRow = typeof agentSecuritySignals.$inferSelect;
export type NewAgentSecuritySignalRow =
  typeof agentSecuritySignals.$inferInsert;

export type RedTeamRunRow = typeof redTeamRuns.$inferSelect;
export type NewRedTeamRunRow = typeof redTeamRuns.$inferInsert;
