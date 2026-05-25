/**
 * Tests for the Supabase realtime adapter — mocked transport.
 *
 * Verifies the adapter wires `subscribe`, `unsubscribe`, and
 * `broadcast` to the supabase-js channel API and converts errors to
 * `RealtimeAdapterError`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSupabaseRealtime } from '../supabase.js';
import { tenantChannelName, RealtimeAdapterError } from '../types.js';
import type { SupabaseClient } from '@borjie/supabase-client';

function makeMockSupabase(opts: {
  sendThrows?: boolean;
  unsubscribeThrows?: boolean;
  onThrows?: boolean;
} = {}): {
  client: SupabaseClient;
  channels: Map<string, {
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    handlers: Array<{ event: string; cb: (msg: unknown) => void }>;
  }>;
} {
  const channels = new Map<string, ReturnType<typeof makeChannel>>();

  function makeChannel(name: string) {
    const handlers: Array<{ event: string; cb: (msg: unknown) => void }> = [];
    const ch = {
      name,
      handlers,
      send: vi.fn(async () => {
        if (opts.sendThrows) throw new Error('send failed');
      }),
      on: vi.fn((_kind: string, filter: { event: string }, cb: (msg: unknown) => void) => {
        if (opts.onThrows) throw new Error('on failed');
        handlers.push({ event: filter.event, cb });
        return ch;
      }),
      subscribe: vi.fn(() => ch),
      unsubscribe: vi.fn(async () => {
        if (opts.unsubscribeThrows) throw new Error('unsubscribe failed');
      }),
    };
    return ch;
  }

  const client = {
    channel: vi.fn((name: string) => {
      let ch = channels.get(name);
      if (!ch) {
        ch = makeChannel(name);
        channels.set(name, ch);
      }
      return ch;
    }),
  } as unknown as SupabaseClient;

  return { client, channels };
}

describe('createSupabaseRealtime', () => {
  it('subscribe binds a broadcast handler to the channel', async () => {
    const { client, channels } = makeMockSupabase();
    const rt = createSupabaseRealtime({ supabase: client });
    const channel = tenantChannelName('t1', 'leases');
    const handle = await rt.subscribe(channel, { event: 'created' }, () => {});
    expect(handle.channel).toBe(channel);
    expect(handle.event).toBe('created');
    expect(client.channel).toHaveBeenCalledWith(channel);
    const ch = channels.get(channel);
    expect(ch?.on).toHaveBeenCalled();
    expect(ch?.subscribe).toHaveBeenCalled();
  });

  it('broadcast calls channel.send with the right shape', async () => {
    const { client, channels } = makeMockSupabase();
    const rt = createSupabaseRealtime({ supabase: client });
    const channel = tenantChannelName('t1', 'payments');
    await rt.broadcast(channel, 'received', { amount: 100 });
    const ch = channels.get(channel);
    expect(ch?.send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: 'received',
      payload: { amount: 100 },
    });
  });

  it('unsubscribe removes the listener and tears down the channel when empty', async () => {
    const { client, channels } = makeMockSupabase();
    const rt = createSupabaseRealtime({ supabase: client });
    const channel = tenantChannelName('t1', 'maintenance');
    const handle = await rt.subscribe(channel, {}, () => {});
    expect(channels.has(channel)).toBe(true);
    await rt.unsubscribe(handle);
    // The mock channels map records every `client.channel(name)` call;
    // the adapter cleared its OWN map but the mock's bookkeeping
    // captures the channel.unsubscribe() invocation.
    const ch = channels.get(channel);
    expect(ch?.unsubscribe).toHaveBeenCalled();
  });

  it('unsubscribe keeps channel alive when other listeners remain', async () => {
    const { client, channels } = makeMockSupabase();
    const rt = createSupabaseRealtime({ supabase: client });
    const channel = tenantChannelName('t1', 'tabs-updated');
    const h1 = await rt.subscribe(channel, {}, () => {});
    await rt.subscribe(channel, {}, () => {});
    await rt.unsubscribe(h1);
    const ch = channels.get(channel);
    expect(ch?.unsubscribe).not.toHaveBeenCalled();
  });

  it('event delivered to listener after subscribe', async () => {
    const { client, channels } = makeMockSupabase();
    const rt = createSupabaseRealtime({ supabase: client });
    const channel = tenantChannelName('t1', 'field-captures');
    const received: unknown[] = [];
    await rt.subscribe(channel, { event: 'captured' }, (evt) => {
      received.push(evt);
    });
    const ch = channels.get(channel);
    const handler = ch?.handlers[0]?.cb;
    expect(handler).toBeDefined();
    handler?.({ event: 'captured', payload: { fileId: 'F-1' } });
    // Give the await chain a tick.
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect((received[0] as { payload: unknown }).payload).toEqual({ fileId: 'F-1' });
  });

  it('broadcast errors wrap to RealtimeAdapterError', async () => {
    const { client } = makeMockSupabase({ sendThrows: true });
    const rt = createSupabaseRealtime({ supabase: client });
    await expect(
      rt.broadcast('tenant.t1.leases', 'created', {}),
    ).rejects.toThrow(RealtimeAdapterError);
  });

  it('unsubscribe errors wrap to RealtimeAdapterError', async () => {
    const { client } = makeMockSupabase({ unsubscribeThrows: true });
    const rt = createSupabaseRealtime({ supabase: client });
    const handle = await rt.subscribe('tenant.t1.payments', {}, () => {});
    await expect(rt.unsubscribe(handle)).rejects.toThrow(RealtimeAdapterError);
  });

  it('rejects missing supabase client', () => {
    expect(() =>
      createSupabaseRealtime({
        supabase: undefined as unknown as SupabaseClient,
      }),
    ).toThrow();
  });
});
