/**
 * Continuous Learning Amplification — public surface (Borjie port).
 *
 * Ported verbatim from LitFin (BorjieMark replaces LitfinMark, brand
 * swap). Two entry points:
 *
 *   - `recordObservation(obs)` — fire-and-forget; called from any
 *     Borjie module that observes a meaningful interaction (claim
 *     cited by Mr. Mwikila, user disputed, answer accepted, language
 *     misdetected, etc.). Side-effect only.
 *
 *   - `runAmplification()` — nightly batch job; rolls up the
 *     observation window with exponential decay and adjusts claim
 *     confidence + status.
 *
 *   - `configureLearningAmplification(factory)` — bootstrap hook that
 *     injects the surface-specific service-role Supabase client. Call
 *     once from api-gateway / owner-web / admin-web bootstrap before
 *     `recordObservation` or `runAmplification` are invoked.
 *
 * The amplification loop is what makes user 100 measurably better off
 * than user 50: every interaction sharpens the brain's confidence over
 * the exact knowledge users actually need, the daily cron prunes stale
 * claims, and the cohort-stats view exposes the trend in /admin
 * dashboards.
 */

export type {
  Observation,
  ObservationKind,
  ConfidenceUpdate,
  UserCohortStats,
  SupabaseLike,
  SupabaseQueryBuilder,
} from "./types.js";
export { BorjieMark } from "./types.js";
export {
  recordObservation,
  recordedObservationsDropped,
  configureLearningAmplification,
} from "./observation-recorder.js";
export {
  runAmplification,
  configureAmplificationJob,
} from "./amplification-job.js";
export type { AmplificationRunSummary } from "./amplification-job.js";
