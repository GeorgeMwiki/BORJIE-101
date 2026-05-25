/**
 * DecisionTrace public surface. Re-exports the types, factory,
 * persistence port, and replay helper so consumers can wire the whole
 * module via a single `@borjie/observability` import.
 *
 * @module packages/observability/src/decision-trace
 */

export type {
  DecisionBranch,
  DecisionOutcome,
  DecisionTrace,
  DecisionTraceContext,
  DecisionTraceFinalised,
} from './types.js';

export {
  DecisionTraceFinalisedError,
  DecisionTraceUnknownBranchError,
} from './types.js';

export {
  startDecisionTrace,
  withDecisionTrace,
  type StartDecisionTraceOptions,
} from './decision-trace.js';

export {
  MemoryDecisionTraceStore,
  getDefaultDecisionTraceStore,
  setDefaultDecisionTraceStore,
  type DecisionTraceStore,
} from './persistence-port.js';

export { replayDecisionTrace } from './replay.js';

export { attachDecisionTraceToActiveSpan } from './otel-bridge.js';

export {
  SupabaseDecisionTraceStore,
  type SupabaseDecisionTraceStoreOptions,
  type SupabaseLikeClient,
  type SupabaseLikeQueryBuilder,
  type SupabaseStoreLogger,
} from './supabase-store.js';
