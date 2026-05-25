/**
 * In-memory EventStore — for tests and dev.
 *
 * Same semantics as the Drizzle adapter: append is atomic per stream,
 * version is strictly monotonic, subscribers fire after the append
 * commits.
 */

import type { PaymentEvent } from "./events.js";
import {
  OptimisticConcurrencyError,
  type EventEnvelope,
  type EventHandler,
  type EventStore,
  type SubscriptionFilter,
  type Unsubscribe,
} from "./types.js";

interface Subscriber {
  readonly id: number;
  readonly filter: SubscriptionFilter;
  readonly handler: EventHandler;
}

export function createInMemoryEventStore(): EventStore {
  const streams = new Map<string, EventEnvelope[]>();
  const subscribers = new Map<number, Subscriber>();
  let subscriberSeq = 0;
  let globalSeq = 0;

  function streamFor(streamId: string): EventEnvelope[] {
    let s = streams.get(streamId);
    if (s === undefined) {
      s = [];
      streams.set(streamId, s);
    }
    return s;
  }

  async function notify(env: EventEnvelope): Promise<void> {
    for (const sub of subscribers.values()) {
      if (sub.filter.streamId && sub.filter.streamId !== env.streamId) continue;
      if (
        sub.filter.eventTypes &&
        !sub.filter.eventTypes.includes(env.event.type)
      ) {
        continue;
      }
      await sub.handler(env);
    }
  }

  return {
    async append(
      streamId: string,
      event: PaymentEvent,
      expectedVersion: number
    ): Promise<EventEnvelope> {
      const s = streamFor(streamId);
      const actual = s.length;
      if (actual !== expectedVersion) {
        throw new OptimisticConcurrencyError(streamId, expectedVersion, actual);
      }
      globalSeq += 1;
      const envelope: EventEnvelope = {
        streamId,
        version: actual + 1,
        globalSeq,
        event,
        recordedAt: new Date().toISOString(),
      };
      s.push(envelope);
      await notify(envelope);
      return envelope;
    },

    async read(
      streamId: string,
      fromVersion = 0
    ): Promise<readonly EventEnvelope[]> {
      const s = streams.get(streamId) ?? [];
      return s.filter((e) => e.version > fromVersion);
    },

    subscribe(filter: SubscriptionFilter, handler: EventHandler): Unsubscribe {
      subscriberSeq += 1;
      const id = subscriberSeq;
      subscribers.set(id, { id, filter, handler });
      return () => {
        subscribers.delete(id);
      };
    },
  };
}
