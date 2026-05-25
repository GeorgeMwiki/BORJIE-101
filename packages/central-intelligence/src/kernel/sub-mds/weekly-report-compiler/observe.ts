/**
 * OBSERVE — listens for week-roll events in scope.
 */

import { runObserveStage } from '../shared/observe-stage.js';
import type { ObservedEvent, SubMdContext } from '../shared/sub-md-base.js';

export const REPORT_TOPIC = 'report.week-roll';

export async function observeReport(
  ctx: SubMdContext,
  fallback?: ReadonlyArray<ObservedEvent>,
): Promise<ReadonlyArray<ObservedEvent>> {
  return runObserveStage({
    topic: REPORT_TOPIC,
    scope: ctx.scope,
    budget: ctx.budget,
    events: ctx.events,
    ...(fallback ? { fallback } : {}),
  });
}
