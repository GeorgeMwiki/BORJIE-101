/**
 * OBSERVE stage primitive — pulls in-scope events from the bus,
 * enforces the scope guard, applies the budget cap, and yields a
 * frozen array so downstream stages can't mutate the audit trail.
 */

import {
  eventInScope,
  type ObservedEvent,
  type ScopeFilter,
  type SubMdBudget,
  type SubMdEventPort,
} from './sub-md-base.js';

export interface ObserveStageArgs {
  readonly topic: string;
  readonly scope: ScopeFilter;
  readonly budget: SubMdBudget;
  readonly events: SubMdEventPort | undefined;
  readonly fallback?: ReadonlyArray<ObservedEvent>;
}

/**
 * Run the observe stage. Returns a frozen, in-scope, budget-capped
 * slice of events.
 */
export async function runObserveStage(args: ObserveStageArgs): Promise<ReadonlyArray<ObservedEvent>> {
  const { topic, scope, budget, events, fallback } = args;
  const collected: ObservedEvent[] = [];

  if (events !== undefined) {
    const iter = events.subscribe({
      topic,
      scope,
      limit: budget.maxObservedEvents,
    });
    for await (const evt of iter) {
      const guard = eventInScope(evt, scope);
      if (!guard.ok) continue;
      collected.push(evt);
      if (collected.length >= budget.maxObservedEvents) break;
    }
  } else if (fallback !== undefined) {
    for (const evt of fallback) {
      const guard = eventInScope(evt, scope);
      if (!guard.ok) continue;
      collected.push(evt);
      if (collected.length >= budget.maxObservedEvents) break;
    }
  }

  return Object.freeze(collected.slice());
}
