/**
 * Dry-run gate — Wave 28.
 *
 * Runs a PolicyProposal through the ai-native policy-simulator using
 * historical leases / outcomes, produces a diff report, posts the
 * report to the head inbox, and flips the proposal into
 * `awaiting_human_review`. Nothing is committed without explicit
 * human approval.
 *
 * The policy-simulator in ai-native is scoped to RENT-POLICY changes;
 * for other domain patches we still produce a diff + projected
 * outcomes via a lightweight in-module simulation fed by recent
 * OutcomeEvents. The external simulator is invoked only when the
 * patch includes a scope it understands (finance rent-related);
 * absent that, the dry-run is still useful for gathering the diff.
 */

import type { AutonomyPolicy } from '../autonomy/types.js';
import type {
  DryRunReport,
  HeadInbox,
  OutcomeRepository,
  PatternEvidence,
  PolicyProposal,
  ProposalRepository,
  ProposalStatus,
} from './types.js';

export interface PolicySimulatorPort {
  /**
   * Narrow wrapper around the ai-native simulator. Returns a projected
   * success-rate + volume for the affected actionType. Implementations
   * may delegate to `createPolicySimulator(...)` or to an in-house
   * rule-based projection.
   */
  project(input: {
    readonly tenantId: string;
    readonly proposal: PolicyProposal;
  }): Promise<{
    readonly projectedSuccessRate: number;
    readonly projectedVolume: number;
    readonly notes?: string;
  }>;
}

export interface DryRunGateDeps {
  readonly proposals: ProposalRepository;
  readonly outcomes: OutcomeRepository;
  readonly currentPolicyProvider: (tenantId: string) => Promise<AutonomyPolicy>;
  readonly simulator?: PolicySimulatorPort;
  readonly headInbox: HeadInbox;
  readonly now?: () => Date;
}

function diff(
  before: AutonomyPolicy,
  patch: Partial<AutonomyPolicy>,
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const beforeValue = (before as unknown as Record<string, unknown>)[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      beforeValue !== null &&
      typeof beforeValue === 'object'
    ) {
      const innerBefore = beforeValue as Record<string, unknown>;
      // Cast through `unknown` — autonomy policy sub-blocks are typed as
      // a union of distinct domain-policy shapes that TS won't directly
      // narrow to a generic Record without the indirection.
      const innerAfter = value as unknown as Record<string, unknown>;
      for (const [inner, innerVal] of Object.entries(innerAfter)) {
        if (innerBefore[inner] !== innerVal) {
          out[`${key}.${inner}`] = {
            before: innerBefore[inner],
            after: innerVal,
          };
        }
      }
    } else if (beforeValue !== value) {
      out[key] = { before: beforeValue, after: value };
    }
  }
  return out;
}

function defaultProjection(
  evidence: readonly PatternEvidence[],
): { projectedSuccessRate: number; projectedVolume: number } {
  if (evidence.length === 0) {
    return { projectedSuccessRate: 0, projectedVolume: 0 };
  }
  const sumSuccess = evidence.reduce((a, e) => a + e.successRate * e.sampleSize, 0);
  const sumSize = evidence.reduce((a, e) => a + e.sampleSize, 0);
  return {
    projectedSuccessRate: sumSize === 0 ? 0 : sumSuccess / sumSize,
    projectedVolume: sumSize,
  };
}

function buildWarnings(proposal: PolicyProposal): readonly string[] {
  const warnings: string[] = [];
  if (proposal.confidence < 0.7) {
    warnings.push(
      `Proposal confidence ${proposal.confidence.toFixed(2)} is below 0.70 — request additional evidence before approval.`,
    );
  }
  for (const evidence of proposal.evidence) {
    if (evidence.sampleSize < 10) {
      warnings.push(
        `Evidence ${evidence.id} draws from only ${evidence.sampleSize} samples — consider waiting for more data.`,
      );
    }
    if (!evidence.significant) {
      warnings.push(
        `Evidence ${evidence.id} is not statistically significant (chi² ${evidence.chiSquared.toFixed(2)}).`,
      );
    }
  }
  return warnings;
}

