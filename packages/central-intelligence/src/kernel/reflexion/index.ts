/**
 * Reflexion sub-module barrel.
 *
 * Re-exports the LITFIN-ported reflexion runtime: the original
 * session-end writer + retriever, the task-end recorder + loader, and
 * the 4-pass nightly sleep consolidation.
 */

// Session-scoped writer + retriever (existing API).
export {
  buildReflection,
  isExplicitSessionTerminator,
  isIdleSessionEnd,
  recordReflection,
  type ReflexionOutcome,
  type ReflexionWriterPort,
  type RecordReflectionArgs,
  type BuildReflectionInput,
  type IdleEndArgs,
} from './reflexion-writer.js';
export {
  createReflexionRetriever,
  DEFAULT_REFLEXION_LIMIT as DEFAULT_RETRIEVER_LIMIT,
  type ReflexionEntry,
  type ReflexionRetriever,
  type ReflexionRetrieverPort,
  type ReflexionRetrieverDeps,
  type RetrieveReflectionsArgs,
} from './reflexion-retriever.js';

// Task-scoped recorder + loader (LITFIN port).
export {
  recordReflexion,
  type ReflexionRecorderPort,
  type RecordReflexionArgs,
} from './reflexion-recorder.js';
export {
  loadReflexions,
  renderPromptFragment,
  DEFAULT_REFLEXION_LIMIT,
  DEFAULT_GUIDELINE_LIMIT,
  type LoadReflexionsArgs,
  type LoadReflexionsResult,
  type LoadedReflexion,
  type LoadedGuideline,
  type ReflexionLoaderPort,
} from './reflexion-loader.js';

// 4-pass nightly sleep consolidation.
export {
  runDedupeClusterPass,
  clusterReflexions,
  pickRepresentative,
  bigramSet,
  jaccard,
  type DedupeClusterPort,
  type DedupeClusterArgs,
  type DedupeClusterReport,
} from './sleep/pass-1-dedupe-cluster.js';
export {
  runExtractPatternsPass,
  extractTriggerAction,
  computeConfidence,
  makeSlug,
  type ExtractPatternsPort,
  type ExtractPatternsArgs,
  type ExtractPatternsReport,
  type CandidatePattern,
} from './sleep/pass-2-extract-patterns.js';
export {
  runUpdateGuidelinesPass,
  composeBody,
  mergeSourceIds,
  type UpdateGuidelinesPort,
  type UpdateGuidelinesArgs,
  type UpdateGuidelinesReport,
} from './sleep/pass-3-update-guidelines.js';
export {
  runPruneStalePass,
  shouldPrune,
  effectiveMaxAgeDays,
  type PruneStalePort,
  type PruneStaleArgs,
  type PruneStaleReport,
} from './sleep/pass-4-prune-stale.js';
export {
  runNightlySleep,
  type NightlySleepPorts,
  type NightlySleepArgs,
  type NightlySleepReport,
} from './sleep/nightly-sleep.js';
