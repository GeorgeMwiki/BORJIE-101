/**
 * `PivotProposer` — when an objective drifts off-track for ≥7 days
 * the strategic loop composes a `PivotProposal` and routes it through
 * `mutation-authority` for T2 owner approval.
 *
 * Spec: STRATEGIC_DIRECTION_LAYER_SPEC.md §15.4.
 *
 * The LLM is *injected* — the package itself stays I/O-free. The
 * `PivotComposerPort` returns the rationale + the suggested
 * `PivotShape`. The persisted `evidence` jsonb carries the shape and
 * the citations.
 */

import { randomUUID } from 'node:crypto';
import {
  type NorthStar,
  type ObjectiveProgress,
  type PivotProposal,
  type PivotProposalsRepository,
  type PivotShape,
  type PivotStatus,
  type ProposePivotInput,
  InvalidStateTransition,
} from '../types.js';
import { computeStrategicAuditHash } from '../audit/audit-chain-link.js';

export interface PivotComposerPort {
  /**
   * Inject an LLM/heuristic that takes the objective + its observation
   * history and returns the pivot rationale plus the shape.
   */
  compose(input: {
    readonly objective: NorthStar;
    readonly progress: ReadonlyArray<ObjectiveProgress>;
  }): Promise<{
    readonly rationale: string;
    readonly shape: PivotShape;
    readonly evidence: Readonly<Record<string, unknown>>;
  }>;
}

export interface PivotProposerDeps {
  readonly repo: PivotProposalsRepository;
  readonly composer: PivotComposerPort;
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export interface PivotProposer {
  propose(input: ProposePivotInput): Promise<PivotProposal>;
  composeAndPropose(input: {
    readonly tenantId: string;
    readonly objective: NorthStar;
    readonly progress: ReadonlyArray<ObjectiveProgress>;
  }): Promise<PivotProposal>;
  accept(
    tenantId: string,
    id: string,
    decidedBy: string,
  ): Promise<PivotProposal>;
  reject(
    tenantId: string,
    id: string,
    decidedBy: string,
  ): Promise<PivotProposal>;
  expire(tenantId: string, id: string): Promise<PivotProposal>;
}

const ALLOWED_NEXT: Readonly<Record<PivotStatus, ReadonlyArray<PivotStatus>>> =
  {
    open: ['accepted', 'rejected', 'expired'],
    accepted: [],
    rejected: [],
    expired: [],
  };

export function createPivotProposer(deps: PivotProposerDeps): PivotProposer {
  const { repo, composer, now } = deps;

  const transition = async (
    tenantId: string,
    id: string,
    nextStatus: PivotStatus,
    decidedBy: string | null,
  ): Promise<PivotProposal> => {
    const current = await repo.findById(tenantId, id);
    if (current === null) {
      throw new InvalidStateTransition('absent', nextStatus);
    }
    const allowed = ALLOWED_NEXT[current.status];
    if (!allowed.includes(nextStatus)) {
      throw new InvalidStateTransition(current.status, nextStatus);
    }
    const decidedAt =
      nextStatus === 'expired' ? null : now().toISOString();
    const auditHash = computeStrategicAuditHash(
      {
        op: 'pivot_transition',
        id,
        tenantId,
        from: current.status,
        to: nextStatus,
        decidedBy: decidedBy ?? null,
        at: decidedAt ?? now().toISOString(),
      },
      current.auditHash,
    );
    return repo.updateStatus(
      tenantId,
      id,
      nextStatus,
      decidedBy,
      decidedAt,
      auditHash,
    );
  };

  return {
    async propose(input: ProposePivotInput): Promise<PivotProposal> {
      const id = randomUUID();
      const proposedAt = now().toISOString();
      const auditHash = computeStrategicAuditHash({
        op: 'pivot_propose',
        id,
        tenantId: input.tenantId,
        objectiveId: input.objectiveId,
        at: proposedAt,
      });
      const row: PivotProposal = Object.freeze({
        id,
        objectiveId: input.objectiveId,
        tenantId: input.tenantId,
        proposedAt,
        rationale: input.rationale,
        evidence: input.evidence,
        status: 'open' as PivotStatus,
        decidedBy: null,
        decidedAt: null,
        auditHash,
      });
      return repo.insert(row);
    },

    async composeAndPropose(input): Promise<PivotProposal> {
      const composed = await composer.compose({
        objective: input.objective,
        progress: input.progress,
      });
      // Embed the shape into the evidence so downstream readers can
      // pick the correct UI affordance.
      const evidence: Readonly<Record<string, unknown>> = {
        ...composed.evidence,
        shape: composed.shape,
      };
      return this.propose({
        tenantId: input.tenantId,
        objectiveId: input.objective.id,
        rationale: composed.rationale,
        evidence,
      });
    },

    accept(tenantId, id, decidedBy): Promise<PivotProposal> {
      return transition(tenantId, id, 'accepted', decidedBy);
    },

    reject(tenantId, id, decidedBy): Promise<PivotProposal> {
      return transition(tenantId, id, 'rejected', decidedBy);
    },

    expire(tenantId, id): Promise<PivotProposal> {
      return transition(tenantId, id, 'expired', null);
    },
  };
}
