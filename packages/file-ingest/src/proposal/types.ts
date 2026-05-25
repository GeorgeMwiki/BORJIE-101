import { z } from 'zod';

/**
 * Zod schema for the LLM's proposed entity mapping. We validate every LLM
 * call against this — bad output (missing field, wrong type, hallucinated
 * column) is rejected before it reaches the approval layer.
 */
export const entityMappingProposalSchema = z.object({
  entity_type: z.string().min(1),
  field_map: z.record(z.string(), z.string()),
  confidence: z.number().min(0).max(1),
  llm_rationale: z.string(),
  conflicts: z.array(
    z.object({
      column: z.string(),
      reason: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    })
  ),
});

export type EntityMappingProposal = z.infer<typeof entityMappingProposalSchema>;

export interface ProposalConflict {
  readonly column: string;
  readonly reason: string;
  readonly severity: 'low' | 'medium' | 'high';
}
