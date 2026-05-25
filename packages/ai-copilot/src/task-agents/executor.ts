/**
 * TaskAgentExecutor — runs a task-agent under:
 *   1. Autonomy-policy guardrails (skips with `skipped_policy` if gate closes)
 *   2. Cost-ledger budget guard (skips with `skipped_budget` when LLM-invoking
 *      agent runs while tenant is over monthly AI cap)
 *   3. Audit event emission into the existing `audit_events` surface
 *   4. PlatformEvent `TaskAgentRan` emission on every run
 *
 * The executor is a pure factory. It takes the dependencies it needs and
 * returns an `execute(agentId, tenantId, payload, trigger)` function. The
 * registry is passed in so the same executor can run any of the 15 agents.
 *
 * The executor intentionally never throws — agent errors are captured and
 * materialised as `outcome: 'error'` so one bad agent can't tear down the
 * caller (e.g. a cron supervisor iterating the whole registry).
 */

import { randomUUID } from 'crypto';
import type {
  AgentOutcome,
  AgentRunContext,
  AgentRunResult,
  AgentServicesBag,
  TaskAgent,
  TaskAgentAuditRecord,
  TaskAgentRanEvent,
  Trigger,
} from './types.js';
import type { AutonomyPolicyService } from '../autonomy/autonomy-policy-service.js';
import type { CostLedger } from '../cost-ledger.js';
import { logger } from '../logger.js';

// ---------------------------------------------------------------------------
// Executor ports
// ---------------------------------------------------------------------------

