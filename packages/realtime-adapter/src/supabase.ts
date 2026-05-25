/**
 * Supabase Realtime RealtimePort — production.
 *
 * Adapts the `@supabase/supabase-js` realtime channel API to our
 * port. Each `subscribe` call opens (or reuses) a channel and binds a
 * broadcast listener; `unsubscribe` removes the listener and tears down
 * the channel if no listeners remain.
 *
 * Supabase Realtime supports three message classes: `broadcast`,
 * `presence`, `postgres_changes`. We use `broadcast` because the rest
 * of the platform pushes domain events through the api-gateway —
 * postgres_changes would be tempting but requires database triggers we
 * haven't standardised yet.
 */

import type { SupabaseClient } from '@borjie/supabase-client';
import {
  RealtimeAdapterError,
  type RealtimeListener,
  type RealtimePayload,
  type RealtimePort,
  type RealtimeSubscriptionHandle,
  type SubscribeFilter,
} from './types.js';

export interface SupabaseRealtimeOptions {
  readonly supabase: SupabaseClient;
}

interface ChannelWrapper {
  readonly channel: ReturnType<SupabaseClient['channel']>;
  readonly listeners: Set<RealtimeSubscriptionHandle>;
}

export function createSupabaseRealtime(
  options: SupabaseRealtimeOptions,
): RealtimePort {
  if (!options.supabase) throw new Error('supabase client required');
  const sb = options.supabase;
  const channels = new Map<string, ChannelWrapper>();
  let nextId = 1;

  function getOrCreate(channelName: string): ChannelWrapper {
    let wrapper = channels.get(channelName);
    if (!wrapper) {
      const ch = sb.channel(channelName);
      wrapper = { channel: ch, listeners: new Set() };
      channels.set(channelName, wrapper);
      // Subscribe lazily — sub status reported via .subscribe() callback.
      ch.subscribe();
    }
    return wrapper;
  }

  return {
    async subscribe(
      channelName: string,
      filter: SubscribeFilter,
      onEvent: RealtimeListener,
    ): Promise<RealtimeSubscriptionHandle> {
      const wrapper = getOrCreate(channelName);
      const id = `sub-${nextId++}`;
      const event = filter.event ?? '*';
      const handle: RealtimeSubscriptionHandle = {
        id,
        channel: channelName,
        event,
      };
      wrapper.listeners.add(handle);

      // Supabase's broadcast listener takes one specific event name or '*'.
      const eventName = event === '*' ? '*' : event;
      try {
        wrapper.channel.on(
          'broadcast' as Parameters<typeof wrapper.channel.on>[0],
          { event: eventName } as Parameters<typeof wrapper.channel.on>[1],
          (msg: { event?: string; payload?: RealtimePayload }) => {
            void onEvent({
              channel: channelName,
              event: msg.event ?? event,
              payload: msg.payload ?? {},
              timestamp: new Date(),
            });
          },
        );
      } catch (err) {
        throw new RealtimeAdapterError(
          `Supabase subscribe failed for ${channelName}: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
      return handle;
    },

    async unsubscribe(handle: RealtimeSubscriptionHandle): Promise<void> {
      const wrapper = channels.get(handle.channel);
      if (!wrapper) return;
      wrapper.listeners.delete(handle);
      if (wrapper.listeners.size === 0) {
        try {
          await wrapper.channel.unsubscribe();
        } catch (err) {
          throw new RealtimeAdapterError(
            `Supabase unsubscribe failed for ${handle.channel}: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
        }
        channels.delete(handle.channel);
      }
    },

    async broadcast(
      channelName: string,
      event: string,
      payload: RealtimePayload,
    ): Promise<void> {
      const wrapper = getOrCreate(channelName);
      try {
        await wrapper.channel.send({
          type: 'broadcast',
          event,
          payload,
        });
      } catch (err) {
        throw new RealtimeAdapterError(
          `Supabase broadcast failed for ${channelName}/${event}: ${err instanceof Error ? err.message : String(err)}`,
          err,
        );
      }
    },
  };
}
