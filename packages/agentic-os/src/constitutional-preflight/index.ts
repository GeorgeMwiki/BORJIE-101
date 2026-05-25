/**
 * constitutional-preflight — every agent action passes through the
 * constitution BEFORE execution. Violations either block immediately
 * (severity=refuse) or escalate to human review via the workflow engine
 * (severity=warn).
 *
 * Pattern: Anthropic Constitutional AI v3 (Bai 2022 + 2024 update) and
 * OpenAI Deliberative Alignment (Dec 2024). The brain cites the
 * constitution + reasons step-by-step against it before acting. Apollo
 * Research's o3 study (2025) showed covert action drop 13.0% → 0.4%
 * with this pattern.
 *
 * Jurisdiction overlay: per-tenant policy can require stricter clauses;
 * we union the global rule-set with the active jurisdiction's overlay.
 */

import type {
  ConstitutionalCheck,
  ConstitutionPort,
  Jurisdiction,
  PreflightDecision,
  WorkflowEnginePort,
} from '../types.js';
import { nowIso } from '../types.js';

// ============================================================================
// preflightCheck
// ============================================================================

export interface PreflightArgs {
  readonly agentId: string;
  readonly tenantId: string;
  readonly action: string;
  readonly actionTags: ReadonlyArray<string>;
  readonly jurisdiction: Jurisdiction;
  readonly context: Readonly<Record<string, unknown>>;
  readonly constitution: ConstitutionPort;
  /** Used when decision is `escalate`. */
  readonly workflowEngine?: WorkflowEnginePort;
}

export async function preflightCheck(
  args: PreflightArgs,
): Promise<ConstitutionalCheck> {
  const evaluation = await args.constitution.evaluate({
    action: args.action,
    actionTags: args.actionTags,
    jurisdiction: args.jurisdiction,
    context: args.context,
  });

  let decision: PreflightDecision = evaluation.decision;
  let escalatedRunId: string | undefined;

  // If escalate: open a workflow run for human review
  if (decision === 'escalate' && args.workflowEngine) {
    const run = await args.workflowEngine.openApprovalRun({
      tenantId: args.tenantId,
      kind: deriveWorkflowKind(args.actionTags),
      initiatedByAgentId: args.agentId,
      subject: args.action,
      proposedAction: { action: args.action, tags: args.actionTags },
      reason: `constitutional escalation: ${evaluation.rationale}`,
    });
    escalatedRunId = run.runId;
  } else if (decision === 'escalate' && !args.workflowEngine) {
    // No workflow engine wired → coerce to block (safer fallback)
    decision = 'block';
  }

  const check: ConstitutionalCheck = Object.freeze({
    decision,
    firedClauses: evaluation.firedClauses.map((c) => c.id),
    rationale: evaluation.rationale,
    appliedJurisdiction: args.jurisdiction,
    ...(escalatedRunId ? { escalatedRunId } : {}),
    checkedAt: nowIso(),
  });

  return check;
}

function deriveWorkflowKind(tags: ReadonlyArray<string>): string {
  // Map agent action tags to workflow kinds the workflow engine knows about.
  // Conservative default: metadata_update — least-privilege workflow.
  if (tags.includes('eviction')) return 'metadata_update';
  if (tags.includes('lease.new')) return 'new_lease';
  if (tags.includes('po.approval')) return 'po_approval';
  if (tags.includes('inspection')) return 'inspection';
  if (tags.includes('document.upload')) return 'document_upload';
  return 'metadata_update';
}

// ============================================================================
// Jurisdiction overlay helper — composable constitution combiner
// ============================================================================

/**
 * Wrap a base constitution with a jurisdiction-specific overlay that
 * adds extra rules. Useful when tenant policy is stricter than global.
 *
 * The overlay can promote a clause severity (e.g. `warn` → `refuse`) but
 * never demote it. Result: strictly safer than either rule-set alone.
 */
export function composeConstitutionWithOverlay(
  base: ConstitutionPort,
  overlay: ConstitutionPort,
): ConstitutionPort {
  return {
    async evaluate(args) {
      const [b, o] = await Promise.all([
        base.evaluate(args),
        overlay.evaluate(args),
      ]);
      const decision = maxStrictness(b.decision, o.decision);
      const allClauseIds = new Set<string>();
      const merged: Array<{
        readonly id: string;
        readonly severity: 'refuse' | 'warn' | 'inform';
        readonly jurisdictions: ReadonlyArray<Jurisdiction>;
        readonly appliesTo: ReadonlyArray<string>;
      }> = [];
      for (const c of [...b.firedClauses, ...o.firedClauses]) {
        if (!allClauseIds.has(c.id)) {
          allClauseIds.add(c.id);
          merged.push(c);
        }
      }
      return {
        decision,
        firedClauses: merged,
        rationale: [b.rationale, o.rationale].filter(Boolean).join(' | '),
      };
    },
  };
}

const STRICTNESS: Record<PreflightDecision, number> = {
  allow: 0,
  escalate: 1,
  block: 2,
};

function maxStrictness(
  a: PreflightDecision,
  b: PreflightDecision,
): PreflightDecision {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}
