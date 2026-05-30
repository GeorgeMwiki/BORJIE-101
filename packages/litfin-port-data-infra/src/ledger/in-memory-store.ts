/**
 * In-memory event store implementation.
 *
 * Same semantics as the Postgres-backed store — optimistic
 * concurrency on `(streamId, version)`, monotonic global sequence,
 * synchronous in-process subscribers — but without persistence. Used
 * for unit tests, contract tests, and prototyping flows where a
 * Postgres instance is overkill.
 *
 * Ported verbatim from @litfin/ledger; the event-type bindings are
 * Borjie's MiningEvent set.
 */

import type {
  AppendOptions,
  EventEnvelope,
  EventHandler,
  EventStore,
  SubscriptionFilter,
  Unsubscribe,
} from "./types";
import { OptimisticConcurrencyError, TenantBoundaryViolation } from "./types";

interface Subscription {
  readonly filter: SubscriptionFilter;
  readonly handler: EventHandler;
}

export function createInMemoryEventStore(): EventStore {
  const events: EventEnvelope[] = [];
  const versionByStream = new Map<string, number>();
  const tenantByStream = new Map<string, string>();
  let globalSeq = 0;
  const subscribers = new Set<Subscription>();

  function matches(
    envelope: EventEnvelope,
    filter: SubscriptionFilter,
  ): boolean {
    if (filter.streamId && envelope.streamId !== filter.streamId) return false;
    if (filter.tenantId && envelope.tenantId !== filter.tenantId) return false;
    if (filter.eventTypes && !filter.eventTypes.includes(envelope.event.type))
      return false;
    return true;
  }

  async function fanOut(envelope: EventEnvelope): Promise<void> {
    for (const sub of subscribers) {
      if (!matches(envelope, sub.filter)) continue;
      try {
        await sub.handler(envelope);
      } catch (err) {
        if (typeof console !== "undefined") {
          // eslint-disable-next-line no-console
          console.error("[litfin-port-data-infra:ledger] subscriber threw:", err);
        }
      }
    }
  }

  return {
    async append(opts: AppendOptions): Promise<EventEnvelope> {
      const { streamId, tenantId, event, expectedVersion } = opts;
      const currentVersion = versionByStream.get(streamId) ?? 0;
      if (currentVersion !== expectedVersion) {
        throw new OptimisticConcurrencyError(
          streamId,
          expectedVersion,
          currentVersion,
        );
      }
      const existingTenant = tenantByStream.get(streamId);
      if (existingTenant && existingTenant !== tenantId) {
        throw new TenantBoundaryViolation(streamId, existingTenant, tenantId);
      }
      const nextVersion = currentVersion + 1;
      globalSeq += 1;
      const envelope: EventEnvelope = Object.freeze({
        streamId,
        tenantId,
        version: nextVersion,
        globalSeq,
        event,
        recordedAt: new Date().toISOString(),
      });
      events.push(envelope);
      versionByStream.set(streamId, nextVersion);
      tenantByStream.set(streamId, tenantId);
      await fanOut(envelope);
      return envelope;
    },

    async read(streamId, opts) {
      const fromVersion = opts?.fromVersion ?? 0;
      const tenantId = opts?.tenantId;
      return events.filter(
        (e) =>
          e.streamId === streamId &&
          e.version > fromVersion &&
          (tenantId === undefined || e.tenantId === tenantId),
      );
    },

    subscribe(filter, handler): Unsubscribe {
      const sub: Subscription = { filter, handler };
      subscribers.add(sub);
      return () => {
        subscribers.delete(sub);
      };
    },
  };
}
