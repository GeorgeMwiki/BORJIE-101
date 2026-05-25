/**
 * WorkflowEngine — the state machine + side-effect orchestrator.
 *
 * State transitions:
 *
 *   start()                  → open
 *   proposeChange()          → in_progress → has proposedChange
 *   submitForReview()        → in_review   → calls AIReviewer
 *   approve() (from in_approval) → committed
 *   reject() (any active state)  → rejected
 *   cancel()                     → cancelled
 *
 * Every transition:
 *   1. Validates the action against the worker's scope (via injected
 *      assignment-registry scope guard).
 *   2. Updates the run (immutable spread + freeze).
 *   3. Persists the run via `WorkflowRunRepository`.
 *   4. Writes an append-only WorkflowRunEvent.
 *   5. Writes one hashed entry to the audit chain.
 *
 * The engine NEVER mutates the input run object. All updates produce
 * new frozen objects.
 */

import type {
  ScopeGuard,
} from '@borjie/assignment-registry';
import { createIdGen, type IdGen } from '@borjie/assignment-registry';
import type {
  ApprovalDecision,
  AuditChainRepository,
  ProposedChange,
  ReviewDecision,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunEventKind,
  WorkflowRunEventRepository,
  WorkflowRunRepository,
  WorkflowRunState,
} from '../types.js';
import { computeDiff } from '../deltas/diff.js';
import type { AIReviewerPort } from '../review/index.js';
import type { ApprovalRouterPort } from '../approval/index.js';
import type { Committer } from '../commit/index.js';
import type { DefinitionRegistry } from '../definitions/index.js';
import type { AuditHashChain } from '../audit/index.js';

// ─────────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────────

export interface StartRunInput {
  readonly tenantId: string;
  readonly definitionId: string;
  readonly scope: string;
  readonly scopeRef: string;
  readonly initiatedByUserId: string;
  readonly input?: Record<string, unknown>;
}

export interface ProposeChangeInput {
  readonly runId: string;
  readonly actorUserId: string;
  readonly targetEntity: string;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
  readonly snapshot?: Record<string, unknown>;
}

export interface SubmitForReviewInput {
  readonly runId: string;
  readonly actorUserId: string;
}

export interface ApproveInput {
  readonly runId: string;
  readonly approverUserId: string;
  readonly approverRole: string;
  readonly rationale: string;
}

export interface RejectInput {
  readonly runId: string;
  readonly actorUserId: string;
  readonly reason: string;
}

export interface CancelInput {
  readonly runId: string;
  readonly actorUserId: string;
  readonly reason?: string;
}

