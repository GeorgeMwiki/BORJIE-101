/**
 * Pure metric computation over a slice of `ui_telemetry_events`.
 *
 * Inputs:
 *   - A rolling window of raw events for ONE (tab_recipe_id,
 *     tab_recipe_version).
 *   - The window's start + end timestamp (caller-supplied so the
 *     decision tier can reproduce the same window deterministically).
 *
 * Output: a `RecipeMetrics` with completion rate, error rate, per-
 * field abandonment + tooltip-hit rates. Pure, no I/O, fully unit-
 * testable.
 *
 * Definitions (from Docs/DESIGN/ANTICIPATORY_UX_SPEC.md §4):
 *
 *   completion_rate(version)        = submit / render
 *   error_rate(field)               = error / focus
 *   abandonment_rate(field)         = blur-without-submit / focus
 *   tooltip_hit_rate(field)         = tooltip_hit / focus
 *
 * "blur-without-submit" is defined per session: if a session emits a
 * `blur` for a field and never emits a `submit`, that's an abandonment
 * for that field. Computed here by joining the field-level blur stream
 * with the session-level submit stream.
 */

import type {
  EventKind,
  FieldMetrics,
  RecipeMetrics,
  TelemetryEvent,
} from '../types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ComputeMetricsArgs {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly windowStartIso: string;
  readonly windowEndIso: string;
  readonly events: ReadonlyArray<TelemetryEvent>;
}

/**
 * Compute the rolling-window metrics for a single (recipe, version).
 * Returns a fresh `RecipeMetrics` value — never mutates inputs.
 */
export function computeRecipeMetrics(args: ComputeMetricsArgs): RecipeMetrics {
  const inWindow = args.events.filter(
    (e) =>
      e.tabRecipeId === args.tabRecipeId &&
      e.tabRecipeVersion === args.tabRecipeVersion,
  );

  const renderCount = countKind(inWindow, 'render');
  const submitCount = countKind(inWindow, 'submit');
  const completionRate = safeDiv(submitCount, renderCount);

  const submittedSessionIds = new Set<string>();
  for (const e of inWindow) {
    if (e.eventKind === 'submit' && e.sessionId) {
      submittedSessionIds.add(e.sessionId);
    }
  }

  const fieldEventMap = groupByField(inWindow);
  const fieldMetrics: FieldMetrics[] = [];

  for (const [fieldId, events] of fieldEventMap.entries()) {
    const focusCount = countKind(events, 'focus');
    const errorCount = countKind(events, 'error');
    const tooltipHitCount = countKind(events, 'tooltip_hit');

    // blur-without-submit per session — count blurs whose session
    // never emitted a submit.
    let blurWithoutSubmitCount = 0;
    for (const e of events) {
      if (e.eventKind !== 'blur') continue;
      if (!e.sessionId) {
        // No session id means we can't decide — be conservative and
        // count it as abandonment (worst-case for lock).
        blurWithoutSubmitCount += 1;
        continue;
      }
      if (!submittedSessionIds.has(e.sessionId)) {
        blurWithoutSubmitCount += 1;
      }
    }

    fieldMetrics.push({
      fieldId,
      focusCount,
      errorCount,
      blurWithoutSubmitCount,
      tooltipHitCount,
      errorRate: safeDiv(errorCount, focusCount),
      abandonmentRate: safeDiv(blurWithoutSubmitCount, focusCount),
      tooltipHitRate: safeDiv(tooltipHitCount, focusCount),
    });
  }

  // Average error rate across fields (weighted by focus count) and
  // the max single-field abandonment.
  const totalFocus = fieldMetrics.reduce((s, f) => s + f.focusCount, 0);
  const weightedErrorTotal = fieldMetrics.reduce(
    (s, f) => s + f.errorRate * f.focusCount,
    0,
  );
  const errorRate = safeDiv(weightedErrorTotal, totalFocus);
  const maxFieldAbandonmentRate = fieldMetrics.reduce(
    (m, f) => (f.abandonmentRate > m ? f.abandonmentRate : m),
    0,
  );

  return {
    tabRecipeId: args.tabRecipeId,
    tabRecipeVersion: args.tabRecipeVersion,
    windowStartIso: args.windowStartIso,
    windowEndIso: args.windowEndIso,
    renderCount,
    submitCount,
    completionRate,
    errorRate,
    maxFieldAbandonmentRate,
    fields: fieldMetrics.sort((a, b) => a.fieldId.localeCompare(b.fieldId)),
  };
}

// ---------------------------------------------------------------------------
// Helpers — all pure.
// ---------------------------------------------------------------------------

function countKind(
  events: ReadonlyArray<TelemetryEvent>,
  kind: EventKind,
): number {
  let n = 0;
  for (const e of events) {
    if (e.eventKind === kind) n += 1;
  }
  return n;
}

function groupByField(
  events: ReadonlyArray<TelemetryEvent>,
): ReadonlyMap<string, ReadonlyArray<TelemetryEvent>> {
  const out = new Map<string, TelemetryEvent[]>();
  for (const e of events) {
    if (!e.fieldId) continue; // skip tab-level events
    const bucket = out.get(e.fieldId);
    if (bucket) {
      bucket.push(e);
    } else {
      out.set(e.fieldId, [e]);
    }
  }
  return out;
}

function safeDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  const v = numerator / denominator;
  if (!Number.isFinite(v)) return 0;
  return v;
}
