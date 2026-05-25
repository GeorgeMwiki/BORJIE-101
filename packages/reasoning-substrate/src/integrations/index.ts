/**
 * Integration shims — barrel.
 *
 * These three shims bridge the reasoning substrate to the already-
 * shipped K-D and K-E substrates without a compile-time dependency.
 * The api-gateway composition root binds the duck-typed ports to the
 * concrete services in `@borjie/central-intelligence` +
 * `@borjie/database`.
 *
 *   - kd-prefix-cache    : turns a discovered ReasoningStructure into
 *                          a deterministic, prefix-cache-friendly
 *                          string the LLM client can prepend to every
 *                          turn for that task class.
 *   - ke-constitutional  : shapes a Plan-and-Solve+ + Self-Discover
 *                          run into the ClusterReflection payload the
 *                          K-E critic expects.
 *   - kd-reflexion       : writes task_class-tagged reflections via
 *                          the K-D Reflexion writer so retrieval can
 *                          pull both reasoning structure AND lessons.
 */

export {
  buildReasoningPrefix,
  stableStringify,
  type BuildPrefixArgs,
} from './kd-prefix-cache.js';
export {
  buildConstitutionalReflection,
  scoreWithKEConstitutional,
  constitutionallyRelevantSteps,
  type BuildReflectionArgs,
  type ConstitutionalClusterReflection,
  type ConstitutionalCriticPort,
  type StepOutput,
} from './ke-constitutional.js';
export {
  recordTaggedReflection,
  buildTaggedReflectionText,
  type ReflexionOutcome,
  type ReflexionWriterPort,
  type RecordTaggedReflectionArgs,
} from './kd-reflexion.js';
