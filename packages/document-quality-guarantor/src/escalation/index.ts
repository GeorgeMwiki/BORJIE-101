/**
 * Human-in-the-loop escalation. When AI runs out of skill (low
 * confidence across all engines, quality-gate block that can't be
 * worked around, unsupported format, inconsistent data, user-
 * requested) we create a workflow-engine run in `in_review` state
 * with the failed AI output as the proposed change.
 *
 * The integration is a port — we don't hard-import
 * `@borjie/workflow-engine`. Wiring is duck-typed against the
 * minimal `WorkflowEnginePort`, which matches what the engine's
 * public `start` + `proposeChange` flow exposes. When the port
 * isn't wired, the escalation degrades to a structured audit
 * event so nothing is silently dropped.
 */

import type { AuditChainStore } from '../audit/index.js';
import type {
  EscalationCause,
  EscalationContextRef,
  EscalationTicket,
  EscalationUrgency,
  TenantId,
} from '../types.js';

export interface EscalateInput {
  readonly tenantId: TenantId;
  readonly cause: EscalationCause;
  readonly urgency?: EscalationUrgency;
  readonly contextRefs: ReadonlyArray<EscalationContextRef>;
  readonly summary: string;
}

/**
 * Minimal slice of @borjie/workflow-engine we depend on. The
 * shape mirrors `WorkflowEngine.start` + `proposeChange` so a real
 * engine drops in via type-assignment.
 */
export interface WorkflowEnginePort {
  startReviewableRun(input: {
    tenantId: TenantId;
    kind: 'document_upload';
    proposedChangePayload: Readonly<Record<string, unknown>>;
    rejectionContext: { cause: EscalationCause; summary: string };
  }): Promise<{ runId: string }>;
}

export interface EscalationDeps {
  readonly audit: AuditChainStore;
  readonly workflowEngine?: WorkflowEnginePort;
}

export interface EscalationService {
  escalateToHuman(input: EscalateInput): Promise<EscalationTicket>;
  getEscalation(ticketId: string): EscalationTicket | undefined;
  list(tenantId: TenantId): ReadonlyArray<EscalationTicket>;
}

export function createEscalationService(deps: EscalationDeps): EscalationService {
  const byTicket = new Map<string, EscalationTicket>();
  const byTenant = new Map<TenantId, EscalationTicket[]>();
  let counter = 0;

  return {
    list: (tenantId) => Object.freeze([...(byTenant.get(tenantId) ?? [])]),
    getEscalation: (ticketId) => byTicket.get(ticketId),

    async escalateToHuman(input) {
      counter += 1;
      const ticketId = `esc-${Date.now()}-${counter}`;
      const urgency: EscalationUrgency = input.urgency ?? 'normal';
      let workflowRunId: string | null = null;

      if (deps.workflowEngine !== undefined) {
        try {
          const { runId } = await deps.workflowEngine.startReviewableRun({
            tenantId: input.tenantId,
            kind: 'document_upload',
            proposedChangePayload: {
              cause: input.cause,
              contextRefs: input.contextRefs,
              summary: input.summary,
            },
            rejectionContext: { cause: input.cause, summary: input.summary },
          });
          workflowRunId = runId;
        } catch (err) {
          // Workflow-engine call failed — log it on the chain but
          // STILL produce the ticket so the human gets paged.
          await deps.audit.append({
            tenantId: input.tenantId,
            kind: 'escalation_dispatched',
            operationId: ticketId,
            engineId: null,
            details: {
              outcome: 'workflow_engine_call_failed',
              error: err instanceof Error ? err.message : String(err),
            },
            recordedAtIso: new Date().toISOString(),
          });
        }
      }

      const ticket: EscalationTicket = Object.freeze({
        ticketId,
        tenantId: input.tenantId,
        cause: input.cause,
        urgency,
        contextRefs: Object.freeze([...input.contextRefs]),
        createdAtIso: new Date().toISOString(),
        workflowRunId,
        summary: input.summary,
      });
      byTicket.set(ticketId, ticket);
      const tail = byTenant.get(input.tenantId) ?? [];
      tail.push(ticket);
      byTenant.set(input.tenantId, tail);

      await deps.audit.append({
        tenantId: input.tenantId,
        kind: 'escalation_dispatched',
        operationId: ticketId,
        engineId: null,
        details: {
          cause: input.cause,
          urgency,
          workflowRunId,
          contextRefCount: input.contextRefs.length,
          summary: input.summary,
        },
        recordedAtIso: new Date().toISOString(),
      });
      return ticket;
    },
  };
}
