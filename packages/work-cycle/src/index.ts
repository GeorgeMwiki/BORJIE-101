/**
 * `@borjie/work-cycle` — public surface.
 *
 * Mr. Mwikila's continuous 24/7 work loop (Wave M1). The package that
 * gives the AI Mining Operations Manager a heartbeat: cadence
 * selection, policy-gated tool calls, hash-chained journal,
 * deterministic resumption brief, per-tenant night $-cap. Spec:
 * docs/DESIGN/CONTINUOUS_24_7_WORK_CYCLE_SPEC.md.
 *
 * Composition root (host wires the deps):
 *
 *   const scheduler   = createTickScheduler();
 *   const journalRepo = createInMemoryJournalRepository();   // or SQL
 *   const stateRepo   = createInMemoryStateRepository();     // or SQL
 *   const budgetGate  = createBudgetGate({ ledger: ... });
 *   const policyGate  = createDefaultPolicyGate({ nightAllowlist: [...] });
 *   const qualityGate = createPassThroughQualityGate();      // or your impl
 *   const memoryPort  = createNullMemoryPort();              // or cognitive-memory wired
 *   const runner = createTickRunner({
 *     policyGate, toolBag, qualityGate,
 *     journalRepo, stateRepo, memoryPort, budgetGate, logger
 *   });
 *   const buildBrief = createBuildResumptionBrief({ journalRepo, stateRepo });
 *
 * Every operation is auditable: the runner writes a JournalEntry per
 * tick, hash-chained against the prior entry's audit_hash.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export {
  WORK_CYCLE_MODES,
  DEFAULT_CADENCE_MS,
  MUTATION_TIERS,
  WorkCycleError,
  noopLogger,
  type WorkCycleMode,
  type TickInput,
  type TickOutput,
  type WorkCycleTick,
  type JournalEntry,
  type WorkCycleState,
  type ResumptionBrief,
  type MutationTier,
  type WorkCycleLogger,
} from './types.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export {
  computeJournalHash,
  GENESIS_HASH,
  type JournalHashPayload,
} from './audit/hash-chain.js';

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
export {
  createTickScheduler,
  type TickScheduler,
  type SchedulerOptions,
} from './scheduler/tick-scheduler.js';

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
export {
  createInMemoryJournalRepository,
  createSqlJournalRepository,
  type JournalRepository,
  type JournalSqlDriver,
  type AppendJournalInput,
} from './journal/journal-repository.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export {
  createInMemoryStateRepository,
  createSqlStateRepository,
  type StateRepository,
  type StateSqlDriver,
} from './state/state-repository.js';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------
export {
  createBudgetGate,
  createInMemoryBudgetLedger,
  capForMode,
  DEFAULT_BUDGET_CAPS,
  type BudgetGate,
  type BudgetCaps,
  type BudgetLedger,
  type BudgetDecision,
} from './budget/night-budget.js';

// ---------------------------------------------------------------------------
// Tick — ports + runner
// ---------------------------------------------------------------------------
export {
  createDefaultPolicyGate,
  createPassThroughQualityGate,
  createNullMemoryPort,
  type PolicyGate,
  type PolicyDecision,
  type PolicyGateOptions,
  type ToolBag,
  type ToolInvocation,
  type QualityGate,
  type QualityVerdict,
  type MemoryPort,
} from './tick/ports.js';

export {
  createTickRunner,
  type TickRunner,
  type TickRunnerDeps,
} from './tick/tick-runner.js';

// ---------------------------------------------------------------------------
// Resumption
// ---------------------------------------------------------------------------
export {
  createBuildResumptionBrief,
  assertNoJuniorLeak,
  CHARS_PER_TOKEN,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_MAX_ENTRIES,
  type BuildResumptionBrief,
  type BuildBriefArgs,
  type ResumptionBriefFn,
} from './resumption/resumption-brief.js';
