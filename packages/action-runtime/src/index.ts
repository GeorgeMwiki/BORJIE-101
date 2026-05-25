/**
 * @borjie/action-runtime — Piece E of the BORJIE master plan.
 *
 * Public surface:
 *
 *   types                — Zod schemas + TS types for ActionPlan / ActionStep / etc.
 *   compile              — Brain Decision → ActionPlan compiler (pure)
 *   preconditions        — Per-step preconditions checked at execute time
 *   step-handlers        — One handler per step kind (factories + registry builder)
 *   compensation-registry — Forward-only reversal handlers per kind
 *   audit-chain          — Hash-chained audit-row writer port + in-memory impl
 *   saga                 — Forward execution + reverse compensation orchestrator
 *   budget-defaults      — Per-kind micro-USD cost constants
 */

// ── Types ────────────────────────────────────────────────────────────
export {
  PLAN_STATUSES,
  PlanStatusSchema,
  STEP_STATUSES,
  StepStatusSchema,
  STEP_KINDS,
  StepKindSchema,
  PRECONDITION_KINDS,
  PreconditionSchema,
  CompensationSpecSchema,
  ActionStepSchema,
  ActionPlanSchema,
  ActionRuntimeError,
} from './types.js';
export type {
  PlanStatus,
  StepStatus,
  StepKind,
  Precondition,
  CompensationSpec,
  ActionStep,
  ActionPlan,
  PersistedActionPlan,
  PersistedActionStep,
  ActionQuotaState,
  ActionRuntimeErrorCode,
} from './types.js';

// ── Compile ──────────────────────────────────────────────────────────
export { compile } from './compile.js';
export type { CompileInput, CompileInputStep } from './compile.js';

// ── Budget ───────────────────────────────────────────────────────────
export {
  STEP_BUDGET_DEFAULTS_MICROS,
  MICRO_USD_PER_USD,
  DEFAULT_DAILY_PLAN_LIMIT,
  DEFAULT_DAILY_MONEY_CAP_MICROS,
  defaultBudgetForPlan,
} from './budget-defaults.js';

// ── Preconditions ────────────────────────────────────────────────────
export {
  evaluatePreconditions,
  createPermissivePreconditionPorts,
} from './preconditions.js';
export type {
  PreconditionPorts,
  PreconditionContext,
  PreconditionResult,
} from './preconditions.js';

// ── Step handlers ────────────────────────────────────────────────────
export {
  buildStepHandlerRegistry,
} from './step-handlers/index.js';
export type {
  StepHandler,
  StepHandlerContext,
  StepHandlerResult,
  StepHandlerRegistry,
  StepHandlerPorts,
} from './step-handlers/index.js';

// ── Per-kind factories (so tests can stub one and let the registry mix) ──
export {
  makeDraftLetterHandler,
} from './step-handlers/draft-letter.js';
export {
  makeRouteApprovalHandler,
} from './step-handlers/route-approval.js';
export {
  makePostLedgerHandler,
} from './step-handlers/post-ledger.js';
export {
  makeFileGepgHandler,
} from './step-handlers/file-gepg.js';
export {
  makeSendWhatsappHandler,
} from './step-handlers/send-whatsapp.js';
export {
  makeSendSmsHandler,
} from './step-handlers/send-sms.js';
export {
  makeSendEmailHandler,
} from './step-handlers/send-email.js';
export {
  makeScheduleFieldVisitHandler,
} from './step-handlers/schedule-field-visit.js';
export {
  makeMutateEntityHandler,
} from './step-handlers/mutate-entity.js';
export {
  makeCallExternalApiHandler,
} from './step-handlers/call-external-api.js';
export {
  makeEmitWebhookHandler,
} from './step-handlers/emit-webhook.js';
export {
  makeNotifyHandler,
} from './step-handlers/notify.js';
export {
  makeVerifyHandler,
} from './step-handlers/verify.js';
export {
  makeCompensateHandler,
} from './step-handlers/compensate.js';

// ── Compensation registry ────────────────────────────────────────────
export {
  buildCompensationRegistry,
} from './compensation-registry.js';
export type {
  CompensationHandler,
  CompensationRegistry,
  CompensationContext,
  CompensationResult,
  BuildCompensationRegistryDeps,
} from './compensation-registry.js';

// ── Audit chain ──────────────────────────────────────────────────────
export {
  GENESIS_HASH,
  computeAuditHash,
  createInMemoryAuditChain,
} from './audit-chain.js';
export type {
  AuditChainRow,
  AuditChainWriter,
  InMemoryAuditChain,
} from './audit-chain.js';

// ── Saga ─────────────────────────────────────────────────────────────
export { executePlan } from './saga.js';
export type {
  ExecutePlanArgs,
  ExecutePlanResult,
  SagaConfig,
  SagaPersistencePort,
} from './saga.js';

// ── Port surfaces ────────────────────────────────────────────────────
export type {
  ReportEnginePort,
  ApprovalRouterPort,
  LedgerPort,
  GepgPort,
  NotificationsPort,
  SchedulingPort,
  EntityPort,
  ExternalApiPort,
  WebhookPort,
  VerifyPort,
} from './step-handlers/ports.js';
