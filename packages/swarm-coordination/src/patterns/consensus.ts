/**
 * Consensus coordination pattern.
 *
 * Wave 18HH. All-must-agree. Used for Tier 2-Critical actions
 * (irreversible mine-plan changes, mass deletions, counterparty
 * terminations). All relevant specialisations PLUS the nominated
 * owner must approve before the mutation executes.
 *
 * The underlying primitive is the Wave 18S `approval_policy_actions`
 * quorum table — swarm-coordination layers consensus *agent set*
 * discovery on top. This module is a *coordinator* — actual approval
 * persistence is delegated to the Wave 18S authority gate.
 */

import type {
  ActiveAgentsRegistry,
} from '../registry/active-agents-registry.js';
import type { AgentSubject } from '../types.js';

export interface ConsensusVote {
  readonly agentId: string;
  readonly approved: boolean;
  readonly rationale?: string;
}

export interface ConsensusVoter {
  vote(args: {
    readonly tenantId: string;
    readonly subject: AgentSubject;
    readonly voterAgentId: string;
    readonly proposalPayload: Readonly<Record<string, unknown>>;
  }): Promise<ConsensusVote>;
}

export interface ConsensusRunInput {
  readonly tenantId: string;
  readonly subject: AgentSubject;
  readonly requiredVoterAgentIds: ReadonlyArray<string>;
  readonly proposalPayload: Readonly<Record<string, unknown>>;
}

export interface ConsensusRunResult {
  readonly consensusReached: boolean;
  readonly votes: ReadonlyArray<ConsensusVote>;
  readonly missingVoters: ReadonlyArray<string>;
}

export interface ConsensusDeps {
  readonly registry: ActiveAgentsRegistry;
  readonly voter: ConsensusVoter;
}

export function createConsensus(deps: ConsensusDeps): {
  run(input: ConsensusRunInput): Promise<ConsensusRunResult>;
} {
  return {
    async run(input) {
      if (input.requiredVoterAgentIds.length === 0) {
        throw new Error('Consensus requires at least one voter');
      }

      const runningOnSubject = await deps.registry.listRunningOnSubject(
        input.tenantId,
        input.subject,
      );
      const runningAgentIds = new Set(
        runningOnSubject.map((a) => a.agentId),
      );

      const votes: ConsensusVote[] = [];
      const missingVoters: string[] = [];

      for (const voterAgentId of input.requiredVoterAgentIds) {
        if (!runningAgentIds.has(voterAgentId)) {
          missingVoters.push(voterAgentId);
          continue;
        }
        const vote = await deps.voter.vote({
          tenantId: input.tenantId,
          subject: input.subject,
          voterAgentId,
          proposalPayload: input.proposalPayload,
        });
        votes.push(vote);
      }

      const consensusReached =
        missingVoters.length === 0 && votes.every((v) => v.approved);

      return Object.freeze({
        consensusReached,
        votes,
        missingVoters,
      });
    },
  };
}
