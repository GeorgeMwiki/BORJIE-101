/**
 * Peer Debate coordination pattern.
 *
 * Wave 18HH. Two or three specialisations argue opposing positions on
 * the same subject. Each posts a `hypothesis` per round. After N
 * rounds (default 2), the supervisor adjudicates — picks one,
 * synthesises, or escalates to the owner.
 *
 * We deliberately do NOT auto-vote inside the swarm. See spec §5.2.
 * Adjudication is supervisor-driven.
 *
 * Implementation is a coordinator: the per-round debater output is
 * delegated to a `DebaterExecutor` port the caller provides.
 */

import type {
  BlackboardPoster,
} from '../blackboard/blackboard-poster.js';
import type { AgentSubject, BlackboardPosting } from '../types.js';
import { SWARM_CONSTANTS } from '../types.js';

export interface DebaterExecutor {
  argue(args: {
    readonly tenantId: string;
    readonly subject: AgentSubject;
    readonly debaterAgentId: string;
    readonly roundNumber: number;
    readonly priorRoundPostings: ReadonlyArray<BlackboardPosting>;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export interface PeerDebateRunInput {
  readonly tenantId: string;
  readonly supervisorAgentId: string;
  readonly subject: AgentSubject;
  readonly debaterAgentIds: ReadonlyArray<string>;
  readonly rounds?: number;
  readonly scopeId?: string;
}

export interface PeerDebateRunResult {
  readonly hypotheses: ReadonlyArray<BlackboardPosting>;
}

export interface PeerDebateDeps {
  readonly blackboardPoster: BlackboardPoster;
  readonly executor: DebaterExecutor;
}

export function createPeerDebate(deps: PeerDebateDeps): {
  run(input: PeerDebateRunInput): Promise<PeerDebateRunResult>;
} {
  return {
    async run(input) {
      if (input.debaterAgentIds.length < 2) {
        throw new Error('Peer debate requires at least 2 debaters');
      }
      const rounds = input.rounds ?? SWARM_CONSTANTS.PEER_DEBATE_ROUNDS;
      const allHypotheses: BlackboardPosting[] = [];

      for (let round = 1; round <= rounds; round++) {
        const roundPostings: BlackboardPosting[] = [];
        for (const debaterAgentId of input.debaterAgentIds) {
          const argument = await deps.executor.argue({
            tenantId: input.tenantId,
            subject: input.subject,
            debaterAgentId,
            roundNumber: round,
            priorRoundPostings: allHypotheses,
          });
          const posted = await deps.blackboardPoster.post({
            tenantId: input.tenantId,
            postedByAgentId: debaterAgentId,
            subject: input.subject,
            contributionKind: 'hypothesis',
            payload: { ...argument, roundNumber: round },
            ...(input.scopeId !== undefined
              ? { scopeId: input.scopeId }
              : {}),
          });
          roundPostings.push(posted.posting);
          allHypotheses.push(posted.posting);
        }
      }

      return Object.freeze({ hypotheses: allHypotheses });
    },
  };
}
