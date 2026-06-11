/**
 * Cross-surface state bus — store sync + handoff round-trip.
 *
 * Uses the in-memory RealtimePort (the same transport seam production
 * wires to Supabase Realtime) and a SEPARATE SlotsRepository per
 * surface, proving that a decision the MD makes in chat re-projects
 * onto an owner-web tab and a mobile screen by CONVERGENCE — the object
 * lives once, every surface ends at the same value.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryRealtime } from '@borjie/realtime-adapter';
import {
  createInMemorySlotsRepository,
  createSlotStore,
  createHandoffService,
  type HandoffProjection,
  type Slot,
  type SlotSurface,
} from '../index.js';

const TENANT = 't1';
const SLOT = 'incident:KAH-088:decision';

/** Build a store bound to a surface, sharing one realtime bus. */
function makeStore(
  realtime: ReturnType<typeof createInMemoryRealtime>,
  surface: SlotSurface,
  converged: Slot[],
) {
  const repository = createInMemorySlotsRepository();
  const store = createSlotStore({
    repository,
    realtime,
    surface,
    onConverged: (s) => converged.push(s),
  });
  return { repository, store };
}

describe('slot-store — cross-surface convergence', () => {
  it('a chat write re-projects onto owner-web + mobile (lives once)', async () => {
    const realtime = createInMemoryRealtime();
    const chatSeen: Slot[] = [];
    const ownerSeen: Slot[] = [];
    const mobileSeen: Slot[] = [];

    const chat = makeStore(realtime, 'chat', chatSeen);
    const owner = makeStore(realtime, 'owner-web', ownerSeen);
    const mobile = makeStore(realtime, 'workforce-mobile', mobileSeen);

    // owner-web + mobile subscribe to the bus.
    const stopOwner = await owner.store.connect(TENANT);
    const stopMobile = await mobile.store.connect(TENANT);

    // The MD makes a decision in chat.
    const written = await chat.store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'decision',
      value: { verdict: 'suspend-licence', evidenceId: 'ev-7' },
      actorId: 'brain:md',
      surface: 'chat',
    });

    expect(written.value).toEqual({
      verdict: 'suspend-licence',
      evidenceId: 'ev-7',
    });

    // Both subscribing surfaces converged to the SAME value.
    const onOwner = await owner.repository.get(TENANT, SLOT);
    const onMobile = await mobile.repository.get(TENANT, SLOT);
    expect(onOwner?.value).toEqual(written.value);
    expect(onMobile?.value).toEqual(written.value);
    expect(onOwner?.clock).toBe(written.clock);
    expect(onMobile?.writerId).toBe('brain:md');

    // onConverged fired on the subscribers (the re-projection hook).
    expect(ownerSeen.at(-1)?.value).toEqual(written.value);
    expect(mobileSeen.at(-1)?.value).toEqual(written.value);

    await stopOwner();
    await stopMobile();
  });

  it('does not echo its own writes (loop-suppression)', async () => {
    const realtime = createInMemoryRealtime();
    const ownerSeen: Slot[] = [];
    const owner = makeStore(realtime, 'owner-web', ownerSeen);
    await owner.store.connect(TENANT);

    await owner.store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'decision',
      value: { v: 1 },
      actorId: 'owner-web:s1',
      surface: 'owner-web',
    });

    // The local set fires onConverged once (persist). The broadcast it
    // emits is skipped on inbound because originSurface === 'owner-web',
    // so onConverged is NOT fired a second time from the echo.
    expect(ownerSeen.length).toBe(1);
  });

  it('concurrent cross-surface writes converge identically on every surface', async () => {
    const realtime = createInMemoryRealtime();
    const a = makeStore(realtime, 'owner-web', []);
    const b = makeStore(realtime, 'workforce-mobile', []);
    await a.store.connect(TENANT);
    await b.store.connect(TENANT);

    // Two writes from two surfaces; the second causally follows the first
    // once it's been merged into b's repo, so the bus converges.
    await a.store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'decision',
      value: { from: 'owner' },
      actorId: 'owner-web:s1',
      surface: 'owner-web',
    });
    await b.store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'decision',
      value: { from: 'mobile' },
      actorId: 'workforce-mobile:d2',
      surface: 'workforce-mobile',
    });

    const onA = await a.repository.get(TENANT, SLOT);
    const onB = await b.repository.get(TENANT, SLOT);
    // Both surfaces agree (convergence) — no divergence.
    expect(onA?.value).toEqual(onB?.value);
    expect(onA?.writerId).toBe(onB?.writerId);
    expect(onA?.clock).toBe(onB?.clock);
  });
});

