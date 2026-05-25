/**
 * LLM proposal step. We do NOT call an LLM directly from this package —
 * instead, callers inject an `LlmProposerFn` (returning a JSON string).
 * This keeps J2 free of any LLM-vendor dependency and lets the ai-copilot
 * package (post-CL-B2) wire whichever provider it wants.
 *
 * The contract is strict: the function's return value is parsed as JSON,
 * then validated against `entityMappingProposalSchema`. Anything that
 * fails validation produces a clear error — never a half-applied mapping.
 */

import type { InferredSchema } from '../schema-sniff/types.js';
import type { EntityTypeDescriptor } from '../entity-store/IEntityStoreService.js';

import { entityMappingProposalSchema, type EntityMappingProposal } from './types.js';

export interface LlmProposerContext {
  readonly schema: InferredSchema;
  readonly availableEntityTypes: ReadonlyArray<EntityTypeDescriptor>;
  /** Result of the heuristic pass — useful as a "starting suggestion" in the prompt. */
  readonly heuristicProposal: EntityMappingProposal;
}

/**
 * Async function that returns a JSON string matching
 * `entityMappingProposalSchema`. Production wiring (post-CL-B2) calls
 * Anthropic / OpenAI / etc. Tests inject a deterministic function.
 */
export type LlmProposerFn = (context: LlmProposerContext) => Promise<string>;

export class LlmProposalValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly issues: ReadonlyArray<string>
  ) {
    super(message);
    this.name = 'LlmProposalValidationError';
  }
}

/**
 * Run the LLM proposer, validate its output. Throws
 * LlmProposalValidationError on any failure (malformed JSON, missing
 * fields, wrong types, hallucinated entity_type not in availableEntityTypes).
 */
export async function proposeMappingViaLlm(
  context: LlmProposerContext,
  proposer: LlmProposerFn
): Promise<EntityMappingProposal> {
  const raw = await proposer(context);
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new LlmProposalValidationError(
      'LLM proposer returned empty output',
      String(raw),
      ['empty output']
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new LlmProposalValidationError(
      `LLM proposer returned non-JSON output: ${(err as Error).message}`,
      raw,
      ['invalid JSON']
    );
  }

  const result = entityMappingProposalSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmProposalValidationError(
      'LLM proposer output failed schema validation',
      raw,
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    );
  }

  const proposal = result.data;

  // Sanity-check: entity_type must be one we advertised.
  const allowedTypes = new Set(context.availableEntityTypes.map((t) => t.entity_type));
  if (!allowedTypes.has(proposal.entity_type)) {
    throw new LlmProposalValidationError(
      `LLM hallucinated unknown entity_type "${proposal.entity_type}"`,
      raw,
      [`entity_type not in available set: ${Array.from(allowedTypes).join(', ')}`]
    );
  }

  // Sanity-check: every field_map column must exist in the schema; every
  // value must be an attribute key advertised for the chosen entity type.
  const knownColumns = new Set(context.schema.columns.map((c) => c.name));
  const descriptor = context.availableEntityTypes.find(
    (t) => t.entity_type === proposal.entity_type
  );
  const knownAttrs = new Set(descriptor?.attribute_keys ?? []);
  const issues: string[] = [];
  for (const [col, attr] of Object.entries(proposal.field_map)) {
    if (!knownColumns.has(col)) {
      issues.push(`field_map references unknown column "${col}"`);
    }
    if (!knownAttrs.has(attr)) {
      issues.push(`field_map references unknown attribute "${attr}" for ${proposal.entity_type}`);
    }
  }
  if (issues.length > 0) {
    throw new LlmProposalValidationError(
      'LLM proposer output references unknown columns/attributes',
      raw,
      issues
    );
  }

  return proposal;
}
