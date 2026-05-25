/**
 * Shared test harness — wires the engine against in-memory repos +
 * fake reviewer + threshold-aware approval router.
 */

import {
  createAssignmentRegistry,
  createInMemoryAssignmentEventRepository,
  createInMemoryAssignmentRepository,
  type AssignmentRegistry,
  type Capability,
} from '@borjie/assignment-registry';
import {
  BUILT_IN_WORKFLOW_DEFINITIONS,
  createAuditHashChain,
  createCommitter,
  createDefinitionRegistry,
  createInMemoryApprovalRouter,
  createInMemoryAuditChainRepository,
  createInMemoryRunEventRepository,
  createInMemoryRunRepository,
  createRecordingApplier,
  createWorkflowEngine,
  type AIReviewerPort,
  type ApprovalRouterPort,
  type ChangeApplier,
  type ElasticThresholds,
  type ReviewDecision,
  type ReviewVerdict,
  type WorkflowEngine,
  type WorkflowKind,
} from '../index.js';

export interface Harness {
  readonly engine: WorkflowEngine;
  readonly registry: AssignmentRegistry;
  readonly reviewer: ReplayableReviewer;
  readonly appliers: ReadonlyArray<ReturnType<typeof createRecordingApplier>>;
  readonly router: ApprovalRouterPort;
  readonly thresholds: { value: ElasticThresholds | null };
  readonly grantUser: (args: {
    userId: string;
    tenantId: string;
    scope: string;
    scopeRefs: string[];
    capabilities: Capability[];
  }) => Promise<void>;
}

export interface ReplayableReviewer extends AIReviewerPort {
  queue(
    verdict: ReviewVerdict,
    extras?: Partial<Omit<ReviewDecision, 'id' | 'runId' | 'decidedAt'>>,
  ): void;
  setCoachHint(hint: string): void;
}

export function createTestHarness(): Harness {
  const assignmentRepo = createInMemoryAssignmentRepository();
  const eventRepo = createInMemoryAssignmentEventRepository();
  const registry = createAssignmentRegistry({
    assignmentRepository: assignmentRepo,
    eventRepository: eventRepo,
  });

  const runRepo = createInMemoryRunRepository();
  const runEvents = createInMemoryRunEventRepository();
  const auditRepo = createInMemoryAuditChainRepository();
  const auditChain = createAuditHashChain(auditRepo);

  const definitionRegistry = createDefinitionRegistry();
  // Register every built-in for a notional "test" tenant slot so
  // engine.find still hits the built-in fallback for unknown tenants.
  for (const def of BUILT_IN_WORKFLOW_DEFINITIONS) {
    definitionRegistry.register('tenant-1', def);
  }

  // Reviewer with a queue so each test can prescribe the verdict.
  const queue: Array<Omit<ReviewDecision, 'id' | 'runId' | 'decidedAt'>> = [];
  let coachHint = 'Add at least one photo before submitting.';
  const reviewer: ReplayableReviewer = {
    async review() {
      const next = queue.shift();
      if (next) return next;
      // Default = approve.
      return {
        verdict: 'approve' as ReviewVerdict,
        source: 'ai',
        reviewerUserId: null,
        rationale: 'default_approve',
        redLines: [],
        coachingHints: [],
      };
    },
    async coach() {
      return { hint: coachHint };
    },
    queue(verdict, extras) {
      queue.push({
        verdict,
        source: 'ai',
        reviewerUserId: null,
        rationale: extras?.rationale ?? 'queued',
        redLines: extras?.redLines ?? [],
        coachingHints: extras?.coachingHints ?? [],
      });
    },
    setCoachHint(hint) {
      coachHint = hint;
    },
  };

  // Appliers — one per kind. Recording so tests can assert apply()
  // actually fired.
  const allKinds: ReadonlyArray<WorkflowKind> = BUILT_IN_WORKFLOW_DEFINITIONS.map(
    (d) => d.kind,
  );
  const appliers = allKinds.map((k) => createRecordingApplier(k));
  const committerInitial: ChangeApplier[] = appliers.map((p) => p.applier);
  const committer = createCommitter(committerInitial);

  // Threshold registry — mutable via thresholds.value so tests can flip.
  const thresholds: { value: ElasticThresholds | null } = { value: null };
  const router = createInMemoryApprovalRouter({
    readThresholds: async () => thresholds.value,
  });

  const engine = createWorkflowEngine({
    scopeGuard: registry.scope,
    aiReviewer: reviewer,
    approvalRouter: router,
    committer,
    definitionRegistry,
    runRepository: runRepo,
    eventRepository: runEvents,
    auditChainRepository: auditRepo,
    auditChain,
  });

  async function grantUser(args: {
    userId: string;
    tenantId: string;
    scope: string;
    scopeRefs: string[];
    capabilities: Capability[];
  }): Promise<void> {
    await registry.management.assignUser({
      userId: args.userId,
      tenantId: args.tenantId,
      scope: args.scope as Parameters<
        AssignmentRegistry['management']['assignUser']
      >[0]['scope'],
      scopeRefs: args.scopeRefs,
      capabilities: args.capabilities,
      assignedBy: 'system-test',
    });
  }

  return { engine, registry, reviewer, appliers, router, thresholds, grantUser };
}
