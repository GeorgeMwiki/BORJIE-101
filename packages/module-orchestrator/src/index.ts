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

// ─────────────────────────────────────────────────────────────────────
// Pass 2 — the ddl-guard security wall on the PUBLIC surface. The
// api-gateway executor imports these to re-validate + RLS-force-verify
// the stored migration before it ever touches the tenant DB, and to gate
// the apply behind the four-eye approval record. The compiler emits NO
// RLS; the orchestrator owns it via these helpers.
// ─────────────────────────────────────────────────────────────────────
export {
  validateGeneratedDdl,
  type ValidateGeneratedDdlInput,
  type ValidateGeneratedDdlResult,
  buildCanonicalRlsBlock,
  verifyRlsForced,
  type RlsVerifyResult,
  TENANT_GUC,
  SERVICE_ROLE_GUC,
  assertApplyApproved,
  MODULE_SPAWN_TOOL_NAMES,
  type FourEyeApprovalView,
  type AssertApplyApprovedInput,
  type AssertApplyApprovedResult,
  canonicalTenantTablePrefix,
  isTenantNamespacedTable,
  assertTenantIdShape,
  exceedsPgIdentifierLimit,
  PG_IDENTIFIER_MAX_BYTES,
} from './ddl-guard/index.js';
