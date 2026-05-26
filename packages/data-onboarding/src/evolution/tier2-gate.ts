/**
 * Stage 4.d — Tier-2 gate.
 *
 * Routes a schema-evolution proposal through the Wave 18S
 * mutation-authority by emitting the canonical handoff envelope. This
 * module does NOT import @borjie/mutation-authority directly to keep
 * the package's compile-time deps minimal at scaffold time; the
 * runtime composition root binds the actual dispatcher.
 */

import type { SchemaEvolutionProposal } from '../types.js';

export interface MutationAuthorityHandoff {
  readonly mutation_class: 'data';
  readonly authority_tier: 2;
  readonly subject: { readonly kind: 'schema_evolution'; readonly id: string };
  readonly preview: {
    readonly summary: string;
    readonly current: unknown;
    readonly proposed: unknown;
    readonly impactNotes?: string;
  };
  readonly required_double_verify: boolean;
  readonly research_evidence_ids: ReadonlyArray<string>;
  readonly reversibility: SchemaEvolutionProposal['reversibility'];
}

export interface Tier2Dispatcher {
  dispatch(handoff: MutationAuthorityHandoff): Promise<{ proposal_id: string }>;
}

export function buildHandoff(
  proposal: SchemaEvolutionProposal,
  ctx: { readonly summary: string; readonly current: unknown; readonly proposed: unknown },
): MutationAuthorityHandoff {
  return Object.freeze({
    mutation_class: 'data' as const,
    authority_tier: 2 as const,
    subject: Object.freeze({
      kind: 'schema_evolution' as const,
      id: proposal.id,
    }),
    preview: Object.freeze({
      summary: ctx.summary,
      current: ctx.current,
      proposed: ctx.proposed,
      impactNotes: proposal.side_effects.join('; '),
    }),
    required_double_verify: proposal.reversibility === 'irreversible',
    research_evidence_ids: proposal.research_evidence_ids,
    reversibility: proposal.reversibility,
  });
}

/**
 * Idempotent fake dispatcher for tests + dev. Production wiring
 * replaces this with the real mutation-authority registry call.
 */
export function createInMemoryTier2Dispatcher(): Tier2Dispatcher {
  let counter = 0;
  return Object.freeze({
    async dispatch(_handoff: MutationAuthorityHandoff) {
      counter += 1;
      return Object.freeze({ proposal_id: `mock_proposal_${counter}` });
    },
  });
}