export async function runProposalThroughSimulator(
  proposalOrId: PolicyProposal | string,
  deps: DryRunGateDeps,
): Promise<DryRunReport> {
  const proposal =
    typeof proposalOrId === 'string'
      // nosemgrep: missing-tenant-id-arg reason: proposals are globally-unique; downstream code reads `proposal.tenantId` from the returned record (see line 140).
      ? await deps.proposals.findById(proposalOrId)
      : proposalOrId;
  if (!proposal) {
    throw new Error('dry-run-gate: proposal not found');
  }

  const now = deps.now ?? (() => new Date());
  const nowIso = now().toISOString();

  const currentPolicy = await deps.currentPolicyProvider(proposal.tenantId);
  const diffMap = diff(currentPolicy, proposal.proposedPatch);

  await deps.proposals.updateStatus(proposal.id, 'dry_run_pending' as ProposalStatus);

  let projected: {
    projectedSuccessRate: number;
    projectedVolume: number;
    notes?: string;
  };
  if (deps.simulator) {
    try {
      projected = await deps.simulator.project({
        tenantId: proposal.tenantId,
        proposal,
      });
    } catch (err) {
      const fallback = defaultProjection(proposal.evidence);
      projected = {
        ...fallback,
        notes: `Simulator error: ${err instanceof Error ? err.message : 'unknown'}. Using evidence-based projection.`,
      };
    }
  } else {
    projected = defaultProjection(proposal.evidence);
  }

  const report: DryRunReport = {
    proposalId: proposal.id,
    diff: diffMap,
    simulatedOutcomes: {
      projectedSuccessRate: projected.projectedSuccessRate,
      projectedVolume: projected.projectedVolume,
      estimatedImpact:
        projected.notes ?? proposal.estimatedImpact,
    },
    warnings: buildWarnings(proposal),
    generatedAt: nowIso,
  };

  const body = [
    `Learning-loop policy proposal ${proposal.id} is ready for review.`,
    '',
    `Reasoning: ${proposal.reasoning}`,
    `Estimated impact: ${proposal.estimatedImpact}`,
    `Projected success-rate: ${(report.simulatedOutcomes.projectedSuccessRate * 100).toFixed(1)}%`,
    `Projected volume: ${report.simulatedOutcomes.projectedVolume}`,
    '',
    'Diff:',
    ...Object.entries(diffMap).map(
      ([k, v]) => `  - ${k}: ${JSON.stringify(v.before)} -> ${JSON.stringify(v.after)}`,
    ),
    ...(report.warnings.length > 0
      ? ['', 'Warnings:', ...report.warnings.map((w) => `  ! ${w}`)]
      : []),
    '',
    'Approve or reject via the autonomy-review console.',
  ].join('\n');

  await deps.headInbox.post({
    tenantId: proposal.tenantId,
    subject: `Policy proposal ${proposal.id} — awaiting review`,
    body,
    proposalId: proposal.id,
  });

  await deps.proposals.updateStatus(proposal.id, 'awaiting_human_review' as ProposalStatus);

  return report;
}

// ---------------------------------------------------------------------------
// In-memory proposal repository — test fixtures + local dev.
// ---------------------------------------------------------------------------

export function createInMemoryProposalRepository(): ProposalRepository {
  const rows = new Map<string, PolicyProposal>();
  return {
    async insert(proposal) {
      rows.set(proposal.id, proposal);
      return proposal;
    },
    async updateStatus(id, status) {
      const existing = rows.get(id);
      if (!existing) return null;
      const updated: PolicyProposal = { ...existing, status };
      rows.set(id, updated);
      return updated;
    },
    async findPending(tenantId) {
      return Array.from(rows.values()).filter(
        (p) =>
          p.tenantId === tenantId &&
          (p.status === 'draft' ||
            p.status === 'dry_run_pending' ||
            p.status === 'dry_run_complete' ||
            p.status === 'awaiting_human_review'),
      );
    },
    async findById(id) {
      return rows.get(id) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory head inbox — test fixtures.
// ---------------------------------------------------------------------------

export interface CapturedHeadMessage {
  readonly tenantId: string;
  readonly subject: string;
  readonly body: string;
  readonly proposalId: string;
}

export function createInMemoryHeadInbox(): HeadInbox & {
  readonly messages: readonly CapturedHeadMessage[];
} {
  const messages: CapturedHeadMessage[] = [];
  return {
    messages,
    async post(input) {
      messages.push({ ...input });
    },
  };
}
