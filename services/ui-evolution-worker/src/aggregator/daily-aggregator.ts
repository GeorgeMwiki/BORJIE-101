/**
 * Daily-aggregator orchestration — pure composition over the metric
 * computer + fitness scorer.
 *
 * The nightly cron walks every live `tab_recipes` row, pulls the
 * 14-day rolling window AND the 60-day rolling window via the
 * telemetry repository, and produces a `FitnessReport` per recipe.
 * The decision modules (`lock-decision` + `improve-decision`)
 * consume the reports.
 *
 * Separation rationale:
 *   - This module knows nothing about Postgres / Drizzle. It takes
 *     a `TelemetryReader` port. Production wires the repository;
 *     tests pass in-memory arrays.
 *   - Two windows in one pass: the 14-day window drives the
 *     improve/lock candidacy; the 60-day window is consulted by
 *     `lock-decision` for the §4 "sustained for 30 days" rule.
 */

import type { FitnessReport, TelemetryEvent } from '../types.js';
import { computeRecipeMetrics } from './metric-computer.js';
import { scoreRecipe } from './fitness-scorer.js';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** Range query against `ui_telemetry_events` for a single recipe. */
export interface TelemetryReader {
  readEventsForRecipe(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
    readonly sinceIso: string;
    readonly untilIso: string;
  }): Promise<ReadonlyArray<TelemetryEvent>>;
}

// ---------------------------------------------------------------------------
// Window helpers
// ---------------------------------------------------------------------------

export interface WindowSpec {
  readonly startIso: string;
  readonly endIso: string;
}

/**
 * Compute the [start, end] ISO bounds for a rolling window anchored at
 * `nowIso`. `days` is the number of days the window covers; the start
 * is `now - days * 86400_000`.
 */
export function makeWindow(nowIso: string, days: number): WindowSpec {
  const end = new Date(nowIso);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`daily-aggregator: invalid nowIso '${nowIso}'`);
  }
  const start = new Date(end.getTime() - days * 86_400_000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public — aggregate a single recipe across both windows
// ---------------------------------------------------------------------------

export interface AggregateRecipeArgs {
  readonly tabRecipeId: string;
  readonly tabRecipeVersion: number;
  readonly shortWindow: WindowSpec;
  readonly longWindow: WindowSpec;
  readonly reader: TelemetryReader;
}

/** Two reports per recipe — one per window. */
export interface RecipeAggregation {
  readonly shortReport: FitnessReport;
  readonly longReport: FitnessReport;
}

/**
 * Pull events from both windows and run the scorer over each. The
 * caller (lock-decision / improve-decision) interprets the pair.
 */
export async function aggregateRecipe(
  args: AggregateRecipeArgs,
): Promise<RecipeAggregation> {
  const shortEvents = await args.reader.readEventsForRecipe({
    tabRecipeId: args.tabRecipeId,
    tabRecipeVersion: args.tabRecipeVersion,
    sinceIso: args.shortWindow.startIso,
    untilIso: args.shortWindow.endIso,
  });
  const longEvents = await args.reader.readEventsForRecipe({
    tabRecipeId: args.tabRecipeId,
    tabRecipeVersion: args.tabRecipeVersion,
    sinceIso: args.longWindow.startIso,
    untilIso: args.longWindow.endIso,
  });

  const shortMetrics = computeRecipeMetrics({
    tabRecipeId: args.tabRecipeId,
    tabRecipeVersion: args.tabRecipeVersion,
    windowStartIso: args.shortWindow.startIso,
    windowEndIso: args.shortWindow.endIso,
    events: shortEvents,
  });
  const longMetrics = computeRecipeMetrics({
    tabRecipeId: args.tabRecipeId,
    tabRecipeVersion: args.tabRecipeVersion,
    windowStartIso: args.longWindow.startIso,
    windowEndIso: args.longWindow.endIso,
    events: longEvents,
  });

  return {
    shortReport: scoreRecipe(shortMetrics),
    longReport: scoreRecipe(longMetrics),
  };
}
