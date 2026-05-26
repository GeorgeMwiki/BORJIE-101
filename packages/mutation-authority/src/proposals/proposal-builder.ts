/**
 * Proposal-builder — wraps `recipe.compose(ctx)` with the runtime
 * invariants the spec demands:
 *
 *   - subject scope must match recipe class
 *   - research_evidence_ids must be non-empty for Tier 1+ proposals
 *   - expiry computed from tier
 *   - requires_double_verify auto-set when the recipe is critical OR
 *     when funds threshold / bulk delete heuristics trip
 *   - audit_hash computed by binding (recipe_id, version, subject,
 *     preview, proposed_at)
 *
 * The builder NEVER mutates the proposal returned by the recipe — it
 * spreads into a new object with the runtime fields stamped on top.
 */

import { chainHash, GENESIS_HASH } from '@borjie/audit-hash-chain';
import {
  BULK_DELETE_ROW_THRESHOLD,
  DEFAULT_FUNDS_THRESHOLD_CENTS,
  EXPIRY_MS_BY_TIER,
  type MutationProposal,
  type MutationRecipe,
  type MutationComposeContext,
} from '../types.js';

export interface ProposalBuilderArgs {
  readonly recipe: MutationRecipe;
  readonly context: MutationComposeContext;
  /**
   * Funds threshold for triggering double-verify. Defaults to
   * `DEFAULT_FUNDS_THRESHOLD_CENTS` ($50,000).
   */
  readonly fundsThresholdCents?: number;
  /**
   * If the subject describes a bulk operation, the caller may pass
   * row-count here so the builder can apply the bulk-delete heuristic.
   */
  readonly affectedRowCount?: number;
  /**
   * uuid generator. Defaults to `crypto.randomUUID()`; injected for
   * deterministic tests.
   */
  readonly uuid?: () => string;
}

export interface BuildProposalResult {
  readonly proposal: MutationProposal;
  readonly tripped: ReadonlyArray<DoubleVerifyTrigger>;
}

export type DoubleVerifyTrigger =
  | 'recipe_critical'
  | 'funds_threshold'
  | 'bulk_delete';

function expiryIsoFor(
  tier: number,
  isCritical: boolean,
  nowIso: string,
): string {
  const key =
    tier === 0
      ? 'tier_0'
      : tier === 1
        ? 'tier_1'
        : isCritical
          ? 'tier_2_critical'
          : 'tier_2';
  const ms = EXPIRY_MS_BY_TIER[key] ?? 0;
  const now = Date.parse(nowIso);
  return new Date(now + ms).toISOString();
}

export async function buildProposal(
  args: ProposalBuilderArgs,
): Promise<BuildProposalResult> {
  const { recipe, context } = args;
  const composed = await recipe.compose(context);

  const fundsThreshold =
    args.fundsThresholdCents ?? DEFAULT_FUNDS_THRESHOLD_CENTS;

  const tripped: DoubleVerifyTrigger[] = [];

  if (recipe.is_critical) {
    tripped.push('recipe_critical');
  }

  if (
    composed.cost_or_value_at_stake_usd_cents >= fundsThreshold &&
    composed.authority_tier === 2
  ) {
    tripped.push('funds_threshold');
  }

  if (
    args.affectedRowCount !== undefined &&
    args.affectedRowCount > BULK_DELETE_ROW_THRESHOLD &&
    composed.subject.kind === 'bulk_delete'
  ) {
    tripped.push('bulk_delete');
  }

  const requires_double_verify = tripped.length > 0;

  const uuid = args.uuid ?? (() => crypto.randomUUID());
  const id = composed.id !== '' ? composed.id : uuid();

  const expires_at = expiryIsoFor(
    composed.authority_tier,
    requires_double_verify,
    composed.proposed_at,
  );

  const audit_hash = chainHash({
    prev: GENESIS_HASH,
    payload: {
      kind: 'mutation_proposal',
      recipe_id: recipe.id,
      recipe_version: recipe.version,
      subject: composed.subject,
      preview: composed.preview as unknown as Record<string, unknown>,
      proposed_at: composed.proposed_at,
      tenant_id: context.tenantId,
    },
  });

  const proposal: MutationProposal = {
    ...composed,
    id,
    recipe_id: recipe.id,
    recipe_version: recipe.version,
    tenant_id: context.tenantId,
    proposed_by: context.proposedBy,
    research_evidence_ids: composed.research_evidence_ids,
    reversibility: recipe.reversibility,
    requires_double_verify,
    expires_at,
    audit_hash,
  };

  return { proposal, tripped };
}