export interface AuditPort {
  logAudit: (
    tenantId: string,
    action: 'create' | 'update' | 'read' | 'export' | 'approve' | 'reject',
    entityType: string,
    entityId: string | null,
    userId?: string | null,
    changes?: readonly unknown[],
    metadata?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export interface EventPublisherPort {
  publish: (event: TaskAgentRanEvent) => Promise<void> | void;
}

export interface TaskAgentExecutorDeps {
  readonly registry: Readonly<Record<string, TaskAgent>>;
  readonly services: AgentServicesBag;
  /** Optional — when omitted every run is authorized (useful for tests). */
  readonly autonomy?: AutonomyPolicyService | null;
  /** Optional — when omitted budget-guard is a pass-through. */
  readonly costLedger?: CostLedger | null;
  /** Optional — when omitted audit writes are skipped. */
  readonly audit?: AuditPort | null;
  /** Optional — when omitted the event is dropped silently. */
  readonly eventPublisher?: EventPublisherPort | null;
  readonly clock?: () => Date;
}

export interface ExecuteOptions {
  readonly tenantId: string;
  readonly agentId: string;
  readonly payload: unknown;
  readonly trigger:
    | { kind: 'manual'; userId: string }
    | { kind: 'cron' }
    | { kind: 'event'; eventId: string };
}

export interface ExecuteOutput {
  readonly runId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly outcome: AgentOutcome;
  readonly summary: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly affected: ReadonlyArray<{ kind: string; id: string }>;
  readonly durationMs: number;
  readonly ranAt: string;
  readonly triggerKind: Trigger['kind'];
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class TaskAgentExecutor {
  constructor(private readonly deps: TaskAgentExecutorDeps) {}

  listAgents(): ReadonlyArray<TaskAgent> {
    return Object.values(this.deps.registry);
  }

  getAgent(id: string): TaskAgent | null {
    return this.deps.registry[id] ?? null;
  }

  async execute(opts: ExecuteOptions): Promise<ExecuteOutput> {
    const now = (this.deps.clock ?? (() => new Date()))();
    const runId = `tar_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const agent = this.deps.registry[opts.agentId] ?? null;

    if (!agent) {
      return this.finalize({
        runId,
        agentId: opts.agentId,
        tenantId: opts.tenantId,
        outcome: 'error',
        summary: `Unknown agent: ${opts.agentId}`,
        data: {},
        affected: [],
        startedAt: now,
        triggerKind: opts.trigger.kind,
        triggeredBy:
          opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
      });
    }

    // --- Validate payload -------------------------------------------------
    const parseResult = agent.payloadSchema.safeParse(opts.payload ?? {});
    if (!parseResult.success) {
      return this.finalize({
        runId,
        agentId: agent.id,
        tenantId: opts.tenantId,
        outcome: 'error',
        summary: `Invalid payload: ${parseResult.error.message}`,
        data: { issues: parseResult.error.issues },
        affected: [],
        startedAt: now,
        triggerKind: opts.trigger.kind,
        triggeredBy:
          opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
      });
    }

    // --- Autonomy-policy guardrail ---------------------------------------
    if (this.deps.autonomy) {
      try {
        const decision = await this.deps.autonomy.isAuthorized(
          opts.tenantId,
          agent.guardrails.autonomyDomain,
          agent.guardrails.autonomyAction,
          {},
        );
        if (!decision.authorized) {
          return this.finalize({
            runId,
            agentId: agent.id,
            tenantId: opts.tenantId,
            outcome: 'skipped_policy',
            summary: `Policy gate closed: ${decision.reason}`,
            data: {
              requiresApproval: decision.requiresApproval,
              escalateTo: decision.escalateTo,
              ruleMatched: decision.policyRuleMatched,
            },
            affected: [],
            startedAt: now,
            triggerKind: opts.trigger.kind,
            triggeredBy:
              opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
          });
        }
      } catch (err) {
        // Autonomy service glitch — fail-safe: require approval (skip).
        return this.finalize({
          runId,
          agentId: agent.id,
          tenantId: opts.tenantId,
          outcome: 'skipped_policy',
          summary: `Autonomy probe failed: ${errorMessage(err)}`,
          data: {},
          affected: [],
          startedAt: now,
          triggerKind: opts.trigger.kind,
          triggeredBy:
            opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
        });
      }
    }

    // --- Budget guard (only when the agent declares it invokes LLMs) ----
    if (agent.guardrails.invokesLLM && this.deps.costLedger) {
      try {
        await this.deps.costLedger.assertWithinBudget(opts.tenantId);
      } catch (err) {
        return this.finalize({
          runId,
          agentId: agent.id,
          tenantId: opts.tenantId,
          outcome: 'skipped_budget',
          summary: `AI budget exceeded: ${errorMessage(err)}`,
          data: {},
          affected: [],
          startedAt: now,
          triggerKind: opts.trigger.kind,
          triggeredBy:
            opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
        });
      }
    }

    // --- Execute ---------------------------------------------------------
    const ctx: AgentRunContext = {
      tenantId: opts.tenantId,
      agentId: agent.id,
      runId,
      now,
      payload: parseResult.data,
      triggeredBy: opts.trigger,
      services: this.deps.services,
    };

    let result: AgentRunResult;
    try {
      result = await agent.execute(ctx);
    } catch (err) {
      result = {
        outcome: 'error',
        summary: `Agent threw: ${errorMessage(err)}`,
        data: {},
        affected: [],
      };
    }

    return this.finalize({
      runId,
      agentId: agent.id,
      tenantId: opts.tenantId,
      outcome: result.outcome,
      summary: result.summary,
      data: result.data,
      affected: result.affected,
      startedAt: now,
      triggerKind: opts.trigger.kind,
      triggeredBy:
        opts.trigger.kind === 'manual' ? opts.trigger.userId : null,
    });
  }

  // -------------------------------------------------------------------------
  // Audit + event emission
  // -------------------------------------------------------------------------
  private async finalize(args: {
    runId: string;
    agentId: string;
    tenantId: string;
    outcome: AgentOutcome;
    summary: string;
    data: Readonly<Record<string, unknown>>;
    affected: ReadonlyArray<{ kind: string; id: string }>;
    startedAt: Date;
    triggerKind: Trigger['kind'];
    triggeredBy: string | null;
  }): Promise<ExecuteOutput> {
    const endedAt = (this.deps.clock ?? (() => new Date()))();
    const durationMs = Math.max(0, endedAt.getTime() - args.startedAt.getTime());
    const ranAt = endedAt.toISOString();

    const auditRecord: TaskAgentAuditRecord = {
      runId: args.runId,
      agentId: args.agentId,
      outcome: args.outcome,
      summary: args.summary,
      durationMs,
      trigger: args.triggerKind,
      triggeredBy: args.triggeredBy,
      affected: args.affected,
    };

    // Audit (best-effort)
    if (this.deps.audit) {
      try {
        await this.deps.audit.logAudit(
          args.tenantId,
          'create',
          'task_agent_run',
          args.runId,
          args.triggeredBy,
          [],
          { taskAgentRun: auditRecord, data: args.data },
        );
      } catch (err) {
        // swallow — audit failure must not bubble up
         
        logger.error('TaskAgentExecutor: audit write failed', { error: errorMessage(err) });
      }
    }

    // Platform event (best-effort)
    if (this.deps.eventPublisher) {
      try {
        const event: TaskAgentRanEvent = {
          eventType: 'TaskAgentRan',
          tenantId: args.tenantId,
          agentId: args.agentId,
          runId: args.runId,
          outcome: args.outcome,
          summary: args.summary,
          durationMs,
          occurredAt: ranAt,
        };
        await this.deps.eventPublisher.publish(event);
      } catch (err) {
         
        logger.error('TaskAgentExecutor: event publish failed', { error: errorMessage(err) });
      }
    }

    return {
      runId: args.runId,
      agentId: args.agentId,
      tenantId: args.tenantId,
      outcome: args.outcome,
      summary: args.summary,
      data: args.data,
      affected: args.affected,
      durationMs,
      ranAt,
      triggerKind: args.triggerKind,
    };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
