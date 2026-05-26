/**
 * Conflict detector.
 *
 * Wave 18HH. Detects contradicting mutation proposals on the same
 * subject. The Wave 18S mutation-authority layer hands us a list of
 * pending proposals filtered by `(tenant_id, subject)`; if 2+ are
 * present from different agents, a `coordination_conflicts` row is
 * opened.
 *
 * This module is *pure* against the input list — it does not query
 * `mutation_proposals` itself; that's a Wave 18S concern. The Wave
 * 18S retrofit will call us at proposal-insert time with the freshly
 * derived list.
 */

import type {
  AgentSubject,
  ConflictsRepository,
  CoordinationConflict,
} from '../types.js';

export interface PendingProposalRef {
  readonly proposalId: string;
  readonly proposedByAgentId: string;
  readonly subject: AgentSubject;
}

export interface ConflictDetectionResult {
  readonly conflictOpened: CoordinationConflict | null;
  readonly reason: 'no_conflict' | 'self_only' | 'opened';
}

export interface ConflictDetectorDeps {
  readonly repository: ConflictsRepository;
}

export function createConflictDetector(
  deps: ConflictDetectorDeps,
): {
  detect(
    tenantId: string,
    subject: AgentSubject,
    pending: ReadonlyArray<PendingProposalRef>,
  ): Promise<ConflictDetectionResult>;
} {
  return {
    async detect(tenantId, subject, pending) {
      if (pending.length < 2) {
        return Object.freeze({
          conflictOpened: null,
          reason: 'no_conflict',
        });
      }
      const uniqueAgents = new Set(pending.map((p) => p.proposedByAgentId));
      if (uniqueAgents.size < 2) {
        return Object.freeze({
          conflictOpened: null,
          reason: 'self_only',
        });
      }
      const conflict = await deps.repository.open({
        tenantId,
        subject,
        conflictingProposalIds: pending.map((p) => p.proposalId),
      });
      return Object.freeze({
        conflictOpened: conflict,
        reason: 'opened',
      });
    },
  };
}
