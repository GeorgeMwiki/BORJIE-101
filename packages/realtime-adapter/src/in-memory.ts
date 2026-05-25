/**
 * In-memory RealtimePort for tests.
 *
 * Pure pub/sub. No network. Subscribers receive events synchronously
 * with their broadcast (the awaited Promise resolves only after all
 * listeners have run).
 */

import {
  type RealtimeEvent,
  type RealtimeListener,
  type RealtimePayload,
  type RealtimePort,
  type RealtimeSubscriptionHandle,
  type SubscribeFilter,
} from './types.js';

interface Subscription {
  readonly id: string;
  readonly channel: string;
  readonly event: string | '*';
  readonly listener: RealtimeListener;
}

export function createInMemoryRealtime(): RealtimePort & {
  /** Test-only — total live subscriptions. */
  readonly _subscriptionCount: () => number;
  /** Test-only — drain all subscriptions. */
  readonly _drain: () => void;
} {
  const subs = new Map<string, Subscription>();
  let nextId = 1;

  return {
    async subscribe(
      channelName: string,
      filter: SubscribeFilter,
      onEvent: RealtimeListener,
    ): Promise<RealtimeSubscriptionHandle> {
      const id = `sub-${nextId++}`;
      const event = filter.event ?? '*';
      subs.set(id, { id, channel: channelName, event, listener: onEvent });
      return { id, channel: channelName, event };
    },

    async unsubscribe(handle: RealtimeSubscriptionHandle): Promise<void> {
      subs.delete(handle.id);
    },

    async broadcast(
      channelName: string,
      event: string,
      payload: RealtimePayload,
    ): Promise<void> {
      const evt: RealtimeEvent = {
        channel: channelName,
        event,
        payload,
        timestamp: new Date(),
      };
      const targets: Subscription[] = [];
      for (const sub of subs.values()) {
        if (sub.channel !== channelName) continue;
        if (sub.event !== '*' && sub.event !== event) continue;
        targets.push(sub);
      }
      // Run listeners sequentially so test ordering is deterministic.
      for (const t of targets) {
        await t.listener(evt);
      }
    },

    _subscriptionCount(): number {
      return subs.size;
    },

    _drain(): void {
      subs.clear();
    },
  };
}
