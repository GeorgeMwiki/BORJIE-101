/**
 * Orchestrator — composes policies + brain + audit into the public
 * `createAIReviewer` factory.
 *
 * Decision pipeline:
 *   1. Validate request kind (must be in WORKFLOW_KINDS).
 *   2. Run policy.redLines() — if any, return `reject_final` without
 *      calling the brain.
 *   3. Run policy.preChecks() — if any errors, return `reject_with_changes`
 *      synthesised from the issues.
 *   4. Otherwise, call runBrainReview() and trust its verdict (subject
 *      to schema validation in the brain layer).
 *   5. Emit exactly one audit record per call, regardless of path.
 */

import {
  type BrainCoachPort,
  type BrainPort,
  type CoachingMessage,
  type DecisionReason,
  type ReviewAuditPort,
  type ReviewAuditRecord,
  type ReviewDecision,
  type ReviewRequest,
  type SuggestedFix,
  type UserContextPort,
  type WorkInProgress,
  type Verdict,
  WORKFLOW_KINDS,
} from './types.js';
import { policyFor, POLICY_REGISTRY } from './policies/index.js';
import { runBrainReview } from './brain/index.js';
import { coachWorkInProgress } from './coaching/index.js';

export interface CreateAIReviewerArgs {
  readonly brain: BrainPort;
  readonly audit: ReviewAuditPort;
  readonly coachBrain?: BrainCoachPort;
  readonly userContextStore?: UserContextPort;
}

export interface AIReviewer {
  review(request: ReviewRequest): Promise<ReviewDecision>;
  coach(wip: WorkInProgress): Promise<ReadonlyArray<CoachingMessage>>;
}

function isKnownKind(kind: string): kind is (typeof WORKFLOW_KINDS)[number] {
  return (WORKFLOW_KINDS as ReadonlyArray<string>).includes(kind);
}

function issuesToReasons(
  issues: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
    readonly severity: 'info' | 'warning' | 'error' | 'critical';
    readonly field?: string;
  }>,
): ReadonlyArray<DecisionReason> {
  return issues.map((i) => ({
    code: i.code,
    message: i.message,
    severity: i.severity,
    ...(i.field === undefined ? {} : { field: i.field }),
  }));
}

function issuesToFixes(
  issues: ReadonlyArray<{
    readonly suggestedFix?: { readonly description: string; readonly patch?: Readonly<Record<string, unknown>> };
  }>,
): ReadonlyArray<SuggestedFix> {
  const out: SuggestedFix[] = [];
  for (const i of issues) {
    if (i.suggestedFix) {
      out.push({
        description: i.suggestedFix.description,
        ...(i.suggestedFix.patch === undefined ? {} : { patch: i.suggestedFix.patch }),
      });
    }
  }
  return out;
}

export function createAIReviewer(args: CreateAIReviewerArgs): AIReviewer {
  const { brain, audit, coachBrain, userContextStore } = args;

  return {
    async review(request: ReviewRequest): Promise<ReviewDecision> {
      const decidedAt = new Date().toISOString();

      if (!isKnownKind(request.kind)) {
        const decision: ReviewDecision = {
          verdict: 'reject_final',
          confidence: 1,
          reasons: [
            {
              code: 'request.kind.unknown',
              message: `Unknown workflow kind: ${request.kind}.`,
              severity: 'critical',
            },
          ],
          suggestedFixes: [],
          ...(request.context.correlationId === undefined
            ? {}
            : { correlationId: request.context.correlationId }),
          decidedAt,
        };
        await emitAudit({
          audit,
          request,
          decision,
          preCheckIssueCount: 0,
          redLineIssueCount: 0,
          brainInvoked: false,
        });
        return decision;
      }

      const policy = policyFor(request.kind);
      const policyRequest = {
        kind: request.kind,
        payload: request.payload,
        context: request.context,
      };

      const redLineIssues = policy.redLines(policyRequest);
      if (redLineIssues.length > 0) {
        const decision: ReviewDecision = {
          verdict: 'reject_final',
          confidence: 1,
          reasons: issuesToReasons(redLineIssues),
          suggestedFixes: issuesToFixes(redLineIssues),
          ...(request.context.correlationId === undefined
            ? {}
            : { correlationId: request.context.correlationId }),
          decidedAt,
        };
        await emitAudit({
          audit,
          request,
          decision,
          preCheckIssueCount: 0,
          redLineIssueCount: redLineIssues.length,
          brainInvoked: false,
        });
        return decision;
      }

      const preCheckIssues = policy.preChecks(policyRequest);
      const blockingPreChecks = preCheckIssues.filter(
        (i) => i.severity === 'error' || i.severity === 'critical',
      );
      if (blockingPreChecks.length > 0) {
        const decision: ReviewDecision = {
          verdict: 'reject_with_changes',
          confidence: 1,
          reasons: issuesToReasons(blockingPreChecks),
          suggestedFixes: issuesToFixes(blockingPreChecks),
          ...(request.context.correlationId === undefined
            ? {}
            : { correlationId: request.context.correlationId }),
          decidedAt,
        };
        await emitAudit({
          audit,
          request,
          decision,
          preCheckIssueCount: preCheckIssues.length,
          redLineIssueCount: 0,
          brainInvoked: false,
        });
        return decision;
      }

      const brainDecision = await runBrainReview({
        request: policyRequest,
        policy,
        brain,
      });
      await emitAudit({
        audit,
        request,
        decision: brainDecision,
        preCheckIssueCount: preCheckIssues.length,
        redLineIssueCount: 0,
        brainInvoked: true,
      });
      return brainDecision;
    },

    async coach(wip: WorkInProgress): Promise<ReadonlyArray<CoachingMessage>> {
      if (!isKnownKind(wip.kind)) return [];
      return coachWorkInProgress({
        runInProgress: wip,
        ...(coachBrain === undefined ? {} : { brain: coachBrain }),
        ...(userContextStore === undefined ? {} : { userContext: userContextStore }),
      });
    },
  };
}

interface EmitAuditArgs {
  readonly audit: ReviewAuditPort;
  readonly request: ReviewRequest;
  readonly decision: ReviewDecision;
  readonly preCheckIssueCount: number;
  readonly redLineIssueCount: number;
  readonly brainInvoked: boolean;
}

async function emitAudit(args: EmitAuditArgs): Promise<void> {
  const { audit, request, decision, preCheckIssueCount, redLineIssueCount, brainInvoked } = args;
  const verdict: Verdict = decision.verdict;
  const record: ReviewAuditRecord = {
    kind: request.kind,
    tenantId: request.context.tenantId,
    actorUserId: request.context.actorUserId,
    actorRole: request.context.actorRole,
    verdict,
    confidence: decision.confidence,
    reasonCount: decision.reasons.length,
    preCheckIssueCount,
    redLineIssueCount,
    brainInvoked,
    ...(request.context.correlationId === undefined
      ? {}
      : { correlationId: request.context.correlationId }),
    timestamp: new Date().toISOString(),
  };
  try {
    await audit.recordReview(record);
  } catch {
    // Audit failures must never block the response. Downstream chain-verify
    // jobs will detect gaps; here we degrade gracefully.
  }
}

// Re-export so consumers don't need a second import.
export { POLICY_REGISTRY };
