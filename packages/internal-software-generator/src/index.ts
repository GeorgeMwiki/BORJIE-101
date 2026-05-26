/**
 * `@borjie/internal-software-generator` — public surface.
 *
 * Wave M8-M9. On-Demand Internal Software. The owner says "I want a
 * tool that scans worker shift logs for missed safety steps." Mr.
 * Mwikila generates a sealed bundle (form schema + handler descriptor
 * + dashboard archetype + audit hook), validates it against the
 * shape contract, persists it as `draft`, advances it through
 * `staged → live` (T2 tools require an owner-sign artifact), runs
 * it, and archives it.
 *
 * Spec: Docs/DESIGN/ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md.
 * Persona: Mr. Mwikila. Brand: Borjie.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AuthorityTier,
  DashboardArchetypeName,
  DraftTool,
  GenerateToolRequest,
  InternalTool,
  InternalToolRepository,
  RunToolRequest,
  ToolAuditHook,
  ToolFormField,
  ToolFormSchema,
  ToolHandlerDescriptor,
  ToolHandlerPort,
  ToolKind,
  ToolLifecycle,
  ToolRun,
  ToolRunRepository,
  ToolSpec,
} from './types.js';

export { INTERNAL_TOOL_CONSTANTS } from './types.js';

// ---------------------------------------------------------------------------
// Spec validation
// ---------------------------------------------------------------------------

export {
  validateToolSpec,
  assertValidToolSpec,
  type SpecValidationResult,
} from './spec/spec-validator.js';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export {
  canTransition,
  requiresOwnerSign,
  isRunnable,
  type TransitionAttempt,
  type TransitionResult,
} from './lifecycle/tool-lifecycle.js';

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export {
  heuristicSpecGenerator,
  type SpecGeneratorPort,
} from './generator/spec-generator.js';

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export {
  createToolRunner,
  ToolRunnerError,
  type ToolRunnerDeps,
  type ToolRunnerErrorCode,
} from './runner/tool-runner.js';

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export {
  createInMemoryInternalToolRepository,
  summariseKinds,
} from './repositories/internal-tool.js';
export { createInMemoryToolRunRepository } from './repositories/tool-run.js';

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export {
  computeToolAuditHash,
  GENESIS_HASH,
} from './audit/audit-chain-link.js';