describe('handoff — surface/device round-trip', () => {
  it('hands a live slot from chat to a mobile device and the target mounts it', async () => {
    const realtime = createInMemoryRealtime();
    const repository = createInMemorySlotsRepository();
    const store = createSlotStore({ repository, realtime, surface: 'chat' });
    const handoffSvc = createHandoffService({ repository, realtime });

    // Seed a live slot via chat.
    await store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'document',
      value: { title: 'royalty return', body: 'draft' },
      actorId: 'brain:md',
      surface: 'chat',
    });

    // Mobile listens for inbound handoffs.
    const inbound: HandoffProjection[] = [];
    const stop = await handoffSvc.onInbound(
      TENANT,
      'workforce-mobile',
      (p) => {
        inbound.push(p);
      },
    );

    // Hand the slot off from chat to a specific mobile device.
    const projection = await handoffSvc.handoff({
      tenantId: TENANT,
      slotId: SLOT,
      fromSurface: 'chat',
      toSurface: 'workforce-mobile',
      actorId: 'user:owner-1',
      toDevice: 'device-7',
    });

    // Returned projection carries the live slot value (lives once).
    expect(projection.slot.value).toEqual({
      title: 'royalty return',
      body: 'draft',
    });
    expect(projection.toDevice).toBe('device-7');
    expect(projection.provenance).toEqual(['chat', 'workforce-mobile']);

    // The mobile surface received the inbound handoff with the live slot.
    expect(inbound.length).toBe(1);
    expect(inbound[0]?.toSurface).toBe('workforce-mobile');
    expect(inbound[0]?.toDevice).toBe('device-7');
    expect(inbound[0]?.slot.value).toEqual({
      title: 'royalty return',
      body: 'draft',
    });
    expect(inbound[0]?.handedOffAt).toBeInstanceOf(Date);

    await stop();
  });

  it('only the targeted surface receives the handoff', async () => {
    const realtime = createInMemoryRealtime();
    const repository = createInMemorySlotsRepository();
    const store = createSlotStore({ repository, realtime, surface: 'chat' });
    const handoffSvc = createHandoffService({ repository, realtime });

    await store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'task',
      value: { todo: 'file return' },
      actorId: 'brain:md',
      surface: 'chat',
    });

    const buyerInbound: HandoffProjection[] = [];
    const ownerInbound: HandoffProjection[] = [];
    await handoffSvc.onInbound(TENANT, 'buyer-mobile', (p) =>
      buyerInbound.push(p),
    );
    await handoffSvc.onInbound(TENANT, 'owner-web', (p) =>
      ownerInbound.push(p),
    );

    await handoffSvc.handoff({
      tenantId: TENANT,
      slotId: SLOT,
      fromSurface: 'chat',
      toSurface: 'owner-web',
      actorId: 'user:owner-1',
    });

    expect(ownerInbound.length).toBe(1);
    expect(buyerInbound.length).toBe(0);
  });

  it('refuses to hand off a non-existent slot', async () => {
    const realtime = createInMemoryRealtime();
    const repository = createInMemorySlotsRepository();
    const handoffSvc = createHandoffService({ repository, realtime });
    await expect(
      handoffSvc.handoff({
        tenantId: TENANT,
        slotId: 'ghost',
        fromSurface: 'chat',
        toSurface: 'owner-web',
        actorId: 'user:1',
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('refuses to hand off a tombstoned slot', async () => {
    const realtime = createInMemoryRealtime();
    const repository = createInMemorySlotsRepository();
    const store = createSlotStore({ repository, realtime, surface: 'chat' });
    const handoffSvc = createHandoffService({ repository, realtime });

    await store.set({
      tenantId: TENANT,
      slotId: SLOT,
      slotKind: 'note',
      value: { v: 1 },
      actorId: 'a',
      surface: 'chat',
    });
    await store.remove({
      tenantId: TENANT,
      slotId: SLOT,
      actorId: 'a',
      surface: 'chat',
    });

    await expect(
      handoffSvc.handoff({
        tenantId: TENANT,
        slotId: SLOT,
        fromSurface: 'chat',
        toSurface: 'owner-web',
        actorId: 'a',
      }),
    ).rejects.toThrow(/tombstoned/);
  });
});
