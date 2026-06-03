/**
 * Conversation-feel guards barrel.
 *
 * Each guard is a pure function (no I/O, no mutation) that inspects a
 * candidate response (and optional context) and reports an intervention
 * or a regen instruction. Borjie agent surfaces compose these against
 * the shared types and append outcomes to the hash-chained audit log.
 */

export {
  stripChatbotFeel,
  shouldRequestRegen,
} from "./anti-pattern-stripper";

export {
  checkSycophancy,
  extractAssertion,
  expressesAgreement,
  findContradiction,
  type UserAssertion,
  type ContradictoryEvidence,
  type SycophancyCheck,
} from "./sycophancy-detector";

export {
  checkBrevity,
  countWords,
  countBullets,
  isJustifiedLength,
  inferTurnKind,
  type BrevityCheck,
} from "./brevity-guard";

export {
  checkPosition,
  userAskedForOpinion,
  countHedges,
  takesPosition,
  type PositionCheck,
} from "./position-taker";

export {
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
  type HonestUncertaintyInput,
  type HonestUncertaintyResult,
} from "./honest-uncertainty";

export {
  analyzeRhythm,
  rhythmInjection,
} from "./rhythm-analyzer";