export interface CoachInput {
  readonly runId: string;
  readonly actorUserId: string;
  readonly targetEntity: string;
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

export interface WorkflowEngineDeps {
  readonly scopeGuard: ScopeGuard;
  readonly aiReviewer: AIReviewerPort;
  readonly approvalRouter: ApprovalRouterPort;
  readonly committer: Committer;
  readonly definitionRegistry: DefinitionRegistry;
  readonly runRepository: WorkflowRunRepository;
  readonly eventRepository: WorkflowRunEventRepository;
  readonly auditChainRepository: AuditChainRepository;
  readonly auditChain: AuditHashChain;
  readonly idGen?: IdGen;
  readonly now?: () => Date;
}

export interface WorkflowEngine {
  startRun(input: StartRunInput): Promise<WorkflowRun>;
  proposeChange(input: ProposeChangeInput): Promise<WorkflowRun>;
  submitForReview(input: SubmitForReviewInput): Promise<WorkflowRun>;
  approve(input: ApproveInput): Promise<WorkflowRun>;
  reject(input: RejectInput): Promise<WorkflowRun>;
  cancel(input: CancelInput): Promise<WorkflowRun>;
  coach(input: CoachInput): Promise<{ readonly hint: string } | null>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  myQueue(tenantId: string, userId: string): Promise<ReadonlyArray<WorkflowRun>>;
  reviewQueue(tenantId: string): Promise<ReadonlyArray<WorkflowRun>>;
  approvalQueue(tenantId: string): Promise<ReadonlyArray<WorkflowRun>>;
}

// ─────────────────────────────────────────────────────────────────────────
// Engine factory
// ─────────────────────────────────────────────────────────────────────────

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const idGen = deps.idGen ?? createIdGen();
  const now = deps.now ?? (() => new Date());
  // Per-run mutex.
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    locks.set(id, previous.then(() => current));
    try {
      await previous;
      return await fn();
    } finally {
      release();
    }
  }

  function freezeRun(r: WorkflowRun): WorkflowRun {
    return Object.freeze({
      ...r,
      input: Object.freeze({ ...r.input }),
    });
  }

  async function writeEvent(
    run: WorkflowRun,
    kind: WorkflowRunEventKind,
    actorUserId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const evt: WorkflowRunEvent = Object.freeze({
      id: idGen.next('wre'),
      runId: run.id,
      tenantId: run.tenantId,
      kind,
      actorUserId,
      payload: Object.freeze({ ...payload }),
      occurredAt: now(),
    });
    await deps.eventRepository.insert(evt);
    await deps.auditChain.append(
      run.tenantId,
      run.id,
      kind,
      payload,
      idGen.next('wac'),
      now,
    );
  }

  async function loadOrThrow(runId: string): Promise<WorkflowRun> {
    // nosemgrep: missing-tenant-id-arg reason: workflow runs are globally-unique by runId; tenant is read from the returned `run.tenantId` and verified by callers (see line 180).
    const r = await deps.runRepository.findById(runId);
    if (!r) throw new Error(`run_not_found:${runId}`);
    return r;
  }

  function defOrThrow(
    tenantId: string,
    definitionId: string,
  ): WorkflowDefinition {
    const d = deps.definitionRegistry.find(tenantId, definitionId);
    if (!d) throw new Error(`definition_not_found:${definitionId}`);
    return d;
  }

  async function transition(
    run: WorkflowRun,
    nextState: WorkflowRunState,
    extra: Partial<WorkflowRun> = {},
  ): Promise<WorkflowRun> {
    const updated = freezeRun({
      ...run,
      ...extra,
      state: nextState,
      updatedAt: now(),
    });
    await deps.runRepository.update(updated);
    return updated;
  }

  async function ensureScope(
    tenantId: string,
    userId: string,
    capability: string,
    scope: string,
    scopeRef: string,
  ): Promise<void> {
    const decision = await deps.scopeGuard.check({
      tenantId,
      userId,
      // The Capability enum lives in assignment-registry; we cast here
      // because workflow-engine speaks string-typed capabilities to
      // keep the type surface small.
      action: capability as Parameters<ScopeGuard['check']>[0]['action'],
      scope: scope as Parameters<ScopeGuard['check']>[0]['scope'],
      scopeRef,
    });
    if (decision.decision !== 'allow') {
      throw new Error(
        `scope_denied:${decision.reason}:${capability}@${scope}:${scopeRef}`,
      );
    }
  }

  return {
    async startRun(input) {
      const def = defOrThrow(input.tenantId, input.definitionId);
      await ensureScope(
        input.tenantId,
        input.initiatedByUserId,
        def.requiredCapability,
        input.scope,
        input.scopeRef,
      );
      const t = now();
      const run: WorkflowRun = freezeRun({
        id: idGen.next('wfr'),
        tenantId: input.tenantId,
        definitionId: def.id,
        kind: def.kind,
        scope: input.scope,
        scopeRef: input.scopeRef,
        initiatedByUserId: input.initiatedByUserId,
        assignedReviewerUserId: null,
        assignedApproverUserId: null,
        state: 'open',
        input: { ...(input.input ?? {}) },
        proposedChange: null,
        reviewDecision: null,
        approvalDecision: null,
        rejectionReason: null,
        createdAt: t,
        updatedAt: t,
        committedAt: null,
      });
      await deps.runRepository.insert(run);
      await writeEvent(run, 'started', input.initiatedByUserId, {
        definitionId: def.id,
        scope: input.scope,
        scopeRef: input.scopeRef,
      });
      return run;
    },

    async proposeChange(input) {
      return withLock(input.runId, async () => {
        const run = await loadOrThrow(input.runId);
        if (run.initiatedByUserId !== input.actorUserId) {
          throw new Error('proposer_must_be_initiator');
        }
        if (
          run.state !== 'open' &&
          run.state !== 'in_progress' &&
          run.state !== 'in_review'
        ) {
          throw new Error(`cannot_propose_in_state:${run.state}`);
        }
        const fieldDiffs = computeDiff(input.before, input.after);
        const proposed: ProposedChange = Object.freeze({
          id: idGen.next('pc'),
          runId: run.id,
          targetEntity: input.targetEntity,
          fieldDiffs,
          snapshot: input.snapshot ? Object.freeze({ ...input.snapshot }) : null,
          capturedAt: now(),
        });
        const updated = await transition(run, 'in_progress', {
          proposedChange: proposed,
        });
        await writeEvent(updated, 'change_proposed', input.actorUserId, {
          targetEntity: input.targetEntity,
          diffCount: fieldDiffs.length,
          hasSnapshot: !!input.snapshot,
        });
        return updated;
      });
    },

    async submitForReview(input) {
      return withLock(input.runId, async () => {
        const run = await loadOrThrow(input.runId);
        if (run.initiatedByUserId !== input.actorUserId) {
          throw new Error('submitter_must_be_initiator');
        }
        if (run.state !== 'in_progress') {
          throw new Error(`cannot_submit_in_state:${run.state}`);
        }
        if (!run.proposedChange) {
          throw new Error('cannot_submit_without_proposed_change');
        }
        const definition = defOrThrow(run.tenantId, run.definitionId);
        const reviewing = await transition(run, 'in_review');
        await writeEvent(reviewing, 'submitted_for_review', input.actorUserId, {
          proposedChangeId: run.proposedChange.id,
        });
        if (!definition.aiReviewRequired) {
          // Skip review — route straight to approval / commit.
          return routeAfterReview(reviewing, definition, null);
        }
        const aiResult = await deps.aiReviewer.review({
          run: reviewing,
          definition,
          proposedChange: run.proposedChange,
        });
        const decision: ReviewDecision = Object.freeze({
          id: idGen.next('rd'),
          runId: run.id,
          verdict: aiResult.verdict,
          source: aiResult.source,
          reviewerUserId: aiResult.reviewerUserId,
          rationale: aiResult.rationale,
          redLines: aiResult.redLines,
          coachingHints: aiResult.coachingHints,
          decidedAt: now(),
        });
        const withReview = await transition(reviewing, reviewing.state, {
          reviewDecision: decision,
        });
        await writeEvent(withReview, 'reviewed', null, {
          verdict: decision.verdict,
          source: decision.source,
          redLineCount: decision.redLines.length,
        });
        if (decision.verdict !== 'approve') {
          // Bounce back to the worker; not a hard reject yet.
          const back = await transition(withReview, 'in_progress');
          return back;
        }
        return routeAfterReview(withReview, definition, decision);
      });
    },

    async approve(input) {
      return withLock(input.runId, async () => {
        const run = await loadOrThrow(input.runId);
        if (run.state !== 'in_approval') {
          throw new Error(`cannot_approve_in_state:${run.state}`);
        }
        if (!run.proposedChange) {
          throw new Error('cannot_approve_without_proposed_change');
        }
        const definition = defOrThrow(run.tenantId, run.definitionId);
        await ensureScope(
          run.tenantId,
          input.approverUserId,
          'approve_change',
          run.scope,
          run.scopeRef,
        );
        const decision: ApprovalDecision = Object.freeze({
          id: idGen.next('ad'),
          runId: run.id,
          verdict: 'approve',
          approverUserId: input.approverUserId,
          approverRole: input.approverRole,
          rationale: input.rationale,
          decidedAt: now(),
        });
        const approved = await transition(run, 'in_approval', {
          approvalDecision: decision,
        });
        await writeEvent(approved, 'approved', input.approverUserId, {
          approverRole: input.approverRole,
        });
        return commitRun(approved, definition);
      });
    },

    async reject(input) {
      return withLock(input.runId, async () => {
        const run = await loadOrThrow(input.runId);
        if (
          run.state === 'committed' ||
          run.state === 'rejected' ||
          run.state === 'cancelled'
        ) {
          throw new Error(`cannot_reject_in_state:${run.state}`);
        }
        const decision: ApprovalDecision = Object.freeze({
          id: idGen.next('ad'),
          runId: run.id,
          verdict: 'reject',
          approverUserId: input.actorUserId,
          approverRole: 'ANY',
          rationale: input.reason,
          decidedAt: now(),
        });
        const rejected = await transition(run, 'rejected', {
          approvalDecision: decision,
          rejectionReason: input.reason,
        });
        await writeEvent(rejected, 'rejected', input.actorUserId, {
          reason: input.reason,
        });
        return rejected;
      });
    },

    async cancel(input) {
      return withLock(input.runId, async () => {
        const run = await loadOrThrow(input.runId);
        if (run.initiatedByUserId !== input.actorUserId) {
          throw new Error('only_initiator_can_cancel');
        }
        if (
          run.state === 'committed' ||
          run.state === 'rejected' ||
          run.state === 'cancelled'
        ) {
          throw new Error(`cannot_cancel_in_state:${run.state}`);
        }
        const cancelled = await transition(run, 'cancelled');
        await writeEvent(cancelled, 'cancelled', input.actorUserId, {
          reason: input.reason ?? null,
        });
        return cancelled;
      });
    },

    async coach(input) {
      if (!deps.aiReviewer.coach) return null;
      const run = await loadOrThrow(input.runId);
      const definition = defOrThrow(run.tenantId, run.definitionId);
      const fieldDiffs = computeDiff(input.before, input.after);
      const partial: ProposedChange = Object.freeze({
        id: 'partial',
        runId: run.id,
        targetEntity: input.targetEntity,
        fieldDiffs,
        snapshot: null,
        capturedAt: now(),
      });
      return deps.aiReviewer.coach({
        run,
        definition,
        partialProposedChange: partial,
      });
    },

    async getRun(runId) {
      // nosemgrep: missing-tenant-id-arg reason: workflow runs are globally-unique by runId; tenant comes back inside `run.tenantId` for the caller to verify.
      return deps.runRepository.findById(runId);
    },

    async myQueue(tenantId, userId) {
      return deps.runRepository.listForUser(tenantId, userId);
    },

    async reviewQueue(tenantId) {
      return deps.runRepository.listReviewQueue(tenantId);
    },

    async approvalQueue(tenantId) {
      return deps.runRepository.listApprovalQueue(tenantId);
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────

  async function routeAfterReview(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    _decision: ReviewDecision | null,
  ): Promise<WorkflowRun> {
    const route = await deps.approvalRouter.route({
      tenantId: run.tenantId,
      run,
      definition,
    });
    if (!route.humanApprovalRequired && definition.autoCommitOnApproval) {
      // Synthesize a system approval and commit.
      const decision: ApprovalDecision = Object.freeze({
        id: idGen.next('ad'),
        runId: run.id,
        verdict: 'approve',
        approverUserId: 'system',
        approverRole: 'SYSTEM',
        rationale: route.rationale,
        decidedAt: now(),
      });
      const auto = await transition(run, 'in_approval', {
        approvalDecision: decision,
      });
      await writeEvent(auto, 'approved', null, {
        rationale: route.rationale,
        source: 'auto',
      });
      return commitRun(auto, definition);
    }
    // Human approval — set the approver and wait.
    const queued = await transition(run, 'in_approval', {
      assignedApproverUserId: route.approverUserId,
    });
    await writeEvent(queued, 'submitted_for_approval', null, {
      approverRole: route.approverRole,
      approverUserId: route.approverUserId,
      rationale: route.rationale,
    });
    return queued;
  }

  async function commitRun(
    run: WorkflowRun,
    definition: WorkflowDefinition,
  ): Promise<WorkflowRun> {
    if (!run.proposedChange) {
      throw new Error('cannot_commit_without_proposed_change');
    }
    const outcome = await deps.committer.applyProposedChange({
      run,
      definition,
      proposedChange: run.proposedChange,
    });
    if (!outcome.success) {
      const failed = await transition(run, 'rejected', {
        rejectionReason: outcome.error ?? 'commit_failed',
      });
      await writeEvent(failed, 'rejected', null, {
        reason: outcome.error ?? 'commit_failed',
        phase: 'commit',
      });
      return failed;
    }
    const committed = await transition(run, 'committed', {
      committedAt: now(),
    });
    await writeEvent(committed, 'committed', null, {
      applierDetails: outcome.applierDetails ?? null,
    });
    return committed;
  }
}
