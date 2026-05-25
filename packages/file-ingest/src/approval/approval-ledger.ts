/**
 * The 4-eye approval rule:
 *
 *   1. PROPOSER builds the IngestPlan ("first pair of eyes").
 *   2. A DIFFERENT actor must record an approval ("second pair of eyes").
 *   3. Only an APPROVED plan can be executed.
 *   4. The EXECUTOR must be a DIFFERENT actor from the proposer AND
 *      different from the approver — the same identity cannot
 *      simultaneously occupy any two of those three roles. Without this
 *      third check, an approver could trivially self-execute and the
 *      4-eye rule would only apply to the proposer/approver pair.
 *
 * The ledger keeps the audit trail. It is intentionally simple (in-memory)
 * but exposes a stable interface so production wiring can drop in a
 * persistent backend.
 */

import type {
  ApprovalRecord,
  ApprovalState,
  IngestPlan,
  PartialFailureMetadata,
} from './types.js';

export class ApprovalRuleViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalRuleViolationError';
  }
}

interface LedgerEntry {
  readonly plan: IngestPlan;
  readonly proposer_id: string;
  /** Recorded the moment a 'proposed' plan is approved. */
  readonly approver_id: string | null;
  /** Recorded the moment a plan transitions to 'executed' or 'partial_failure'. */
  readonly executor_id: string | null;
  readonly records: ReadonlyArray<ApprovalRecord>;
  readonly state: ApprovalState;
  readonly partial_failure_metadata: PartialFailureMetadata | null;
}

export class ApprovalLedger {
  private entries: ReadonlyMap<string, LedgerEntry>;

  constructor() {
    this.entries = new Map();
  }

  /** Register a freshly-built plan. The proposer_id is "first pair of eyes". */
  propose(plan: IngestPlan, proposerId: string): ApprovalRecord {
    if (this.entries.has(plan.ingest_plan_id)) {
      throw new ApprovalRuleViolationError(
        `Plan ${plan.ingest_plan_id} already exists in ledger; build a new plan id instead.`
      );
    }
    const record: ApprovalRecord = Object.freeze({
      ingest_plan_id: plan.ingest_plan_id,
      state: 'proposed',
      actor_id: proposerId,
      at: new Date().toISOString(),
    });
    const next = new Map(this.entries);
    next.set(plan.ingest_plan_id, {
      plan,
      proposer_id: proposerId,
      approver_id: null,
      executor_id: null,
      records: [record],
      state: 'proposed',
      partial_failure_metadata: null,
    });
    this.entries = next;
    return record;
  }

