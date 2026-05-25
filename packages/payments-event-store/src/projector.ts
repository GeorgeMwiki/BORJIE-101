/**
 * Pure event-sourcing projector.
 *
 * Given an initial state, a stream of events, and a reducer per
 * event type, produces the derived read model. No side effects.
 *
 * Reducers are partial — events without a reducer pass through
 * unchanged. This means a projector only needs to know about events
 * it cares about (e.g. an `arrears-balance` projector ignores
 * `payment.initiated`).
 */

import type { PaymentEvent, PaymentEventType } from "./events.js";
import type { EventEnvelope } from "./types.js";

export type Reducer<TState, E extends PaymentEvent> = (
  state: TState,
  event: E,
  envelope: EventEnvelope
) => TState;

export type ReducerMap<TState> = {
  readonly [K in PaymentEventType]?: Reducer<
    TState,
    Extract<PaymentEvent, { type: K }>
  >;
};

export function project<TState>(
  events: readonly EventEnvelope[],
  initialState: TState,
  reducers: ReducerMap<TState>
): TState {
  let state = initialState;
  for (const envelope of events) {
    const reducer = reducers[envelope.event.type] as
      | Reducer<TState, PaymentEvent>
      | undefined;
    if (reducer === undefined) continue;
    state = reducer(state, envelope.event, envelope);
  }
  return state;
}
