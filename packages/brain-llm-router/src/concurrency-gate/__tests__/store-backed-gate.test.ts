import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryConcurrencyStore,
  UpstashConcurrencyStore,
  createStoreBackedGate,
  ACQUIRE_LUA,
  RELEASE_LUA,
  SlotAcquireTimeoutError,
  type ConcurrencyStore,
  type RedisEvalPort,
} from '../index.js';

// ───────────────────────── InMemoryConcurrencyStore ─────────────────────────

describe('InMemoryConcurrencyStore', () => {
  it('admits up to capacity then refuses without incrementing', async () => {
    const s = new InMemoryConcurrencyStore();
    expect(await s.tryAcquire('t1', 2, 300)).toBe(true);
    expect(await s.tryAcquire('t1', 2, 300)).toBe(true);
    expect(await s.tryAcquire('t1', 2, 300)).toBe(false);
    expect(await s.current!('t1')).toBe(2);
  });

  it('release lowers the counter and clamps at zero', async () => {
    const s = new InMemoryConcurrencyStore();
    await s.tryAcquire('t1', 5, 300);
    await s.release('t1');
    await s.release('t1'); // extra release is a clamped no-op
    expect(await s.current!('t1')).toBe(0);
    // Slot is free again.
    expect(await s.tryAcquire('t1', 1, 300)).toBe(true);
  });

  it('honours the TTL guard (leaked acquire self-heals)', async () => {
    let t = 1_000;
    const s = new InMemoryConcurrencyStore(() => t);
    await s.tryAcquire('t1', 1, 1); // ttl = 1s
    expect(await s.tryAcquire('t1', 1, 1)).toBe(false); // full
    t += 1_001; // advance past TTL
    expect(await s.tryAcquire('t1', 1, 1)).toBe(true); // expired → free
  });

  it('treats capacity < 1 as 1', async () => {
    const s = new InMemoryConcurrencyStore();
    expect(await s.tryAcquire('t1', 0, 300)).toBe(true);
    expect(await s.tryAcquire('t1', 0, 300)).toBe(false);
  });

  it('isolates tenants', async () => {
    const s = new InMemoryConcurrencyStore();
    expect(await s.tryAcquire('a', 1, 300)).toBe(true);
    expect(await s.tryAcquire('b', 1, 300)).toBe(true); // different key
    expect(await s.tryAcquire('a', 1, 300)).toBe(false);
  });
});

// ───────────────────────── UpstashConcurrencyStore ─────────────────────────

