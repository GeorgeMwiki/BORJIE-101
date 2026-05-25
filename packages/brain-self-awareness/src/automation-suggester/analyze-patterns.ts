// analyzePatterns — pure pattern detector for recurring action-kinds.
// Emits a SkillSuggestion whenever a single actionKind appears `threshold`+ times
// in the supplied window. Default threshold = 5.

import {
  DEFAULT_MAX_SAMPLES,
  DEFAULT_SUGGESTION_THRESHOLD,
  type AnalyzePatternsInput,
  type DecisionEventForAnalysis,
  type SampleInvocation,
  type SkillSuggestion
} from './types.js'

interface BucketState {
  readonly actionKind: string
  count: number
  readonly samples: SampleInvocation[]
}

/**
 * Buckets events by `actionKind`. Pure helper.
 */
function bucketByActionKind(
  events: readonly DecisionEventForAnalysis[],
  maxSamples: number
): readonly BucketState[] {
  const buckets = new Map<string, BucketState>()
  for (const ev of events) {
    let bucket = buckets.get(ev.actionKind)
    if (!bucket) {
      bucket = { actionKind: ev.actionKind, count: 0, samples: [] }
      buckets.set(ev.actionKind, bucket)
    }
    bucket.count += 1
    if (bucket.samples.length < maxSamples) {
      bucket.samples.push({
        when: ev.createdAt,
        inputs: ev.inputs ?? {}
      })
    }
  }
  return Array.from(buckets.values())
}

/**
 * Builds the human-facing copy for a suggestion. Pure.
 */
function renderSuggestion(bucket: BucketState): SkillSuggestion {
  return {
    name: `auto-${bucket.actionKind}`,
    description: `Automate the ${bucket.actionKind} action — observed ${bucket.count} times in the window.`,
    when_to_use: `Whenever a request would trigger ${bucket.actionKind} again.`,
    sampleInvocations: bucket.samples
  }
}

/**
 * Detects recurring action-kinds and emits a SkillSuggestion per qualifying bucket.
 *
 * Window filter: events with `createdAt < since` are dropped.
 * Suggestions are sorted by descending count for deterministic UI ordering.
 */
export function analyzePatterns(
  input: AnalyzePatternsInput
): readonly SkillSuggestion[] {
  const threshold = input.threshold ?? DEFAULT_SUGGESTION_THRESHOLD
  const maxSamples = input.maxSamples ?? DEFAULT_MAX_SAMPLES

  const sinceMs = Date.parse(input.since)
  if (Number.isNaN(sinceMs)) {
    throw new Error(`analyzePatterns: invalid "since" timestamp: ${input.since}`)
  }

  const inWindow = input.decisionEvents.filter((ev) => {
    const t = Date.parse(ev.createdAt)
    return !Number.isNaN(t) && t >= sinceMs
  })

  const buckets = bucketByActionKind(inWindow, maxSamples)
  return buckets
    .filter((b) => b.count >= threshold)
    .sort((a, b) => b.count - a.count)
    .map(renderSuggestion)
}
