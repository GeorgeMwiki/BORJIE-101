/**
 * `@borjie/strategic-layer` — public surface.
 *
 * Wave M10–M12. The durable substrate for Mr. Mwikila's strategic-
 * direction loop. Operational Mr. Mwikila already exists (TRA filing,
 * price sweep, worker briefing); this layer answers "what should the
 * org actually be doing next quarter?" via:
 *
 *   - NorthStarObjective    — durable goal record (OKR-shaped) with
 *                             proposed/active/met/missed/retired state
 *                             machine. T2 transitions flow through
 *                             @borjie/mutation-authority.
 *   - ProgressTracker       — append-only observation log + drift signal.
 *   - PivotProposer         — drift-driven retarget / reframe / retire
 *                             recommendations (LLM-backed; T2 owner).
 *   - ConsentManager        — per-tenant opt-in for cognitive-memory
 *                             cross-tenant federation. Default deny;
 *                             scoped; expiring; prospective revocation.
 *   - EpsilonBudgetManager  — Rényi-DP composition + per-tenant per-
 *                             period (monthly) budget cap + idempotent
 *                             ledger.
 *
 * Spec: Docs/DESIGN/STRATEGIC_DIRECTION_LAYER_SPEC.md §15.
 * Persona: Mr. Mwikila (Managing Director). Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types — public type surface
// ---------------------------------------------------------------------------

export type {
  ChargeBudgetInput,
  ChargeBudgetResult,
  ConsentScope,
  ConsentStatus,
  CreateNorthStarInput,
  DriftSignal,
  EpsilonBudget,
  EpsilonBudgetsRepository,
  EpsilonLedgerEntry,
  EpsilonLedgerRepository,
  FederationConsent,
  FederationConsentsRepository,
  GrantConsentInput,
  InitialiseBudgetInput,
  NorthStar,
  NorthStarObjectivesRepository,
  ObjectiveProgress,
  ObjectiveProgressRepository,
  ObjectiveStatus,
  ObserveProgressInput,
  PivotProposal,
  PivotProposalsRepository,
  PivotShape,
  PivotStatus,
  ProposePivotInput,
  StrategicLogger,
  StrategicTelemetryConfig,
} from './types.js';

export {
  STRATEGIC_CONSTANTS,
  StrategicLayerError,
  EpsilonBudgetExhausted,
  ConsentDenied,
  InvalidStateTransition,
} from './types.js';

// ---------------------------------------------------------------------------
// Audit-chain link
// ---------------------------------------------------------------------------

export {
  computeStrategicAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';

// ---------------------------------------------------------------------------
// Objective manager
// ---------------------------------------------------------------------------

export {
  createObjectiveManager,
  type ObjectiveManager,
  type ObjectiveManagerDeps,
} from './objectives/objective-manager.js';

// ---------------------------------------------------------------------------
// Progress tracker
// ---------------------------------------------------------------------------

export {
  createProgressTracker,
  type ProgressTracker,
  type ProgressTrackerDeps,
} from './progress/progress-tracker.js';

// ---------------------------------------------------------------------------
// Pivot proposer
// ---------------------------------------------------------------------------

export {
  createPivotProposer,
  type PivotComposerPort,
  type PivotProposer,
  type PivotProposerDeps,
} from './pivot/pivot-proposer.js';

// ---------------------------------------------------------------------------
// Federation consent
// ---------------------------------------------------------------------------

export {
  createConsentManager,
  type ConsentManager,
  type ConsentManagerDeps,
} from './federation/consent-manager.js';

// ---------------------------------------------------------------------------
// Epsilon-budget manager
// ---------------------------------------------------------------------------

export {
  createEpsilonBudgetManager,
  type EpsilonBudgetManager,
  type EpsilonBudgetManagerDeps,
} from './budget/epsilon-budget.js';

// ---------------------------------------------------------------------------
// Repositories — in-memory + SQL adapters
// ---------------------------------------------------------------------------

export type { SqlRunner } from './repositories/sql-runner.js';

export {
  createInMemoryNorthStarObjectivesRepository,
  createSqlNorthStarObjectivesRepository,
} from './repositories/north-star-objectives-repository.js';

export {
  createInMemoryObjectiveProgressRepository,
  createSqlObjectiveProgressRepository,
} from './repositories/objective-progress-repository.js';

export {
  createInMemoryPivotProposalsRepository,
  createSqlPivotProposalsRepository,
} from './repositories/pivot-proposals-repository.js';

export {
  createInMemoryFederationConsentsRepository,
  createSqlFederationConsentsRepository,
} from './repositories/federation-consents-repository.js';

export {
  createInMemoryEpsilonBudgetsRepository,
  createSqlEpsilonBudgetsRepository,
} from './repositories/epsilon-budgets-repository.js';

export {
  createInMemoryEpsilonLedgerRepository,
  createSqlEpsilonLedgerRepository,
} from './repositories/epsilon-ledger-repository.js';
