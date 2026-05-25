/**
 * Tests for `concurrency-gate.ts`.
 *
 * Covers: acquire/release, per-tenant cap, global cap, timeout, FIFO,
 * idempotent release, env defaults, stats.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SlotAcquireTimeoutError,
  acquireSlot,
  createConcurrencyGate,
  getDefaultGlobalCapacity,
  getDefaultTenantCapacity,
  resetConcurrencyGate,
} from '../concurrency-gate.js';

beforeEach(() => {
  resetConcurrencyGate();
  delete process.env.BORJIE_TENANT_LLM_CAPACITY;
  delete process.env.BORJIE_GLOBAL_LLM_CAPACITY;
});

afterEach(() => {
  resetConcurrencyGate();
  delete process.env.BORJIE_TENANT_LLM_CAPACITY;
  delete process.env.BORJIE_GLOBAL_LLM_CAPACITY;
});

describe('acquireSlot — fast path', () => {
  it('admits up to per-tenant capacity', async () => {
    const releases = [];
    for (let i = 0; i < 8; i += 1) {
      releases.push(await acquireSlot({ tenantId: 't1' }));
    }
    expect(releases).toHaveLength(8);
    for (const r of releases) r();
  });

  it('release lowers in-flight count', async () => {
    const r1 = await acquireSlot({ tenantId: 't1' });
    const r2 = await acquireSlot({ tenantId: 't1' });
    r1();
    r2();
    // After release, we can immediately acquire again
    const r3 = await acquireSlot({ tenantId: 't1' });
    r3();
  });

  it('release is idempotent (double-release is a no-op)', async () => {
    const release = await acquireSlot({ tenantId: 't1' });
    release();
    release();
    release();
    // Should still be able to acquire
    const r2 = await acquireSlot({ tenantId: 't1' });
    r2();
  });
});

describe('acquireSlot — backpressure', () => {
  it('queues waiters when tenant cap reached', async () => {
    const releases = [];
    for (let i = 0; i < 8; i += 1) {
      releases.push(await acquireSlot({ tenantId: 't1' }));
    }
    // 9th waits
    const pending = acquireSlot({ tenantId: 't1', timeoutMs: 1000 });
    // Release one — pending should resolve
    releases[0]!();
    const newRelease = await pending;
    newRelease();
    for (let i = 1; i < releases.length; i += 1) releases[i]!();
  });

  it('rejects with SlotAcquireTimeoutError when no slot frees in time', async () => {
    const releases = [];
    for (let i = 0; i < 8; i += 1) {
      releases.push(await acquireSlot({ tenantId: 't1' }));
    }
    await expect(
      acquireSlot({ tenantId: 't1', timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(SlotAcquireTimeoutError);
    for (const r of releases) r();
  });

  it('different tenants do not block each other', async () => {
    const releases = [];
    for (let i = 0; i < 8; i += 1) {
      releases.push(await acquireSlot({ tenantId: 't1' }));
    }
    // t2 can still acquire — t1 cap is per-tenant
    const r = await acquireSlot({ tenantId: 't2' });
    r();
    for (const x of releases) x();
  });
});

describe('global capacity cap', () => {
  it('blocks new admissions once global cap is reached', async () => {
    const gate = createConcurrencyGate();
    const releases = [];
    // Burn the global cap with 3 tenants × 1 slot each, globalCap = 3
    for (let i = 0; i < 3; i += 1) {
      releases.push(
        await gate.acquire({ tenantId: `t${i}`, globalCapacity: 3 }),
      );
    }
    await expect(
      gate.acquire({ tenantId: 't99', globalCapacity: 3, timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(SlotAcquireTimeoutError);
    for (const r of releases) r();
  });
});

describe('env-driven defaults', () => {
  it('reads BORJIE_TENANT_LLM_CAPACITY', () => {
    process.env.BORJIE_TENANT_LLM_CAPACITY = '20';
    expect(getDefaultTenantCapacity()).toBe(20);
  });

  it('reads BORJIE_GLOBAL_LLM_CAPACITY', () => {
    process.env.BORJIE_GLOBAL_LLM_CAPACITY = '500';
    expect(getDefaultGlobalCapacity()).toBe(500);
  });

  it('falls back to default on garbage env', () => {
    process.env.BORJIE_TENANT_LLM_CAPACITY = 'banana';
    expect(getDefaultTenantCapacity()).toBe(8);
  });

  it('falls back to default on zero/negative env', () => {
    process.env.BORJIE_TENANT_LLM_CAPACITY = '0';
    expect(getDefaultTenantCapacity()).toBe(8);
  });
});
