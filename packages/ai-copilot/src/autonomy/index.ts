/**
 * Autonomy subtree — Wave-13 Autonomous Department Mode public surface.
 *
 * Everything the gateway, UI, and tests need to wire Autonomous
 * Department Mode is re-exported from here. Internal helpers stay in
 * their module-private files.
 */

export * from './types.js';
export { buildDefaultPolicy, DELEGATION_MATRIX_DIMENSIONS } from './defaults.js';
export {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
} from './autonomy-policy-service.js';
export type { AutonomyPolicyServiceDeps } from './autonomy-policy-service.js';
export {
  ExceptionInbox,
  InMemoryExceptionRepository,
  scorePriority,
} from './exception-inbox.js';
export type {
  Exception,
  ExceptionPriority,
  ExceptionStatus,
  ExceptionRepository,
  AddExceptionInput,
  ListOpenFilters,
  ResolveInput,
  EvidenceRef,
} from './exception-inbox.js';
export {
  ExecutiveBriefingGenerator,
  InMemoryBriefingRepository,
  EXECUTIVE_BRIEFING_SCHEDULE,
} from './briefing-generator.js';
export type {
  BriefingCadence,
  BriefingInputs,
  BriefingRepository,
  GeneratedBriefing,
  PortfolioHealth,
  BriefingWin,
  StrategicRecommendation,
} from './briefing-generator.js';
export {
  StrategicAdvisor,
  CANONICAL_QUESTION_KEYS,
} from './strategic-advisor.js';
export type {
  AdviseContext,
  DecisionOption,
  DecisionReport,
  CanonicalQuestionKey,
} from './strategic-advisor.js';
export {
  AutonomousActionAudit,
  InMemoryAutonomousActionAuditRepository,
} from './autonomous-action-audit.js';
export type {
  AuditDomain,
  AuditEvidenceRef,
  AutonomousActionRecord,
  AutonomousActionAuditRepository,
  ListAuditFilters,
  RecordActionInput,
} from './autonomous-action-audit.js';
export {
  ONBOARDING_STEPS,
  ONBOARDING_STEP_ORDER,
  ONBOARDING_STEPS_TOTAL,
  derivePolicy,
  next,
  startOnboarding,
} from './onboarding-flow.js';
export { withAutonomyGuard } from './guard.js';
export type {
  AutonomyGuardContext,
  AutonomyGuardFn,
  AutonomyActionThunk,
  GuardResult,
  WithAutonomyGuardDeps,
  OnApprovalRequiredFn,
  OnApprovalRequiredInput,
} from './guard.js';
export type {
  OnboardingAdvance,
  OnboardingAnswer,
  OnboardingState,
  OnboardingStepDefinition,
  OnboardingStepId,
} from './onboarding-flow.js';
