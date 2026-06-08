/**
 * `@borjie/conversation-feel` — public surface.
 *
 * Runtime per-turn guards that keep Mr. Mwikila's chat replies honest,
 * concise, and decisive. Two entry points:
 *
 *   - `applyConversationFeel(text, locale)` — the deterministic, fail-open,
 *     locale-pure output stage. This is what the reply path calls on every
 *     outgoing reply. A guard can never break or drop a reply.
 *
 *   - `runPreSendAudit(text, ctx, opts)` — the full async orchestrator with
 *     check-only guards, optional model regen, and hash-chained audit log.
 *     Opt-in for callers that want the rich loop.
 *
 * Ported from BossNyumba `packages/conversation-feel` and neutralized for
 * Borjie's mining-estate domain. EN + SW handling is intact and locale-pure:
 * every guard operates within ONE locale and never injects the other.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  ChatbotFeelPattern,
  ConversationContext,
  GuardIntervention,
  GuardOutcome,
  Locale,
  RecentTurn,
  RemovedPhrase,
  RhythmScore,
  SessionStats,
  StrippedResponse,
  Surface,
  TurnKind,
  UserFact,
} from './types.js';

// ---------------------------------------------------------------------------
// Output stage (the wired entry point)
// ---------------------------------------------------------------------------
export {
  applyConversationFeel,
  type ConversationFeelResult,
} from './apply-conversation-feel.js';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
export {
  shouldRequestRegen,
  stripChatbotFeel,
} from './guards/anti-pattern-stripper.js';
export {
  countHedges,
  checkPosition,
  takesPosition,
  userAskedForOpinion,
  type PositionCheck,
} from './guards/position-taker.js';
export {
  checkSycophancy,
  expressesAgreement,
  extractAssertion,
  findContradiction,
  type ContradictoryEvidence,
  type SycophancyCheck,
  type UserAssertion,
} from './guards/sycophancy-detector.js';
export {
  checkBrevity,
  countBullets,
  countWords,
  inferTurnKind,
  isJustifiedLength,
  type BrevityCheck,
} from './guards/brevity-guard.js';
export {
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
  type HonestUncertaintyInput,
  type HonestUncertaintyResult,
} from './guards/honest-uncertainty.js';

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------
export {
  checkContinuity,
  recordFact,
  openThread,
  type ContinuityCheck,
  type ContinuitySessionState,
} from './continuity/continuity-enforcer.js';
export {
  checkSpecificity,
  extractSpecifics,
  type SpecificityCheck,
} from './continuity/specificity-enforcer.js';

// ---------------------------------------------------------------------------
// Style audit
// ---------------------------------------------------------------------------
export { analyzeRhythm, rhythmInjection } from './style-audit/rhythm-analyzer.js';
export {
  decideWit,
  witInjection,
  type WitDecision,
} from './style-audit/wit-allowance.js';
export { runPreSendAudit } from './style-audit/pre-send-audit.js';
export type {
  AuditOptions,
  AuditResult,
} from './style-audit/pre-send-audit.js';

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export {
  appendIntervention,
  listInterventions,
  verifyChain,
  setSessionStats,
  getSessionStats,
  getAllSessionStats,
  aggregateChatbotFeelScore,
  _resetAuditLog,
} from './audit-log.js';
