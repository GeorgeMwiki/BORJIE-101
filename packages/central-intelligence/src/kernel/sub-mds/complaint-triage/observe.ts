/**
 * OBSERVE — listens for complaint events (chat / email / SMS / voice).
 */

import { runObserveStage } from '../shared/observe-stage.js';
import type { ObservedEvent, SubMdContext } from '../shared/sub-md-base.js';

export const COMPLAINT_TOPIC = 'complaint.received';

export async function observeComplaints(
  ctx: SubMdContext,
  fallback?: ReadonlyArray<ObservedEvent>,
): Promise<ReadonlyArray<ObservedEvent>> {
  return runObserveStage({
    topic: COMPLAINT_TOPIC,
    scope: ctx.scope,
    budget: ctx.budget,
    events: ctx.events,
    ...(fallback ? { fallback } : {}),
  });
}
