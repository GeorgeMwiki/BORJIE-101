/**
 * OBSERVE — listens for arrears events in scope.
 */

import { runObserveStage } from '../shared/observe-stage.js';
import type { ObservedEvent, SubMdContext } from '../shared/sub-md-base.js';

export const ARREARS_TOPIC = 'arrears.event';

export async function observeArrears(
  ctx: SubMdContext,
  fallback?: ReadonlyArray<ObservedEvent>,
): Promise<ReadonlyArray<ObservedEvent>> {
  return runObserveStage({
    topic: ARREARS_TOPIC,
    scope: ctx.scope,
    budget: ctx.budget,
    events: ctx.events,
    ...(fallback ? { fallback } : {}),
  });
}
