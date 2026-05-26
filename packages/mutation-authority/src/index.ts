/**
 * `@borjie/mutation-authority` — public surface.
 *
 * Mutation authority scaffold per
 * `Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md` (Wave 18S). Provides:
 *
 *   - Recipe registry (UI / data / document / action classes).
 *   - Proposal builder (wraps `recipe.compose(ctx)` with runtime
 *     invariants: tier-driven expiry, double-verify triggers, audit
 *     hash binding).
 *   - Approval workflow (state machine: pending → approved_primary →
 *     approved_full | rejected | expired) + DoubleVerifyGuard for
 *     Tier 2-Critical.
 *   - Executor (refuses to run without the two-operator gate; emits a
 *     `MutationResult`).
 *   - Rollback (for fully-reversible mutations only).
 *   - Audit-chain link (proposal + approvals + result hash chain).
 *
 * No I/O — every layer is dependency-injected with a repository
 * interface. Production wiring lives in `@borjie/database` and binds
 * Drizzle-backed implementations.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  ApprovalDecision,
  ApprovalRecord,
  ApproverRole,
  AuthorityTier,
  CitationContract,
  MutationClass,
  MutationComposeContext,
  MutationPreview,
  MutationProposal,
  MutationRecipe,
  MutationResult,
  MutationSubject,
  ProposalStatus,
  RecipeStatus,
  Reversibility,
} from './types.js';

export {
  BULK_DELETE_ROW_THRESHOLD,
  DEFAULT_FUNDS_THRESHOLD_CENTS,
  DOUBLE_VERIFY_COOLDOWN_MS,
  EXPIRY_MS_BY_TIER,
  REJECTION_COOLDOWN_MS,
} from './types.js';

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

export { MutationRecipeRegistry } from './recipes/registry.js';

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export {
  buildProposal,
  type BuildProposalResult,
  type DoubleVerifyTrigger,
  type ProposalBuilderArgs,
} from './proposals/proposal-builder.js';

export {
  createInMemoryProposalRepository,
  type ProposalRepository,
} from './proposals/proposal-repository.js';

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export {
  applyEvent,
  type ApplyEventArgs,
  type WorkflowEvent,
  type WorkflowOutcome,
} from './approvals/approval-workflow.js';

export {
  checkDoubleVerify,
  type DoubleVerifyVerdict,
} from './approvals/double-verify-guard.js';

export {
  createInMemoryApprovalRepository,
  type ApprovalRepository,
} from './approvals/approval-repository.js';

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export {
  executeMutation,
  type ExecutionOutcome,
  type ExecutorArgs,
} from './execution/executor.js';

export {
  createInMemoryHistoryRepository,
  type HistoryRepository,
} from './execution/history-repository.js';

export {
  rollbackMutation,
  type RollbackArgs,
  type RollbackOutcome,
} from './execution/rollback.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  appendMutationAudit,
  type MutationAuditEvent,
} from './audit/audit-chain-link.js';
