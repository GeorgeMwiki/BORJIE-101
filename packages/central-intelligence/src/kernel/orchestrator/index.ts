/**
 * Orchestrator substrate — public surface.
 *
 * Phase E.1 deliverable: Claude-Code-level main-loop + PreToolUse /
 * PostToolUse / Stop hook substrate + Plan tree + Budget + Memory tool
 * (Anthropic /memories) + Skill loader (Anthropic Agent Skills) + Batch
 * API wrapper.
 *
 * Coexists with the legacy 13-step pipeline in `kernel.ts`. Callers opt
 * in at composition by binding the orchestrator's `think()` instead of
 * the legacy `BrainKernel.think()`. Both surfaces share types like
 * `AwarenessTier`, `ScopeContext`, `Citation`, `Artifact`.
 */

// Main loop entry point.
export {
  think,
  thinkExtended,
  narrowToLegacyResponse,
  type OrchestratorRequest,
  type OrchestratorResponse,
  type OrchestratorResponseExtended,
  type OrchestratorDeps,
  type LLMRouter,
  type LLMRouterCall,
  type Dispatcher,
} from './main-loop.js';

// Decision ADT + dispatch result.
export {
  isBackgroundSpawn,
  type Decision,
  type DecisionToolCall,
  type DispatchResult,
  type SubMdSpawn,
  type ScheduleWake,
  type MonitorWatch,
  type SubMdModelClass,
  type SubMdEffort,
  type SubMdIsolation,
} from './decision.js';

// Budget primitives.
export {
  Budget,
  DEFAULT_MAX_TURNS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MAX_TOOL_CALLS,
  DEFAULT_MAX_WALL_MS,
  type BudgetLimits,
  type BudgetUsage,
  type BudgetSnapshot,
} from './budget.js';

// Hook chain.
export {
  createHookChain,
  type Hook,
  type HookChain,
  type HookContext,
  type HookResult,
  type HookStage,
  type ChatMessage,
  type PreToolUseHook,
  type PostToolUseHook,
  type StopHook,
  type SessionStartHook,
  type UserPromptSubmitHook,
  type PreCompactHook,
  type PostCompactHook,
  type SubagentStartHook,
  type SubagentStopHook,
  type StopSession,
  type ScopeFilter,
  type PreToolUseChainResult,
  type SessionStartPayload,
  type UserPromptPayload,
  type PreCompactPayload,
  type PostCompactPayload,
  type SubagentPayload,
} from './hook-chain.js';

// Plan tree.
export {
  createPlan,
  createEmptyPlan,
  createInMemoryPlanStore,
  type Plan,
  type PlanGoal,
  type PlanState,
  type PlanStore,
  type GoalStatus,
  type PlanRejection,
  type PlanAdvance,
} from './plan.js';

// Checkpoint + session store.
export {
  createInMemorySessionStore,
  type Checkpoint,
  type Session,
  type SessionStore,
  type TranscriptTurn,
} from './checkpoint.js';

// Context budget + ToolSearch.
export {
  createContextBudget,
  createInMemoryToolSearch,
  createEmbeddingToolSearch,
  DEFAULT_WINDOW_TOKENS,
  DEFAULT_COMPACT_RATIO,
  DEFAULT_KEEP_RECENT_TURNS,
  type ContextBudget,
  type ContextBudgetDeps,
  type CompactionOutcome,
  type TokenCounter,
  type ToolSearch,
  type ToolDescriptor,
  type EmbeddingToolSearchDeps,
} from './context-budget.js';

// Memory tool — Anthropic /memories wrapper (memory_20250818).
export {
  createInMemoryMemoryTool,
  safeMemoryPath,
  MemoryPathError,
  MemoryPreconditionError,
  type MemoryTool,
  type MemoryEntry,
  type MemoryRecallArgs,
  type MemoryRecallResult,
  type MemoryViewResult,
} from './memory-tool.js';

// Skill loader — Anthropic Agent Skills format.
export {
  parseSkillManifest,
  loadSkill,
  executeSkill,
  SkillManifestError,
  type SkillManifest,
  type SkillBundle,
  type SkillFileReader,
  type SkillExecutionDeps,
  type SkillExecutionResult,
} from './skill.js';

// Permission mode — Claude-Code parity operator switch.
export {
  evaluatePermissionMode,
  renderPlanModePreview,
  PERMISSION_MODES,
  type PermissionMode,
  type PermissionModeContext,
  type PermissionAction,
  type PermissionEvaluation,
  type PlanModePreviewInput,
} from './permission-mode.js';

