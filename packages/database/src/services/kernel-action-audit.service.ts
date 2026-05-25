/**
 * Kernel action audit — Drizzle-backed sink for executor transitions.
 *
 * Append-only insert. Adapts to the kernel's `ActionAuditSink` port at
 * the api-gateway sovereign composition root. Hard DB failures are
 * logged + swallowed — the audit channel is a side-channel and must
 * never break the executor's main flow.
 */
import { randomUUID } from 'crypto';
import { kernelActionAudit } from '../schemas/kernel-action-audit.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


export type ActionAuditDecision =
  | 'running'
  | 'done'
  | 'failed'
  | 'awaiting-approval'
  | 'skipped'
  | 'unknown-tool';

export interface ActionAuditEntry {
  readonly tenantId: string;
  readonly userId: string;
  readonly goalId: string;
  readonly stepId: string;
  readonly toolName: string | null;
  readonly decision: ActionAuditDecision;
  readonly payloadHash: string;
  readonly outcome: string | null;
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly latencyMs: number | null;
}

export interface KernelActionAuditService {
  record(entry: ActionAuditEntry): Promise<void>;
}

export function createKernelActionAuditService(
  db: DatabaseClient,
): KernelActionAuditService {
  return {
    async record(entry) {
      try {
        if (!entry.tenantId || !entry.goalId || !entry.stepId) return;
        await db.insert(kernelActionAudit).values({
          id: randomUUID(),
          tenantId: entry.tenantId,
          userId: entry.userId,
          goalId: entry.goalId,
          stepId: entry.stepId,
          toolName: entry.toolName,
          decision: entry.decision,
          payloadHash: entry.payloadHash,
          outcome: entry.outcome,
          errorMessage: entry.errorMessage,
          startedAt: entry.startedAt ? new Date(entry.startedAt) : null,
          endedAt: entry.endedAt ? new Date(entry.endedAt) : null,
          latencyMs: entry.latencyMs,
        } as never);
      } catch (error) {
        logger.error('kernel-action-audit.record failed', { error: error });
      }
    },
  };
}

export { kernelActionAudit };
