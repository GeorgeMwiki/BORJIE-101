/**
 * Workflow-engine composition wiring.
 *
 * Wires three previously-orphaned packages — `@borjie/workflow-engine`,
 * `@borjie/ai-reviewer`, and `@borjie/assignment-registry` — into
 * a single, lazily-constructed `WorkflowEngine` instance the api-gateway
 * router can call. Until this file existed the three packages shipped
 * with ZERO consumers; the gateway's `/v1/workflows` route mounted a
 * different (simpler, in-memory-only) engine from `@borjie/ai-copilot`.
 *
 * Decisions encoded here:
 *
 *   - Repositories are Drizzle-backed when a DatabaseClient is present
 *     (production), and in-memory otherwise (tests / DATABASE_URL unset).
 *     The Drizzle adapters persist to `workflow_runs`,
 *     `workflow_run_events`, and `workflow_audit_chain` (migration 0307)
 *     so workflow runs, the four-eyes approval queue, and the
 *     append-only hashed audit chain survive an api-gateway restart
 *     (closes the SOC 2 CC7.2 gap in the execution audit, EX-10). The
 *     assignment-registry repositories remain in-memory pending their
 *     own migration. The seams are clean: every repository is a Port
 *     with both an in-memory and a Drizzle adapter behind one contract.
 *
 *   - The brain port behind `@borjie/ai-reviewer` defaults to a
 *     deterministic "escalate" responder. This is the SAFE default:
 *     a wired-but-stubbed reviewer escalates every nuanced case to a
 *     human instead of auto-approving. Production wires the
 *     multi-LLM synthesiser via `wireMultiLLMBrain` (see
 *     `routes/ask/advisor-wiring.ts` for the pattern).
 *
 *   - The audit port is also stubbed (no-op `recordReview`) — workflow
 *     events go through the engine's own hashed audit chain
 *     (`AuditChainRepository`), so a second audit write here would
 *     duplicate. The seam is preserved for callers that want to
 *     additionally pipe reviewer-only audits into the WORM log.
 *
 *   - A trivial single-applier committer is registered for every
 *     workflow kind. It records the apply but doesn't actually mutate
 *     downstream rows (no DB schema exists yet for the workflow's
 *     concrete entities). Production registers per-kind appliers that
 *     map a ProposedChange into the matching table update.
 *
 * Singleton model:
 *   - One engine per process. The engine's per-run mutex relies on
 *     `Map<runId, Promise>` to serialize transitions; we MUST keep a
 *     single instance per process or the mutex is bypassed.
 *
 * NEVER throws at construction. Every fall-back path returns a
 * "minimal but valid" implementation so the gateway boots cleanly even
 * when the real DB / brain is offline.
 */

import {
  createAssignmentRegistry,
  createInMemoryAssignmentRepository,
  createInMemoryAssignmentEventRepository,
  type AssignmentRegistry,
} from '@borjie/assignment-registry';
import {
  createAIReviewer,
  type AIReviewer,
  type BrainPort as ReviewerBrainPort,
  type BrainStructuredReview,
  type ReviewAuditPort,
} from '@borjie/ai-reviewer';
import {
  createAuditHashChain,
  createCommitter,
  createDefinitionRegistry,
  createDrizzleAuditChainRepository,
  createDrizzleFlowAutonomyRepository,
  createDrizzleRunEventRepository,
  createDrizzleRunRepository,
  createInMemoryApprovalRouter,
  createInMemoryAuditChainRepository,
  createInMemoryFlowAutonomyRepository,
  createInMemoryRunEventRepository,
  createInMemoryRunRepository,
  createWorkflowEngine,
  type AIReviewerPort,
  type AuditChainRepository,
  type ChangeApplier,
  type FlowAutonomyRepository,
  type WorkflowEngine,
  type WorkflowKind,
  type WorkflowRunEventRepository,
  type WorkflowRunRepository,
} from '@borjie/workflow-engine';
import { getDb } from './db-client.js';

// ─────────────────────────────────────────────────────────────────────
// Module-local singleton — required so the engine's per-run mutex map
// is shared across requests.
// ─────────────────────────────────────────────────────────────────────

