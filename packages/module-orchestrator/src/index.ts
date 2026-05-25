/**
 * @borjie/module-orchestrator — Piece B module lifecycle.
 *
 * Coordinates:
 *   - lifecycle state machine (DRAFT → PROPOSED → APPROVED → LIVE
 *     → DEPRECATED → ARCHIVED)
 *   - spawn-from-template path (clone built-in default spec)
 *   - spawn-from-prompt path (LLM-emitted candidate, validated + compiled)
 *   - K5-gated migration apply
 *
 * Public surface is small. The api-gateway wires real ports against
 * Drizzle + the migration runner.
 */

export {
  MODULE_LIFECYCLE_STATES,
  type ModuleLifecycleState,
  canTransition,
  reachableStates,
  isTerminal,
  type LifecycleTransitionRequest,
  type LifecycleTransitionResult,
} from './lifecycle.js';

export {
  spawnModuleFromTemplate,
  spawnModuleFromPrompt,
  type SpawnFromTemplateInput,
  type SpawnFromPromptInput,
  type SpawnResult,
} from './spawn.js';

export {
  applyModuleSpec,
  type ApplyModuleSpecInput,
  type ApplyModuleSpecResult,
} from './apply.js';

export type {
  OrchestratorDeps,
  ModulesStorePort,
  ModuleSpecsStorePort,
  ModuleTemplatesStorePort,
  MigrationApplyPort,
  ApprovalPort,
  IdGenPort,
  ModuleRowSummary,
} from './ports.js';
