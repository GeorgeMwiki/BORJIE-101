/**
 * metric-computer — pure functions that bucket `doc_feedback_events`
 * into the per-recipe rolling stats the decision tables consume.
 *
 * No I/O. Tested in isolation.
 */

import type {
  DocFeedbackEventRow,
  RecipeFitnessStats,
  SectionRevisionRate,
} from '../types.js';

export interface ComputeStatsInput {
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly tenant_id: string;
  readonly window_start_iso: string;
  readonly window_end_iso: string;
  readonly composition_count: number;
  readonly events: ReadonlyArray<DocFeedbackEventRow>;
}

/**
 * Compute the canonical per-recipe stats over the supplied event list.
 *
 * Rules:
 *  - first-submit acceptance: count distinct artifact_ids whose first
 *    event in the window is `accepted` / total composition count
 *  - revision rate: distinct artifact_ids with any `revised` /
 *    composition_count
 *  - regulator_flag_count: literal count of `regulator_flag` events
 *  - owner_rewrite_count: literal count of `owner_rewrite` events
 *  - avg_time_to_approve: mean of `detail.seconds` on `time_to_approve`
 *    events (null when none recorded)
 *  - section_revision_rates: per `section_path`, count of `revised`
 *    events / composition_count
 */
export function computeRecipeStats(
  input: ComputeStatsInput,
): RecipeFitnessStats {
  const compositionCount = Math.max(0, input.composition_count);

  const acceptedArtifacts = new Set<string>();
  const revisedArtifacts = new Set<string>();
  let regulatorFlagCount = 0;
  let ownerRewriteCount = 0;
  const timeToApproveValues: number[] = [];
  const sectionRevisionCounts = new Map<string, Set<string>>();

  // To compute "first-submit acceptance" we need the first event per
  // artifact, ordered by recorded_at. Bucket the events first.
  const eventsByArtifact = new Map<string, DocFeedbackEventRow[]>();
  for (const e of input.events) {
    const bucket = eventsByArtifact.get(e.artifact_id);
    if (bucket === undefined) {
      eventsByArtifact.set(e.artifact_id, [e]);
    } else {
      bucket.push(e);
    }
    if (e.feedback_kind === 'regulator_flag') {
      regulatorFlagCount += 1;
    }
    if (e.feedback_kind === 'owner_rewrite') {
      ownerRewriteCount += 1;
    }
    if (e.feedback_kind === 'revised') {
      revisedArtifacts.add(e.artifact_id);
      if (e.section_path !== null && e.section_path.length > 0) {
        const set = sectionRevisionCounts.get(e.section_path);
        if (set === undefined) {
          sectionRevisionCounts.set(e.section_path, new Set([e.artifact_id]));
        } else {
          set.add(e.artifact_id);
        }
      }
    }
    if (e.feedback_kind === 'time_to_approve') {
      const seconds = readSeconds(e.detail);
      if (seconds !== null) timeToApproveValues.push(seconds);
    }
  }

  // First-submit acceptance: for each artifact, sort events by recorded_at
  // ascending and check if the earliest is `accepted`.
  for (const [artifactId, bucket] of eventsByArtifact) {
    const sorted = [...bucket].sort((a, b) =>
      a.recorded_at < b.recorded_at ? -1 : a.recorded_at > b.recorded_at ? 1 : 0,
    );
    const first = sorted[0];
    if (first !== undefined && first.feedback_kind === 'accepted') {
      acceptedArtifacts.add(artifactId);
    }
  }

  const safeRate = (numerator: number): number =>
    compositionCount === 0
      ? 0
      : clamp01(numerator / compositionCount);

  const sectionRates: ReadonlyArray<SectionRevisionRate> = Array.from(
    sectionRevisionCounts.entries(),
  )
    .map(([path, ids]) => ({
      section_path: path,
      revision_count: ids.size,
      revision_rate: safeRate(ids.size),
    }))
    .sort((a, b) => b.revision_rate - a.revision_rate);

  return {
    recipe_id: input.recipe_id,
    recipe_version: input.recipe_version,
    tenant_id: input.tenant_id,
    window_start_iso: input.window_start_iso,
    window_end_iso: input.window_end_iso,
    composition_count: compositionCount,
    first_submit_acceptance_rate: safeRate(acceptedArtifacts.size),
    revision_rate: safeRate(revisedArtifacts.size),
    regulator_flag_count: regulatorFlagCount,
    owner_rewrite_count: ownerRewriteCount,
    avg_time_to_approve_seconds:
      timeToApproveValues.length === 0
        ? null
        : timeToApproveValues.reduce((s, v) => s + v, 0) /
          timeToApproveValues.length,
    section_revision_rates: sectionRates,
  };
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function readSeconds(detail: Readonly<Record<string, unknown>>): number | null {
  const raw = detail['seconds'];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