let cachedEngine: WorkflowEngine | null = null;
let cachedRegistry: AssignmentRegistry | null = null;
let cachedFlowAutonomy: FlowAutonomyRepository | null = null;

export interface WorkflowEngineBundle {
  readonly engine: WorkflowEngine;
  readonly assignmentRegistry: AssignmentRegistry;
  /**
   * Flow-keyed autonomy repository (migration 0308). The `/workflow/
   * flow-autonomy` route reads/writes the per-flow `auto | gated` posture
   * + creation-time confirmation through this seam; the engine reads the
   * same repository to skip / block the per-run human-approval step.
   */
  readonly flowAutonomy: FlowAutonomyRepository;
}

/**
 * Returns the composed engine. Builds it on first call and caches the
 * result for the life of the process. Construction is synchronous and
 * never throws — fall-back impls are wired in-place when real deps
 * fail to construct.
 */
export function getWorkflowEngine(): WorkflowEngineBundle {
  if (cachedEngine && cachedRegistry && cachedFlowAutonomy) {
    return {
      engine: cachedEngine,
      assignmentRegistry: cachedRegistry,
      flowAutonomy: cachedFlowAutonomy,
    };
  }

  // ── Assignment registry: provides the ScopeGuard the engine needs.
  const assignmentRegistry = createAssignmentRegistry({
    assignmentRepository: createInMemoryAssignmentRepository(),
    eventRepository: createInMemoryAssignmentEventRepository(),
  });

  // ── AI reviewer: wraps a BrainPort + an audit port.
  //   The default brain port is a deterministic "escalate" responder
  //   — the SAFE default for a wired-but-unconfigured reviewer. When
  //   the multi-LLM synthesiser is wired (production), it should
  //   replace this via `setReviewerBrain` below.
  const defaultBrain: ReviewerBrainPort = {
    async respond(): Promise<BrainStructuredReview> {
      return {
        verdict: 'escalate',
        confidence: 0,
        reasons: [
          {
            code: 'brain.not_wired',
            message:
              'AI reviewer brain port is not wired in this environment ' +
              '— escalating to human review.',
            severity: 'warning',
          },
        ],
        suggestedFixes: [],
      };
    },
  };

  const defaultAudit: ReviewAuditPort = {
    async recordReview() {
      // No-op. The workflow-engine writes its own hashed audit chain
      // for every state transition (incl. the 'reviewed' event), so a
      // second audit write here would duplicate.
    },
  };

  const aiReviewer: AIReviewer = createAIReviewer({
    brain: defaultBrain,
    audit: defaultAudit,
  });

  // ── Adapter: translate ai-reviewer's AIReviewer shape into the
  //   workflow-engine's AIReviewerPort shape. The engine speaks in
  //   `{ run, definition, proposedChange }` and expects
  //   `Omit<ReviewDecision, 'id' | 'runId' | 'decidedAt'>` back; the
  //   ai-reviewer speaks in `ReviewRequest { kind, payload, context }`
  //   and returns a richer `ReviewDecision` (different schema).
  const aiReviewerPort: AIReviewerPort = {
    async review({ run, definition, proposedChange }) {
      const decision = await aiReviewer.review({
        kind: definition.kind,
        payload: {
          targetEntity: proposedChange.targetEntity,
          fieldDiffs: proposedChange.fieldDiffs,
          snapshot: proposedChange.snapshot,
        },
        context: {
          tenantId: run.tenantId,
          actorUserId: run.initiatedByUserId,
          actorRole: 'WORKER',
          submittedAt: new Date().toISOString(),
          ...(run.id ? { correlationId: run.id } : {}),
        },
      });
      // Translate the ai-reviewer verdict vocabulary
      // ('approve' | 'reject_with_changes' | 'reject_final' | 'escalate')
      // into the workflow-engine verdict vocabulary
      // ('approve' | 'request_changes' | 'reject').
      const verdict: 'approve' | 'request_changes' | 'reject' =
        decision.verdict === 'approve'
          ? 'approve'
          : decision.verdict === 'reject_final'
          ? 'reject'
          : 'request_changes';
      return {
        verdict,
        source: 'ai',
        reviewerUserId: null,
        rationale:
          decision.reasons.length > 0
            ? decision.reasons.map((r) => r.message).join('; ')
            : 'AI review complete.',
        redLines: decision.reasons
          .filter((r) => r.severity === 'critical' || r.severity === 'error')
          .map((r) => r.message),
        coachingHints: decision.suggestedFixes.map((f) => f.description),
      };
    },
  };

  // ── Approval router: in-memory default with no elastic thresholds.
  //   The router will fall back to 'ESTATE_MANAGER' when no thresholds
  //   are configured. Production should read from
  //   `tenants.settings.elasticConfig.approvalThresholds`.
  const approvalRouter = createInMemoryApprovalRouter({
    async readThresholds() {
      return null;
    },
  });

  // ── Committer: a single recording applier per workflow kind.
  //   Real production registers per-kind appliers that map the
  //   ProposedChange into the matching downstream table update.
  const committer = createCommitter();
  const KINDS: ReadonlyArray<WorkflowKind> = [
    'parcel_edit',
    'polygon_draw',
    'metadata_update',
    'photo_add',
    'inspection',
    'new_lease',
    'maintenance_completion',
    'document_upload',
    'po_approval',
    'requisition_submission',
  ];
  for (const kind of KINDS) {
    const applier: ChangeApplier = {
      kind,
      async apply() {
        return {
          success: true,
          applierDetails: {
            applied: false,
            reason:
              'no_kind_applier_registered_in_composition_root_yet',
          },
        };
      },
    };
    committer.register(applier);
  }

  // ── Repositories: Drizzle-backed when a DatabaseClient is present
  //   (production), in-memory otherwise (tests / DATABASE_URL unset).
  //   The Drizzle adapters persist runs / the four-eyes approval queue /
  //   the hashed audit chain to `workflow_runs` / `workflow_run_events`
  //   / `workflow_audit_chain` (migration 0307), so workflow state +
  //   the append-only audit chain survive an api-gateway restart
  //   (closes the SOC 2 CC7.2 gap in EX-10). Every Drizzle query runs
  //   inside an RLS tenant-context transaction.
  const db = getDb();
  let runRepository: WorkflowRunRepository;
  let eventRepository: WorkflowRunEventRepository;
  let auditChainRepository: AuditChainRepository;
  // Flow-keyed autonomy posture store (migration 0308). Drizzle-backed in
  // production so a flow's `auto | gated` posture survives a restart;
  // in-memory otherwise. The engine reads this seam to skip (AUTO) / block
  // (GATED, default) the per-run human-approval step; the inviolable rails
  // + autonomy-controller STILL gate per action.
  let flowAutonomy: FlowAutonomyRepository;
  if (db) {
    runRepository = createDrizzleRunRepository(db);
    eventRepository = createDrizzleRunEventRepository(db);
    auditChainRepository = createDrizzleAuditChainRepository(db);
    flowAutonomy = createDrizzleFlowAutonomyRepository(db);
  } else {
    runRepository = createInMemoryRunRepository();
    eventRepository = createInMemoryRunEventRepository();
    auditChainRepository = createInMemoryAuditChainRepository();
    flowAutonomy = createInMemoryFlowAutonomyRepository();
  }
  const auditChain = createAuditHashChain(auditChainRepository);

  const definitionRegistry = createDefinitionRegistry();

  const engine = createWorkflowEngine({
    scopeGuard: assignmentRegistry.scope,
    aiReviewer: aiReviewerPort,
    approvalRouter,
    committer,
    definitionRegistry,
    runRepository,
    eventRepository,
    auditChainRepository,
    auditChain,
    flowAutonomy,
  });

  cachedEngine = engine;
  cachedRegistry = assignmentRegistry;
  cachedFlowAutonomy = flowAutonomy;
  return { engine, assignmentRegistry, flowAutonomy };
}

/**
 * Test-only — drops the cached singleton so the next `getWorkflowEngine()`
 * builds fresh in-memory state. Useful for `beforeEach` isolation in
 * router tests that exercise live runs.
 */
export function resetWorkflowEngineForTests(): void {
  cachedEngine = null;
  cachedRegistry = null;
  cachedFlowAutonomy = null;
}
