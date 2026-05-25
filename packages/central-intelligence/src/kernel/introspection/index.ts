/**
 * Introspection layer — the brain's "self-knowledge" pattern.
 *
 * Four pieces:
 *   1. Decision-trace replay: re-run historical kernel turns through
 *      the current kernel logic to detect drift / regression /
 *      fairness anomalies.
 *   2. Capability cards: per-persona "model cards" describing what the
 *      persona reliably does, refuses, and is uncertain about.
 *   3. Per-thought running self-model (Rosenthal 1986 first-order):
 *      "what am I doing right now, what is my confidence, what am I
 *      uncertain about." Closes parity-litfin §4.1.
 *   4. Recursive HOT (Rosenthal 1986/2005, bounded depth): a HOT over
 *      the first-order self-model so the agent can introspect on its
 *      reasoning process. Closes parity-litfin §4.2.
 *
 * Together these close the assessment gap "the brain doesn't know
 * what it can do" plus the metacognition gap "the brain doesn't know
 * what it is doing right now or why."
 */

export {
  runDecisionReplay,
  type ReplayDelta,
  type ReplayDeps,
  type ReplayInput,
  type ReplaySource,
  type ReplaySummary,
  type ReplayThinkFn,
} from './trace-replay.js';

export {
  createPostgresReplaySource,
  type PostgresProvenanceQueryClient,
} from './trace-replay-postgres-source.js';

export {
  CAPABILITY_CARDS,
  type CapabilityCard,
  type CapabilityCardEvalSummary,
  type CapabilityClaim,
  type RefusalCategory,
  type RefusalClaim,
  type UncertaintyClaim,
} from './capability-cards.js';

export { renderCapabilityCardMarkdown } from './render-capability-card.js';

export {
  buildPerThoughtSelfModel,
  type BuildSelfModelInput,
  type IntrospectionContext,
  type IntrospectionJudge,
  type PerThoughtSelfModel,
  type SelfModelPosture,
  type ThoughtSnapshot,
} from './per-thought-self-model.js';

export {
  generateRecursiveHot,
  DEFAULT_HOT_DEPTH,
  MAX_HOT_DEPTH,
  type HotRung,
  type RecursiveHotInput,
  type RecursiveHotResult,
} from './recursive-hot.js';
