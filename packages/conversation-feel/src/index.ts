/**
 * @borjie/conversation-feel — Public API
 *
 * Foundational layer ported verbatim from sibling-port src/core/conversation-feel.
 * The guards (anti-pattern stripper, position-taker, sycophancy-detector,
 * brevity-guard, honest-uncertainty, continuity, specificity, rhythm,
 * wit-allowance, pre-send-audit) live in sibling-port under guards/ continuity/
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

// Pure guard functions (anti-pattern stripper, sycophancy, brevity,
// position-taking, honest-uncertainty, rhythm). LP-24a.
export {
  stripChatbotFeel,
  shouldRequestRegen,
  checkSycophancy,
  extractAssertion,
  expressesAgreement,
  findContradiction,
  checkBrevity,
  countWords,
  countBullets,
  isJustifiedLength,
  inferTurnKind,
  checkPosition,
  userAskedForOpinion,
  countHedges,
  takesPosition,
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
  analyzeRhythm,
  rhythmInjection,
  type UserAssertion,
  type ContradictoryEvidence,
  type SycophancyCheck,
  type BrevityCheck,
  type PositionCheck,
  type HonestUncertaintyInput,
  type HonestUncertaintyResult,
} from "./guards/index";
