/**
 * Event-sourced history of parcel changes.
 *
 * Every mutation to a parcel becomes an immutable `ParcelEvent`.
 * `getHistory(parcelId, filter?)` returns chronological events.
 * `replayState(parcelId, atTimestamp)` reconstructs the parcel state
 * at any past moment by folding events from inception up to that
 * timestamp.
 *
 * The replay folder is generic: callers pass a reducer that knows how
 * to apply each event kind to its state shape. We ship a `defaultReducer`
 * that handles `polygon_changed`, `metadata_updated`, `subdivided`,
 * `merged`, `disposed`, and `acquired` — adequate for the parcel
 * snapshot reconstruction used by the explore route.
 */

import type {
  EventId,
  ParcelEvent,
  ParcelEventKind,
  ParcelId,
  TenantId,
  UserId,
} from '../types.js';

function newEventId(): EventId {
  return `evt_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export interface HistoryFilter {
  readonly kinds?: ReadonlyArray<ParcelEventKind>;
  readonly since?: string;
  readonly until?: string;
}

export interface EventStore {
  readonly recordEvent: (args: {
    readonly parcelId: ParcelId;
    readonly tenantId: TenantId;
    readonly kind: ParcelEventKind;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly evidenceRefs?: ReadonlyArray<string>;
    readonly actorUserId?: UserId;
    readonly occurredAt?: string;
  }) => ParcelEvent;
  readonly getHistory: (
    parcelId: ParcelId,
    filter?: HistoryFilter,
  ) => ReadonlyArray<ParcelEvent>;
  readonly replayState: <S>(args: {
    readonly parcelId: ParcelId;
    readonly atTimestamp: string;
    readonly initialState: S;
    readonly reducer: (state: S, event: ParcelEvent) => S;
  }) => S;
}

export function createInMemoryEventStore(): EventStore {
  // parcelId -> events (oldest first)
  const events = new Map<ParcelId, ParcelEvent[]>();

  return Object.freeze({
    recordEvent(args: {
      readonly parcelId: ParcelId;
      readonly tenantId: TenantId;
      readonly kind: ParcelEventKind;
      readonly payload?: Readonly<Record<string, unknown>>;
      readonly evidenceRefs?: ReadonlyArray<string>;
      readonly actorUserId?: UserId;
      readonly occurredAt?: string;
    }): ParcelEvent {
      const event: ParcelEvent = Object.freeze({
        eventId: newEventId(),
        parcelId: args.parcelId,
        tenantId: args.tenantId,
        kind: args.kind,
        ...(args.actorUserId !== undefined ? { actorUserId: args.actorUserId } : {}),
        occurredAt: args.occurredAt ?? new Date().toISOString(),
        payload: Object.freeze({ ...(args.payload ?? {}) }),
        evidenceRefs: Object.freeze([...(args.evidenceRefs ?? [])]),
      });
      let list = events.get(args.parcelId);
      if (!list) {
        list = [];
        events.set(args.parcelId, list);
      }
      list.push(event);
      list.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      return event;
    },
    getHistory(parcelId: ParcelId, filter?: HistoryFilter): ReadonlyArray<ParcelEvent> {
      const list = events.get(parcelId) ?? [];
      if (!filter) return [...list];
      return list.filter((e) => {
        if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
        if (filter.since && e.occurredAt < filter.since) return false;
        if (filter.until && e.occurredAt > filter.until) return false;
        return true;
      });
    },
    replayState<S>(args: {
      readonly parcelId: ParcelId;
      readonly atTimestamp: string;
      readonly initialState: S;
      readonly reducer: (state: S, event: ParcelEvent) => S;
    }): S {
      const list = events.get(args.parcelId) ?? [];
      let state = args.initialState;
      for (const e of list) {
        if (e.occurredAt > args.atTimestamp) break;
        state = args.reducer(state, e);
      }
      return state;
    },
  });
}

// ============================================================================
// Default reducer — folds well-known event kinds onto a generic state shape
// ============================================================================

export interface ParcelSnapshot {
  readonly status: 'active' | 'subdivided' | 'merged' | 'disposed' | 'unknown';
  readonly geometry?: unknown;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly events: number;
}

export function emptyParcelSnapshot(): ParcelSnapshot {
  return Object.freeze({
    status: 'unknown',
    metadata: Object.freeze({}),
    events: 0,
  });
}

export function defaultReducer(
  state: ParcelSnapshot,
  event: ParcelEvent,
): ParcelSnapshot {
  const events = state.events + 1;
  switch (event.kind) {
    case 'acquired':
      return Object.freeze({
        ...state,
        status: 'active',
        events,
      });
    case 'polygon_changed':
      return Object.freeze({
        ...state,
        geometry: event.payload.geometry ?? state.geometry,
        events,
      });
    case 'metadata_updated':
      return Object.freeze({
        ...state,
        metadata: Object.freeze({ ...state.metadata, ...(event.payload as Record<string, unknown>) }),
        events,
      });
    case 'subdivided':
      return Object.freeze({ ...state, status: 'subdivided', events });
    case 'merged':
      return Object.freeze({ ...state, status: 'merged', events });
    case 'disposed':
      return Object.freeze({ ...state, status: 'disposed', events });
    default:
      return Object.freeze({ ...state, events });
  }
}
