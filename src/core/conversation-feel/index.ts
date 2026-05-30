/**
 * Conversation-feel layer — public surface.
 *
 * Subscribe (do not modify) the producers. Apply guards on every
 * assistant response via `runPreSendAudit` before the user sees it.
 */

export type {
  ChatbotFeelPattern,
  ConversationContext,
  GuardIntervention,
  GuardOutcome,
  RecentTurn,
  RemovedPhrase,
  RhythmScore,
  SessionStats,
  StrippedResponse,
  TurnKind,
  UserFact,
} from "./types";

export {
  shouldRequestRegen,
  stripChatbotFeel,
} from "./guards/anti-pattern-stripper";
export {
  countHedges,
  checkPosition,
  takesPosition,
  userAskedForOpinion,
} from "./guards/position-taker";
export {
  checkSycophancy,
  expressesAgreement,
  extractAssertion,
  findContradiction,
} from "./guards/sycophancy-detector";
export {
  checkBrevity,
  countBullets,
  countWords,
  inferTurnKind,
  isJustifiedLength,
} from "./guards/brevity-guard";
export {
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
} from "./guards/honest-uncertainty";

export {
  checkContinuity,
  recordFact,
  openThread,
} from "./continuity/continuity-enforcer";
export type {
  ContinuityCheck,
  ContinuitySessionState,
} from "./continuity/continuity-enforcer";
export {
  checkSpecificity,
  extractSpecifics,
} from "./continuity/specificity-enforcer";

export { analyzeRhythm, rhythmInjection } from "./style-audit/rhythm-analyzer";
export { decideWit, witInjection } from "./style-audit/wit-allowance";
export type { WitDecision } from "./style-audit/wit-allowance";
export { runPreSendAudit } from "./style-audit/pre-send-audit";
export type { AuditOptions, AuditResult } from "./style-audit/pre-send-audit";

export {
  appendIntervention,
  listInterventions,
  verifyChain,
  setSessionStats,
  getSessionStats,
  getAllSessionStats,
  aggregateChatbotFeelScore,
  _resetAuditLog,
} from "./audit-log";
