/**
 * Read-model projector — pure reducer over a stream of events.
 *
 * Given a chronological list of envelopes and a map of typed reducers
 * (one per event type the caller cares about), produce the
 * projected state. Reducers receive the typed event AND the
 * envelope, so they can stamp version / globalSeq / recordedAt on
 * the read model when needed (e.g. for "as of" queries).
 *
 * Unhandled event types are silent no-ops — projectors are partial
 * by design. Adding a new event type should never crash an
 * existing read-model; the read-model author chooses whether to
 * react to the new type.
 *
 * Ported verbatim from @litfin/ledger; bound to MiningEvent set.
 */

import type { EventEnvelope } from "./types";
import type { MiningEvent, MiningEventType } from "./events";

export type Reducer<TState, E extends MiningEvent> = (
  state: TState,
  event: E,
  envelope: EventEnvelope,
) => TState;

export type ReducerMap<TState> = {
  readonly [K in MiningEventType]?: Reducer<
    TState,
    Extract<MiningEvent, { type: K }>
  >;
};

export function project<TState>(
  events: ReadonlyArray<EventEnvelope>,
  initialState: TState,
  reducers: ReducerMap<TState>,
): TState {
  let state = initialState;
  for (const envelope of events) {
    const reducer = reducers[envelope.event.type];
    if (!reducer) continue;
    // The cast is safe because the key check above ensures the
    // event's discriminator matches the reducer's expected type.
    state = (reducer as Reducer<TState, MiningEvent>)(
      state,
      envelope.event,
      envelope,
    );
  }
  return state;
}
