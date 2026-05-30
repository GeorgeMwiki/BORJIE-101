/**
 * @borjie/conversation-feel — Public API
 *
 * Foundational layer ported verbatim from LitFin src/core/conversation-feel.
 * The guards (anti-pattern stripper, position-taker, sycophancy-detector,
 * brevity-guard, honest-uncertainty, continuity, specificity, rhythm,
 * wit-allowance, pre-send-audit) live in LitFin under guards/ continuity/
 * style-audit/ subdirs and depend on local helpers; this package ships the
 * types + hash-chained audit log so any Borjie agent surface can append
 * interventions and verify the chain without re-implementing the kernel.
 *
 * Borjie agents (Mr. Mwikila persona, copilots, junior agents) wire their
 * own guard implementations against these types — keeps the package
 * dependency-free while preserving the contract.
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
  BorjiePortal,
} from "./types";

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