  /**
   * Record an approval. Throws if:
   *   - plan id unknown
   *   - actor is the same as the proposer (4-eye violation)
   *   - plan is not in 'proposed' state
   */
  approve(planId: string, actorId: string, comment?: string): ApprovalRecord {
    const entry = this.entries.get(planId);
    if (!entry) {
      throw new ApprovalRuleViolationError(`Plan ${planId} not in ledger`);
    }
    if (entry.state !== 'proposed') {
      throw new ApprovalRuleViolationError(
        `Plan ${planId} cannot be approved from state "${entry.state}"`
      );
    }
    if (entry.proposer_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both proposed and tried to approve plan ${planId}`
      );
    }
    const record: ApprovalRecord = Object.freeze({
      ingest_plan_id: planId,
      state: 'approved',
      actor_id: actorId,
      ...(comment !== undefined ? { comment } : {}),
      at: new Date().toISOString(),
    });
    const next = new Map(this.entries);
    next.set(planId, {
      ...entry,
      approver_id: actorId,
      records: [...entry.records, record],
      state: 'approved',
    });
    this.entries = next;
    return record;
  }

  /** Mark a plan rejected. The rejecter still must be a different actor from the proposer. */
  reject(planId: string, actorId: string, comment?: string): ApprovalRecord {
    const entry = this.entries.get(planId);
    if (!entry) {
      throw new ApprovalRuleViolationError(`Plan ${planId} not in ledger`);
    }
    if (entry.state !== 'proposed') {
      throw new ApprovalRuleViolationError(
        `Plan ${planId} cannot be rejected from state "${entry.state}"`
      );
    }
    if (entry.proposer_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both proposed and tried to reject plan ${planId}`
      );
    }
    const record: ApprovalRecord = Object.freeze({
      ingest_plan_id: planId,
      state: 'rejected',
      actor_id: actorId,
      ...(comment !== undefined ? { comment } : {}),
      at: new Date().toISOString(),
    });
    const next = new Map(this.entries);
    next.set(planId, {
      ...entry,
      records: [...entry.records, record],
      state: 'rejected',
    });
    this.entries = next;
    return record;
  }

  /**
   * Mark a plan executed. Called by the executor on successful completion.
   *
   * Strict 4-eye contract: the executor must differ from BOTH the proposer
   * AND the approver. Without the second check an approver could
   * self-execute and silently collapse the second pair of eyes back into
   * the first — exactly the bypass we are defending against.
   */
  markExecuted(planId: string, actorId: string): ApprovalRecord {
    const entry = this.entries.get(planId);
    if (!entry) {
      throw new ApprovalRuleViolationError(`Plan ${planId} not in ledger`);
    }
    if (entry.state !== 'approved') {
      throw new ApprovalRuleViolationError(
        `Plan ${planId} cannot be executed from state "${entry.state}"`
      );
    }
    if (entry.proposer_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both proposed and tried to execute plan ${planId}`
      );
    }
    if (entry.approver_id !== null && entry.approver_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both approved and tried to execute plan ${planId}`
      );
    }
    const record: ApprovalRecord = Object.freeze({
      ingest_plan_id: planId,
      state: 'executed',
      actor_id: actorId,
      at: new Date().toISOString(),
    });
    const next = new Map(this.entries);
    next.set(planId, {
      ...entry,
      executor_id: actorId,
      records: [...entry.records, record],
      state: 'executed',
    });
    this.entries = next;
    return record;
  }

  /**
   * Mark a plan as having partially failed mid-execution. Captures which
   * batches did commit so the recovery path (operator-driven manual replay
   * with a fresh plan id) has enough context to re-ingest only the rows
   * that did NOT land.
   *
   * `isApproved()` returns false for plans in this state — a partial
   * failure is terminal until a NEW plan is built for the remainder. The
   * same 4-eye executor-vs-proposer/approver checks apply.
   */
  markPartialFailure(
    planId: string,
    actorId: string,
    metadata: PartialFailureMetadata
  ): ApprovalRecord {
    const entry = this.entries.get(planId);
    if (!entry) {
      throw new ApprovalRuleViolationError(`Plan ${planId} not in ledger`);
    }
    if (entry.state !== 'approved') {
      throw new ApprovalRuleViolationError(
        `Plan ${planId} cannot transition to partial_failure from state "${entry.state}"`
      );
    }
    if (entry.proposer_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both proposed and tried to execute plan ${planId}`
      );
    }
    if (entry.approver_id !== null && entry.approver_id === actorId) {
      throw new ApprovalRuleViolationError(
        `4-eye violation: ${actorId} both approved and tried to execute plan ${planId}`
      );
    }
    const record: ApprovalRecord = Object.freeze({
      ingest_plan_id: planId,
      state: 'partial_failure',
      actor_id: actorId,
      comment: metadata.failure_reason,
      at: new Date().toISOString(),
    });
    const next = new Map(this.entries);
    next.set(planId, {
      ...entry,
      executor_id: actorId,
      records: [...entry.records, record],
      state: 'partial_failure',
      partial_failure_metadata: Object.freeze({
        ...metadata,
        completed_batches: Object.freeze([...metadata.completed_batches]),
      }),
    });
    this.entries = next;
    return record;
  }

  getState(planId: string): ApprovalState | null {
    return this.entries.get(planId)?.state ?? null;
  }

  getRecords(planId: string): ReadonlyArray<ApprovalRecord> {
    return this.entries.get(planId)?.records ?? [];
  }

  /** Read-only accessors for the audit trail. Returns null if plan unknown. */
  getProposerId(planId: string): string | null {
    return this.entries.get(planId)?.proposer_id ?? null;
  }

  getApproverId(planId: string): string | null {
    return this.entries.get(planId)?.approver_id ?? null;
  }

  getPartialFailureMetadata(planId: string): PartialFailureMetadata | null {
    return this.entries.get(planId)?.partial_failure_metadata ?? null;
  }

  /**
   * True iff plan exists and is in 'approved' state. Plans in
   * 'partial_failure' are intentionally NOT approved — callers must build
   * a fresh plan for any retry.
   */
  isApproved(planId: string): boolean {
    return this.getState(planId) === 'approved';
  }
}
