/**
 * Round-trip pub/sub tests for the in-memory adapter.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryRealtime } from '../in-memory.js';
import { tenantChannelName, type RealtimeEvent } from '../types.js';

describe('createInMemoryRealtime', () => {
  it('delivers a broadcast to a single matching subscriber', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'leases');
    const received: RealtimeEvent[] = [];
    await rt.subscribe(channel, { event: 'created' }, (evt) => {
      received.push(evt);
    });
    await rt.broadcast(channel, 'created', { leaseId: 'L-1' });
    expect(received.length).toBe(1);
    expect(received[0]?.channel).toBe(channel);
    expect(received[0]?.event).toBe('created');
    expect(received[0]?.payload).toEqual({ leaseId: 'L-1' });
  });

  it('wildcard subscriber receives every event on the channel', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'payments');
    const seen: string[] = [];
    await rt.subscribe(channel, {}, (evt) => {
      seen.push(evt.event);
    });
    await rt.broadcast(channel, 'received', {});
    await rt.broadcast(channel, 'reconciled', {});
    await rt.broadcast(channel, 'reversed', {});
    expect(seen).toEqual(['received', 'reconciled', 'reversed']);
  });

  it('event-filtered subscriber ignores other events', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'maintenance');
    const matched: string[] = [];
    await rt.subscribe(channel, { event: 'opened' }, (evt) => {
      matched.push(evt.event);
    });
    await rt.broadcast(channel, 'opened', {});
    await rt.broadcast(channel, 'closed', {});
    expect(matched).toEqual(['opened']);
  });

  it('cross-channel isolation: a sub on channel A never receives broadcasts to channel B', async () => {
    const rt = createInMemoryRealtime();
    const a = tenantChannelName('t1', 'leases');
    const b = tenantChannelName('t2', 'leases');
    const seenOnA: number[] = [];
    await rt.subscribe(a, {}, () => seenOnA.push(1));
    await rt.broadcast(b, 'created', { leaseId: 'B-only' });
    expect(seenOnA.length).toBe(0);
  });

  it('multi-subscriber: every matching listener fires', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'reports-generated');
    let count = 0;
    for (let i = 0; i < 5; i++) {
      await rt.subscribe(channel, {}, () => {
        count++;
      });
    }
    await rt.broadcast(channel, 'ready', { reportId: 'R-1' });
    expect(count).toBe(5);
  });

  it('unsubscribe removes the listener and is idempotent', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'tabs-updated');
    let count = 0;
    const handle = await rt.subscribe(channel, {}, () => {
      count++;
    });
    expect(rt._subscriptionCount()).toBe(1);
    await rt.unsubscribe(handle);
    expect(rt._subscriptionCount()).toBe(0);
    // Second unsubscribe = noop, not throw.
    await expect(rt.unsubscribe(handle)).resolves.toBeUndefined();
    await rt.broadcast(channel, 'updated', {});
    expect(count).toBe(0);
  });

  it('broadcast with no subscribers is a no-op', async () => {
    const rt = createInMemoryRealtime();
    await expect(
      rt.broadcast('tenant.x.leases', 'noop', {}),
    ).resolves.toBeUndefined();
  });

  it('async listeners are awaited sequentially before broadcast resolves', async () => {
    const rt = createInMemoryRealtime();
    const channel = tenantChannelName('t1', 'applications');
    const order: string[] = [];
    await rt.subscribe(channel, {}, async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('first');
    });
    await rt.subscribe(channel, {}, async () => {
      order.push('second');
    });
    await rt.broadcast(channel, 'submitted', {});
    expect(order).toEqual(['first', 'second']);
  });
});