// Batch API wrapper.
export {
  createBatchApi,
  createInMemoryBatchTransport,
  type BatchApi,
  type BatchHandle,
  type BatchJobRequest,
  type BatchJobResult,
  type BatchJobStatus,
  type BatchPollResult,
  type BatchTransport,
  type InMemoryBatchTransportDeps,
} from './batch-api.js';

// Pre-tool-use hooks.
export {
  createPiiScrubHook,
  type PiiScrubHookDeps,
  type PiiScrubberPort,
} from './hooks/pre-tool-use/pii-scrub-hook.js';
export {
  createPermissionHook,
  type PermissionHookDeps,
  type ToolScopePort,
} from './hooks/pre-tool-use/permission-hook.js';
export {
  createFourEyeHook,
  type FourEyeHookDeps,
  type ToolApprovalPolicyPort,
} from './hooks/pre-tool-use/four-eye-hook.js';
export {
  createToolDenylistHook,
  type ToolDenylistHookDeps,
  type ToolDenylistPort,
} from './hooks/pre-tool-use/tool-denylist-hook.js';
export {
  createRateLimitHook,
  createInMemoryRateLimitCounter,
  type RateLimitHookDeps,
  type RateLimitCounter,
} from './hooks/pre-tool-use/rate-limit-hook.js';
export {
  createCostCircuitHook,
  type CostCircuitHookDeps,
  type CostCircuitPort,
} from './hooks/pre-tool-use/cost-circuit-hook.js';
export {
  createSandboxDivertHook,
  type SandboxDivertHookDeps,
  type SandboxResolverPort,
} from './hooks/pre-tool-use/sandbox-divert-hook.js';

// Post-tool-use hooks.
export {
  createAuditEmissionHook,
  createInMemoryAuditEmissionSink,
  type AuditEmissionHookDeps,
  type AuditEmissionRow,
  type AuditEmissionSink,
  type InMemoryAuditEmissionSink,
} from './hooks/post-tool-use/audit-emission-hook.js';

// Stop hooks.
export {
  createLedgerSealHook,
  createInMemoryLedgerSeal,
  type LedgerSealHookDeps,
  type LedgerSealPort,
  type InMemoryLedgerSeal,
} from './hooks/stop/ledger-seal-hook.js';

// Phase F.2 — self-extension keystone. Detect recurring problems no
// existing sub-MD handles → propose new sub-MD spec → four-eye approve
// → compile + register + audit. Makes the MD's catalogue unbounded.
export {
  detectRecurringGap,
  proposeNewSubMd,
  compileAndDeploySubMd,
  type SelfExtensionDeps,
  type DetectRecurringGapOptions,
  type ActivityLogPort,
  type ActivityLogEntry,
  type SubMdRegistryPort,
  type RegistryReceipt,
  type LLMRouterPort as SelfExtensionLLMRouterPort,
  type OwnerApprovalPort,
  type OwnerApprovalDecision,
  type SelfExtensionLedgerPort,
  type RecurringGapDiagnosis,
  type SubMdSpec,
  type SubMdProposal,
  type DeploymentReceipt,
} from './self-extension.js';

// LATS — Language Agent Tree Search planner (alternative to ToT in
// search-planner.ts). UCB1 selection + value backprop with γ discount +
// self-reflection on failed sub-trees. See `lats-search.ts`.
export {
  latsSearch,
  ucb1Score,
  pickByUcb,
  backpropagate,
  DEFAULT_MAX_ITERATIONS as LATS_DEFAULT_MAX_ITERATIONS,
  DEFAULT_UCB_CONSTANT,
  DEFAULT_DISCOUNT,
  DEFAULT_REFLECTION_THRESHOLD,
  HARD_MAX_EXPANSIONS as LATS_HARD_MAX_EXPANSIONS,
  type LatsNode,
  type LatsOptions,
  type LatsResult,
  type LatsReflection,
  type LatsEvaluator,
  type LatsExpander,
} from './lats-search.js';

// Wave-13 — stakes-aware planner dispatcher. Routes the planning call
// to ToT for low/medium stakes (cheap, fast) and LATS for high/critical
// stakes (more iterations, value-backpropagated MCTS). Both planners
// share the `Evaluator` / `Expander` contracts so this is a thin shim.
// See `planner-dispatcher.ts`.
export {
  dispatchPlanner,
  pickPlannerForStakes,
  type DispatchPlannerOptions,
  type DispatchedPlanResult,
  type DispatchedPlannerKind,
  type PlannerStakes,
} from './planner-dispatcher.js';
