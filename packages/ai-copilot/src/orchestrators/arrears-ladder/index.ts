/**
 * Arrears-ladder orchestrator — barrel.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

export {
  ArrearsLadderOrchestrator,
  ArrearsLadderAlreadyCompletedError,
  ArrearsLadderRunNotFoundError,
  ArrearsLadderStepNotGatedError,
} from './orchestrator-service.js';

export type {
  ApproveStepInput,
  ArrearsLadderOrchestratorDeps,
  AutonomyPolicyPort,
  Decision,
  EscalationPort,
  EventPort,
  NoticeDispatchPort,
  OrchestratorLogger,
  PaymentLookupPort,
  RunState,
  RunStatus,
  RunStorePort,
  SettlementPort,
  Step,
  StepRecord,
  Trigger,
  TriggerRunInput,
  TriggerRunResult,
  WriteOffPort,
} from './types.js';

export { ARREARS_LADDER_STEPS } from './types.js';
