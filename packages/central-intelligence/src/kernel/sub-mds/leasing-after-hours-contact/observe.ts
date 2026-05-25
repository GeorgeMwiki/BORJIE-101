/**
 * OBSERVE — listens for after-hours leasing-inquiry events in scope.
 */

import { runObserveStage } from '../shared/observe-stage.js';
import type { ObservedEvent, SubMdContext } from '../shared/sub-md-base.js';

export const LEASING_INQUIRY_TOPIC = 'leasing.inquiry';

export async function observeLeasing(
  ctx: SubMdContext,
  fallback?: ReadonlyArray<ObservedEvent>,
): Promise<ReadonlyArray<ObservedEvent>> {
  return runObserveStage({
    topic: LEASING_INQUIRY_TOPIC,
    scope: ctx.scope,
    budget: ctx.budget,
    events: ctx.events,
    ...(fallback ? { fallback } : {}),
  });
}