describe('UpstashConcurrencyStore', () => {
  it('passes the ACQUIRE Lua + capacity/ttl args and grants on positive return', async () => {
    const evalFn = vi.fn(async () => 1);
    const port: RedisEvalPort = { eval: evalFn };
    const s = new UpstashConcurrencyStore({ eval: port, keyPrefix: 'p:' });
    const ok = await s.tryAcquire('t1', 8, 300);
    expect(ok).toBe(true);
    expect(evalFn).toHaveBeenCalledWith(ACQUIRE_LUA, ['p:t1'], ['8', '300']);
  });

  it('refuses when the Lua returns -1 (at capacity)', async () => {
    const port: RedisEvalPort = { eval: async () => -1 };
    const s = new UpstashConcurrencyStore({ eval: port });
    expect(await s.tryAcquire('t1', 1, 300)).toBe(false);
  });

  it('parses a string return value', async () => {
    const port: RedisEvalPort = { eval: async () => '3' };
    const s = new UpstashConcurrencyStore({ eval: port });
    expect(await s.tryAcquire('t1', 8, 300)).toBe(true);
  });

  it('treats a transport throw as a miss (does NOT grant on error)', async () => {
    const warn = vi.fn();
    const port: RedisEvalPort = {
      eval: async () => {
        throw new Error('network');
      },
    };
    const s = new UpstashConcurrencyStore({ eval: port, logger: { warn } });
    expect(await s.tryAcquire('t1', 8, 300)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('runs the RELEASE Lua and swallows transport errors', async () => {
    const evalFn = vi.fn(async () => 1);
    const port: RedisEvalPort = { eval: evalFn };
    const s = new UpstashConcurrencyStore({ eval: port });
    await s.release('t1');
    expect(evalFn).toHaveBeenCalledWith(RELEASE_LUA, ['borjie:llm:gate:t1'], []);

    const throwing = new UpstashConcurrencyStore({
      eval: { eval: async () => Promise.reject(new Error('down')) },
    });
    await expect(throwing.release('t1')).resolves.toBeUndefined();
  });
});

// ───────────────────────── createStoreBackedGate ─────────────────────────

describe('createStoreBackedGate', () => {
  const noSleep = async () => {};

  it('acquires and releases against the shared store (drop-in ConcurrencyGate)', async () => {
    const store = new InMemoryConcurrencyStore();
    const gate = createStoreBackedGate({ store, sleep: noSleep });
    const r1 = await gate.acquire({ tenantId: 't1', capacity: 2 });
    const r2 = await gate.acquire({ tenantId: 't1', capacity: 2 });
    expect(gate.stats().globalInflight).toBe(2);
    r1();
    expect(gate.stats().globalInflight).toBe(1);
    r2();
    expect(gate.stats().globalInflight).toBe(0);
  });

  it('enforces ONE cluster-wide cap across two gate instances sharing a store', async () => {
    // The whole point of LP-10: two replicas (two gates) + one store = one cap.
    const store = new InMemoryConcurrencyStore();
    const gateA = createStoreBackedGate({ store, sleep: noSleep });
    const gateB = createStoreBackedGate({ store, sleep: noSleep });
    const rA = await gateA.acquire({ tenantId: 't1', capacity: 1 });
    // gateB cannot acquire — the shared counter is already full.
    await expect(
      gateB.acquire({ tenantId: 't1', capacity: 1, timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(SlotAcquireTimeoutError);
    rA();
    // After release, gateB succeeds.
    const rB = await gateB.acquire({ tenantId: 't1', capacity: 1 });
    expect(rB).toBeTypeOf('function');
  });

  it('times out with SlotAcquireTimeoutError when no slot frees', async () => {
    let t = 0;
    const store = new InMemoryConcurrencyStore(() => t);
    const gate = createStoreBackedGate({
      store,
      now: () => t,
      sleep: async (ms) => {
        t += ms; // virtual time advances as we "sleep"
      },
      random: () => 0,
    });
    await gate.acquire({ tenantId: 't1', capacity: 1 });
    await expect(
      gate.acquire({ tenantId: 't1', capacity: 1, timeoutMs: 1_000 }),
    ).rejects.toBeInstanceOf(SlotAcquireTimeoutError);
    expect(t).toBeGreaterThanOrEqual(1_000);
  });

  it('falls back to a local in-memory store when the shared store throws', async () => {
    let t = 0;
    const flakyStore: ConcurrencyStore = {
      tryAcquire: async () => {
        throw new Error('redis down');
      },
      release: async () => {},
    };
    const gate = createStoreBackedGate({
      store: flakyStore,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      random: () => 0,
      outageCooldownMs: 10_000,
    });
    // Shared store throws → outage breaker trips → served by local fallback.
    const r = await gate.acquire({ tenantId: 't1', capacity: 1, timeoutMs: 2_000 });
    expect(r).toBeTypeOf('function');
    // Local fallback enforces its own cap during the outage window.
    await expect(
      gate.acquire({ tenantId: 't1', capacity: 1, timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(SlotAcquireTimeoutError);
  });

  it('recovers to the shared store after the outage cooldown elapses', async () => {
    let t = 0;
    let throwNext = true;
    const recoveringStore: ConcurrencyStore = {
      tryAcquire: async (_key, cap) => {
        if (throwNext) throw new Error('blip');
        return cap >= 1; // healthy
      },
      release: async () => {},
    };
    const gate = createStoreBackedGate({
      store: recoveringStore,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      random: () => 0,
      outageCooldownMs: 5_000,
    });
    // First acquire trips outage, served by fallback.
    await gate.acquire({ tenantId: 't1', capacity: 5, timeoutMs: 1_000 });
    // Store heals; advance past cooldown.
    throwNext = false;
    t += 6_000;
    const r = await gate.acquire({ tenantId: 't2', capacity: 5, timeoutMs: 1_000 });
    expect(r).toBeTypeOf('function');
  });
});
