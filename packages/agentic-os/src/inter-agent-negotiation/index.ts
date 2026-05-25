/**
 * inter-agent-negotiation — when two agents disagree, a judge panel (the
 * W1.4 5-rubric jury) arbitrates. Each agent presents a position; judges
 * score on shared rubrics; majority wins. Ties escalate to human review
 * via the workflow engine.
 *
 * Pattern: judge-jury / debate (Anthropic SAE 2024, OpenAI debate
 * 2018-2023). Loser's position is recorded for future training data.
 */

import type {
  AgentPosition,
  JudgeVerdict,
  NegotiationRound,
  WorkflowEnginePort,
} from '../types.js';
import { nowIso } from '../types.js';

// ============================================================================
// Judge port — duck-typed over W1.4 judge-jury
// ============================================================================

export interface JudgePort {
  readonly id: string;
  vote(args: {
    readonly positions: ReadonlyArray<AgentPosition>;
    readonly rubrics: ReadonlyArray<string>;
  }): Promise<JudgeVerdict>;
}

// ============================================================================
// negotiateConflict
// ============================================================================

export interface NegotiateArgs {
  readonly tenantId: string;
  readonly conflictId: string;
  readonly positions: ReadonlyArray<AgentPosition>;
  readonly judges: ReadonlyArray<JudgePort>;
  /** Optional override: rubrics used by judges. Defaults to a 5-rubric set. */
  readonly rubrics?: ReadonlyArray<string>;
  /** Required if we may need to escalate. */
  readonly workflowEngine?: WorkflowEnginePort;
}

const DEFAULT_RUBRICS: ReadonlyArray<string> = Object.freeze([
  'evidence-grounding',
  'tenant-fairness',
  'regulatory-compliance',
  'cost-effectiveness',
  'operational-feasibility',
]);

export async function negotiateConflict(
  args: NegotiateArgs,
): Promise<NegotiationRound> {
  if (args.positions.length < 2) {
    throw new Error('negotiateConflict requires at least 2 positions');
  }
  if (args.judges.length === 0) {
    throw new Error('negotiateConflict requires at least 1 judge');
  }

  const rubrics = args.rubrics ?? DEFAULT_RUBRICS;

  const verdicts = await Promise.all(
    args.judges.map((j) =>
      j.vote({ positions: args.positions, rubrics }),
    ),
  );

  const winnerAgentId = pickMajorityWinner(verdicts, args.positions);

  if (winnerAgentId !== null) {
    return Object.freeze<NegotiationRound>({
      id: args.conflictId,
      positions: args.positions,
      verdicts: Object.freeze(verdicts),
      winnerAgentId,
      outcome: 'resolved',
      resolvedAt: nowIso(),
    });
  }

  // Tie → escalate
  if (!args.workflowEngine) {
    return Object.freeze<NegotiationRound>({
      id: args.conflictId,
      positions: args.positions,
      verdicts: Object.freeze(verdicts),
      winnerAgentId: null,
      outcome: 'escalated',
      resolvedAt: nowIso(),
    });
  }

  const run = await args.workflowEngine.openApprovalRun({
    tenantId: args.tenantId,
    kind: 'metadata_update',
    initiatedByAgentId: 'agentic-os-negotiator',
    subject: `Tie-break conflict ${args.conflictId}`,
    proposedAction: {
      conflictId: args.conflictId,
      positions: args.positions.map((p) => ({
        agentId: p.agentId,
        proposal: p.proposal,
      })),
    },
    reason: 'judge panel could not resolve; human approval required',
  });

  return Object.freeze<NegotiationRound>({
    id: args.conflictId,
    positions: args.positions,
    verdicts: Object.freeze(verdicts),
    winnerAgentId: null,
    outcome: 'escalated',
    escalatedRunId: run.runId,
    resolvedAt: nowIso(),
  });
}

// ============================================================================
// internal helpers
// ============================================================================

function pickMajorityWinner(
  verdicts: ReadonlyArray<JudgeVerdict>,
  positions: ReadonlyArray<AgentPosition>,
): string | null {
  const tally = new Map<string, number>();
  for (const v of verdicts) {
    if (!v.winnerAgentId) continue;
    tally.set(v.winnerAgentId, (tally.get(v.winnerAgentId) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  const max = Math.max(...tally.values());
  const winners = Array.from(tally.entries()).filter(([, c]) => c === max);
  if (winners.length === 1) {
    return winners[0]?.[0] ?? null;
  }
  // True tie — break with weighted confidence sum
  let bestAgent: string | null = null;
  let bestScore = -Infinity;
  for (const [agentId] of winners) {
    const score = positions
      .filter((p) => p.agentId === agentId)
      .reduce((acc, p) => acc + p.confidence, 0);
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agentId;
    }
  }
  // Only break tie if confidence gap is significant; otherwise null = escalate
  const winnerConfidenceSpread = (() => {
    if (winners.length < 2) return Infinity;
    const scores = winners.map(([id]) =>
      positions
        .filter((p) => p.agentId === id)
        .reduce((acc, p) => acc + p.confidence, 0),
    );
    const sorted = scores.slice().sort((a, b) => b - a);
    const first = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    return first - second;
  })();
  if (winnerConfidenceSpread >= 0.2) return bestAgent;
  return null;
}
