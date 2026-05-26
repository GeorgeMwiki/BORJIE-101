/**
 * `@borjie/mutation-authority` — shared types.
 *
 * The contract from `docs/DESIGN/MUTATION_AUTHORITY_SPEC.md` (Wave 18S).
 * Four classes (ui | data | document | action), three authority tiers
 * (0 | 1 | 2) plus the Tier 2-Critical subset, and the proposal /
 * approval / result / audit pipeline that ties them together.
 *
 * All types are `readonly` to satisfy the project's immutability rule
 * (see `~/.claude/rules/coding-style.md`). Construction helpers in
 * sibling modules always return fresh objects.
 */

// ---------------------------------------------------------------------------
// Mutation class + authority tier
// ---------------------------------------------------------------------------

export type MutationClass = 'ui' | 'data' | 'document' | 'action';

export type AuthorityTier = 0 | 1 | 2;

export type Reversibility = 'fully' | 'partial' | 'irreversible';

export type RecipeStatus =
  | 'draft'
  | 'shadow'
  | 'live'
  | 'locked'
  | 'deprecated';

export type ProposalStatus =
  | 'pending'
  | 'approved_primary'
  | 'approved_full'
  | 'rejected'
  | 'executed'
  | 'aborted'
  | 'expired';

export type ApprovalDecision = 'approved' | 'rejected';
export type ApproverRole = 'owner' | 'second_authoriser';

// ---------------------------------------------------------------------------
// Subject + preview + citation
// ---------------------------------------------------------------------------

export interface MutationSubject {
  readonly kind: string;
  readonly id: string;
}

/**
 * Preview is intentionally open — each recipe owns its own diff
 * encoding. The runtime only enforces the authority + audit invariants.
 */
export interface MutationPreview {
  readonly summary: string;
  readonly current: unknown;
  readonly proposed: unknown;
  readonly impactNotes?: string;
}

export interface CitationContract {
  readonly source: string;
  readonly anchor: string;
}

// ---------------------------------------------------------------------------
// Compose context — passed to recipe.compose()
// ---------------------------------------------------------------------------

export interface MutationComposeContext {
  readonly tenantId: string;
  readonly subject: MutationSubject;
  readonly proposedBy: 'mr_mwikila' | 'owner_explicit';
  readonly researchEvidenceIds: ReadonlyArray<string>;
  readonly nowIso: string;
}

// ---------------------------------------------------------------------------
// Recipe
// ---------------------------------------------------------------------------

export interface MutationRecipe {
  readonly id: string;
  readonly class: MutationClass;
  readonly version: number;
  readonly status: RecipeStatus;
  readonly authority_tier: AuthorityTier;
  readonly is_critical: boolean;
  readonly compose: (ctx: MutationComposeContext) => Promise<MutationProposal>;
  readonly execute: (
    proposal: MutationProposal,
    approvals: ReadonlyArray<ApprovalRecord>,
  ) => Promise<MutationResult>;
  readonly required_citations: ReadonlyArray<CitationContract>;
  readonly reversibility: Reversibility;
  readonly brand: 'borjie';
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

export interface MutationProposal {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly tenant_id: string;
  readonly proposed_by: 'mr_mwikila' | 'owner_explicit';
  readonly proposed_at: string;
  readonly subject: MutationSubject;
  readonly preview: MutationPreview;
  readonly research_evidence_ids: ReadonlyArray<string>;
  readonly cost_or_value_at_stake_usd_cents: number;
  readonly reversibility: Reversibility;
  readonly authority_tier: AuthorityTier;
  readonly requires_double_verify: boolean;
  readonly expires_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface ApprovalRecord {
  readonly proposal_id: string;
  readonly approver_user_id: string;
  readonly approver_role: ApproverRole;
  readonly decision: ApprovalDecision;
  readonly reasoning: string;
  readonly decided_at: string;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface MutationResult {
  readonly proposal_id: string;
  readonly status: 'executed' | 'failed' | 'aborted';
  readonly executed_at: string;
  readonly rollback_token: string | null;
  readonly side_effects_summary: string;
  readonly downstream_artifacts: ReadonlyArray<MutationSubject>;
  readonly audit_hash: string;
}

// ---------------------------------------------------------------------------
// Tier-driven defaults
// ---------------------------------------------------------------------------

export const EXPIRY_MS_BY_TIER: Readonly<Record<string, number>> = Object.freeze(
  {
    tier_0: 0,
    tier_1: 24 * 60 * 60 * 1000,
    tier_2: 7 * 24 * 60 * 60 * 1000,
    tier_2_critical: 14 * 24 * 60 * 60 * 1000,
  },
);

export const DOUBLE_VERIFY_COOLDOWN_MS = 5 * 60 * 1000;

export const REJECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_FUNDS_THRESHOLD_CENTS = 50_000 * 100;

export const BULK_DELETE_ROW_THRESHOLD = 100;
