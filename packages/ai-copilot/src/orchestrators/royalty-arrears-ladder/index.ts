/**
 * Arrears-ladder orchestrator — barrel.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

export {
  RoyaltyArrearsLadderOrchestrator,
  RoyaltyArrearsLadderAlreadyCompletedError,
  RoyaltyArrearsLadderRunNotFoundError,
  RoyaltyArrearsLadderStepNotGatedError,
} from './orchestrator-service.js';

export type {
  ApproveStepInput,
  RoyaltyArrearsLadderOrchestratorDeps,
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

export { ROYALTY_ARREARS_LADDER_STEPS } from './types.js';
