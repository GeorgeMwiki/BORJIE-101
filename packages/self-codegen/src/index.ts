/**
 * @borjie/self-codegen — Phase N-B Self-Code-Writing Harness.
 *
 * Hard NEVERS:
 *   1. NEVER `bypassPermissions` (enforced in opus-parity-config).
 *   2. NEVER let brain modify its own production runtime (deny-globs cover
 *      `.claude/**` and `packages/self-codegen/**`).
 *   3. NEVER skip dual-human approval on CODEOWNER globs (enforced via
 *      generateRequiredReviewerRuleset + three-layer-review Layer 3).
 */

// Module 1 — Plan/Execute split
export {
  runSelfCodegenTask,
  type SelfCodegenAdapters,
} from './plan-execute-split/run-self-codegen-task.js';
export {
  createReadOnlyContext,
  runPlanPhase,
  isReadOnlyBashCommand,
  assertPlanPhaseToolAllowed,
  type PlanPhaseFn,
} from './plan-execute-split/plan-phase.js';
export {
  createWriteContext,
  runExecutePhase,
  pathMatchesAllowedGlobs,
  globToRegex,
  type ExecutorFn,
} from './plan-execute-split/execute-phase.js';
export {
  PlanPhaseReadOnlyViolation,
  type EditableSpec,
  type ExecutionResult,
  type ReadOnlyContext,
  type WriteContext,
  type ReflectionResult,
  type SelfCodegenTaskRequest,
  type SelfCodegenResult,
} from './plan-execute-split/types.js';

// Module 2 — Worktree+Daytona sandbox
export {
  createSandbox,
  withSandbox,
  defaultGitAdapter,
  AggregateCleanupError,
  SandboxAlreadyCleanedError,
  type Sandbox,
  type SandboxRequest,
  type GitWorktreeAdapter,
  type DaytonaAdapter,
  type CreateSandboxDeps,
} from './worktree-sandbox/index.js';

// Module 3 — PreToolUse hooks
export {
  createSelfCodegenHook,
  asClaudeAgentSdkHook,
  DEFAULT_DENY_GLOBS,
  DEFAULT_INSPECTED_TOOLS,
  globToMatcher,
  anyGlobMatches,
  type PreToolUseHook,
  type PreToolUseDecision,
  type SelfCodegenHookConfig,
} from './pre-tool-use-hooks/index.js';

// Module 4 — Three-layer review
export {
  InlineSubagentReviewer,
  CodeRabbitClassReviewer,
  MockDiffReviewer,
  UltrareviewReviewer,
  combineVerdicts,
  runThreeLayerReview,
  classifyFindings,
  type ICodeReviewer,
  type ReviewVerdict,
  type ReviewFinding,
  type ReviewInput,
  type InlineSubagentRunner,
  type DiffReviewerCall,
  type UltrareviewArgs,
} from './three-layer-review/index.js';

// Module 5 — CODEOWNERS templating
export {
  generateCodeownersFile,
  generateRequiredReviewerRuleset,
  loadCodeownersConfigFromYml,
  DEFAULT_BORJIE_CODEOWNERS_YML,
  type CodeownersConfig,
  type CodeownerRuleSet,
  type RequiredReviewerRuleset,
  type RequiredReviewerRule,
} from './codeowners-templating/index.js';

// Module 6 — Multi-agent Reflexion
export {
  runReflexionRound,
  combineCriticVerdicts,
  DEFAULT_CRITICS,
  CRITIC_SYSTEM_PROMPTS,
  type CriticName,
  type CriticVerdict,
  type ReflexionRoundRequest,
} from './multi-agent-reflexion/index.js';
// re-export the ReflexionResult from module 6 under a non-conflicting alias
export { type ReflexionResult as MultiAgentReflexionResult } from './multi-agent-reflexion/types.js';

// Module 7 — Skill emit on success
export {
  proposeSkill,
  promoteSkill,
  slugify,
  type SkillProposal,
  type SkillProposalInput,
  type PromotionDecision,
} from './skill-emit-on-success/index.js';

// Module 8 — Post-tool audit hook
export {
  createAuditHook,
  buildEntry,
  isAuditedTool,
  MockSlackSink,
  MockSovereignLedgerSink,
  type ForensicEntry,
  type AuditedOp,
  type PostToolUseInput,
  type SovereignLedgerSink,
  type SlackSink,
  type CreateAuditHookArgs,
  type PostToolUseHook,
} from './post-tool-audit-hook/index.js';

// Module 9 — Opus-parity config
export {
  OpusParityConfigViolation,
  validateOpusParityConfig,
  capTaskBudget,
  DEFAULT_TASK_BUDGET_CENTS,
  PLAN_PHASE_CONFIG,
  EXECUTE_PHASE_CONFIG,
  ULTRAREVIEW_CONFIG,
  type OpusParityConfig,
  type SafePermissionMode,
  type ModelId,
} from './opus-parity-config/index.js';
