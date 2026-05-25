/**
 * TaskAgent framework — Phase B Wave 30.
 *
 * A TaskAgent is a narrow, single-purpose AI-adjacent worker that does one
 * job (e.g. "rent_reminder_agent" → send rent reminders 3 days before due
 * date) on its own trigger under per-tenant autonomy-policy guardrails.
 *
 * Design goals:
 *   - Density: prefer many tiny agents (≤ 100 lines each) over a few huge
 *     orchestrators.
 *   - Uniform contract: every agent declares a trigger, guardrails, a zod
 *     payload schema, and an `execute(ctx)` method. The executor wraps
 *     each run in audit + PlatformEvent emission.
 *   - Honest about scope: agents DO NOT rewrite existing services — they
 *     wrap them. The arrears ladder tick, renewal service, etc. all stay
 *     put; this layer just lets them be invoked + audited uniformly.
 *
 * Persistence: runs are audited through the existing `audit_events` table
 * (via `services.audit`) and also emit a `TaskAgentRan` PlatformEvent on
 * the event bus so downstream subscribers (webhook workers, observability)
 * see every run.
 */

import type { z, ZodTypeAny } from 'zod';
import type { AutonomyDomain } from '../autonomy/types.js';

// ---------------------------------------------------------------------------
// Trigger shapes
// ---------------------------------------------------------------------------

/** Agent runs on a cron cadence (e.g. daily 06:00, weekly Sunday 03:00). */
export interface CronTrigger {
  readonly kind: 'cron';
  readonly cron: string;
  readonly description: string;
}

/** Agent fires in reaction to a domain event (e.g. 'UnitStatusChanged'). */
export interface EventTrigger {
  readonly kind: 'event';
  readonly eventType: string;
  readonly description: string;
}

/** Agent only runs when a human manually invokes it. */
export interface ManualTrigger {
  readonly kind: 'manual';
  readonly description: string;
}

export type Trigger = CronTrigger | EventTrigger | ManualTrigger;

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

/**
 * Declarative guardrail spec. Checked against the tenant's autonomy policy
 * BEFORE `execute` is invoked. If `domain + action` yields
 * `authorized=false, requiresApproval=true`, the executor short-circuits
 * and writes the run as `skipped_policy` (no execute() call, no cost).
 */
export interface GuardrailsSpec {
  readonly autonomyDomain: AutonomyDomain;
  readonly autonomyAction: string;
  /** Free-form note shown in the UI when the gate closes. */
  readonly description: string;
  /** If true the agent may invoke the LLM (executor wraps with budget-guard). */
  readonly invokesLLM: boolean;
}

// ---------------------------------------------------------------------------
// Run context + result
// ---------------------------------------------------------------------------

export interface AgentRunContext<P = unknown> {
  readonly tenantId: string;
  readonly agentId: string;
  readonly runId: string;
  readonly now: Date;
  readonly payload: P;
  readonly triggeredBy:
    | { kind: 'manual'; userId: string }
    | { kind: 'cron' }
    | { kind: 'event'; eventId: string };
  /**
   * Registry of services the agent is allowed to call. The executor
   * injects these at run time from the api-gateway service registry;
   * agents MUST NOT reach out of this bag.
   */
  readonly services: AgentServicesBag;
}

export type AgentOutcome =
  | 'executed'
  | 'skipped_policy'
  | 'skipped_budget'
  | 'no_op'
  | 'error';

export interface AgentRunResult {
  readonly outcome: AgentOutcome;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** Optional list of entity refs the agent acted upon — surfaces in audit. */
  readonly affected: ReadonlyArray<{ kind: string; id: string }>;
}

// ---------------------------------------------------------------------------
// Service bag (kept intentionally loose so the executor can inject whatever
// the api-gateway composition root provides — domain services differ per
// deployment mode).
// ---------------------------------------------------------------------------

export interface AgentServicesBag {
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// The TaskAgent contract
// ---------------------------------------------------------------------------

export interface TaskAgent<Schema extends ZodTypeAny = ZodTypeAny> {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly trigger: Trigger;
  readonly guardrails: GuardrailsSpec;
  /** Zod schema for the payload passed to `execute`. */
  readonly payloadSchema: Schema;
  readonly execute: (
    ctx: AgentRunContext<z.infer<Schema>>,
  ) => Promise<AgentRunResult>;
}

/** Shape persisted in audit_events.metadata for every run. */
export interface TaskAgentAuditRecord {
  readonly runId: string;
  readonly agentId: string;
  readonly outcome: AgentOutcome;
  readonly summary: string;
  readonly durationMs: number;
  readonly trigger: Trigger['kind'];
  readonly triggeredBy: string | null;
  readonly affected: ReadonlyArray<{ kind: string; id: string }>;
}

/** PlatformEvent published after every run (including skipped ones). */
export interface TaskAgentRanEvent {
  readonly eventType: 'TaskAgentRan';
  readonly tenantId: string;
  readonly agentId: string;
  readonly runId: string;
  readonly outcome: AgentOutcome;
  readonly summary: string;
  readonly durationMs: number;
  readonly occurredAt: string;
}
