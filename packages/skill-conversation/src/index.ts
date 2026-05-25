/**
 * @borjie/skill-conversation
 *
 * Phase J6 chat-handoff substrate for **owner-as-programmer-by-conversation**.
 * Owner-customer or internal-admin says in chat what they want done, and the
 * MD compiles the natural-language SOP into a deployed Skill + cron + monitor
 * + hook chain via @borjie/aop-compiler — gated by a deterministic
 * intent classifier that demands explicit confirmation for anything
 * recurring/conditional.
 *
 * Public surface (the only entry points consumers should rely on):
 *
 *   classifyIntent          NL → IntentVerdict (deterministic)
 *   evaluateConfirmation    decide approve/reject/ambiguous from a chat reply
 *   compileSkillFromNL      NL → SkillRegistryEntry (via aop-compiler)
 *   InMemorySkillRegistry   test/demo storage adapter for SkillRegistry
 *   getSkillStatus          load an entry from the registry
 *   pauseSkill / resumeSkill / deleteSkill   lifecycle transitions
 *   recordRun               append a run event to the entry's history
 *   summariseEntry / summariseList / buildLifecycleAck   chat prose helpers
 *   policyFor / validateScopeArgs / isPlatformWide   scope helpers
 */

// Types
export type {
  AutonomyValidator,
  CompileSkillFailure,
  CompileSkillResult,
  CompileSkillSuccess,
  CompileFailure,
  CompileSuccess,
  ConfirmationPrompt,
  ConversationAnchor,
  IntentKind,
  IntentVerdict,
  SkillLifecycle,
  SkillRegistry,
  SkillRegistryEntry,
  SkillScope,
  SkillStatusEvent,
  ValidationError,
} from './types.js';

// Intent
export {
  classifyIntent,
  evaluateConfirmation,
  extractSignals,
  type ClassifyOptions,
  type Signal,
  type SignalKind,
} from './intent/index.js';

// Compile
export {
  compileSkillFromNL,
  validateScopePolicy,
  buildChatConfirmation,
  buildChatRejection,
  summariseNextRun,
  SCOPE_POLICY,
  type CompileSkillFromNLArgs,
  type CompileSkillInternalOptions,
} from './compile/index.js';

// Registry
export { InMemorySkillRegistry } from './registry/index.js';

// Status loop
export {
  getSkillStatus,
  pauseSkill,
  resumeSkill,
  deleteSkill,
  recordRun,
  summariseEntry,
  summariseList,
  buildLifecycleAck,
  SkillNotFoundError,
  SkillLifecycleError,
  type PauseSkillArgs,
} from './status/index.js';

// Scope
export {
  policyFor,
  validateScopeArgs,
  isPlatformWide,
  type ScopePolicy,
} from './scope/index.js';
