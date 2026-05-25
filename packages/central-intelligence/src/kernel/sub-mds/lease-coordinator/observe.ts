/**
 * OBSERVE — listens for lease lifecycle events in scope.
 */

import { runObserveStage } from '../shared/observe-stage.js';
import type { ObservedEvent, SubMdContext } from '../shared/sub-md-base.js';

export const LEASE_TOPIC = 'lease.lifecycle';

export async function observeLease(
  ctx: SubMdContext,
  fallback?: ReadonlyArray<ObservedEvent>,
): Promise<ReadonlyArray<ObservedEvent>> {
  return runObserveStage({
    topic: LEASE_TOPIC,
    scope: ctx.scope,
    budget: ctx.budget,
    events: ctx.events,
    ...(fallback ? { fallback } : {}),
  });
}
