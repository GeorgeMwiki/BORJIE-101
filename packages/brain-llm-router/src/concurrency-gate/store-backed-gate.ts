/**
 * concurrency-gate/store-backed-gate — multi-replica gate over a shared store.
 *
 * Wraps any `ConcurrencyStore` (Upstash in prod, in-memory in dev) in the same
 * `ConcurrencyGate` interface the in-memory gate exposes, so it is a drop-in
 * swap at the composition root.
 *
 * Acquire algorithm (ported from LITFIN's poll-with-backoff): the store has no
 * server-side queue, so waiters poll locally — try `store.tryAcquire`; on a
 * miss, sleep `delay + jitter` (exponential, capped) and retry until the
 * `timeoutMs` deadline, then throw `SlotAcquireTimeoutError`.
 *
 * OUTAGE FALLBACK (the LP-10 resilience requirement): if the shared store
 * *throws* (vs. a benign capacity-miss `false`), we do not fail the request —
 * we trip a short-lived breaker and serve acquires from a local
 * `InMemoryConcurrencyStore`. That degrades from cluster-wide to per-replica
 * capacity rather than dropping traffic, then auto-recovers after a cooldown.
 */

import {
  SlotAcquireTimeoutError,
  getDefaultTenantCapacity,
  type AcquireOptions,
  type ConcurrencyGate,
  type SlotRelease,
} from './concurrency-gate.js';
import { InMemoryConcurrencyStore, type ConcurrencyStore } from './store-port.js';

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_TTL_SECONDS = 300; // matches LITFIN BUCKET_TTL_SECONDS
const INITIAL_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 250;
const JITTER_MS = 25;
const DEFAULT_OUTAGE_COOLDOWN_MS = 10_000;

export interface StoreBackedGateOptions {
  /** Shared counter store (e.g. UpstashConcurrencyStore). */
  readonly store: ConcurrencyStore;
  /** TTL guard on a held slot, seconds. Default 300. */
  readonly ttlSeconds?: number;
  /** How long to keep serving from the local fallback after an outage, ms. */
  readonly outageCooldownMs?: number;
  /** Injectable clock + sleep for deterministic tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter [0,1) for deterministic tests. Default Math.random. */
  readonly random?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Build the store key. Pools share a counter; tenants are isolated. */
function storeKey(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Create a multi-replica concurrency gate backed by a shared store, with a
 * local in-memory fallback that engages on store outage.
 */
export function createStoreBackedGate(opts: StoreBackedGateOptions): ConcurrencyGate {
  const { store } = opts;
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const outageCooldownMs = opts.outageCooldownMs ?? DEFAULT_OUTAGE_COOLDOWN_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;

  // Local fallback engaged during a shared-store outage.
  const fallbackStore = new InMemoryConcurrencyStore(now);
  let fallbackUntilMs = 0;

  // Local in-flight count is best-effort observability only.
  const localInflight = new Map<string, number>();

  function inOutage(): boolean {
    return now() < fallbackUntilMs;
  }

  function tripOutage(): void {
    fallbackUntilMs = now() + outageCooldownMs;
  }

  /** Which store to use for THIS attempt, and whether it is the fallback. */
  function activeStore(): { store: ConcurrencyStore; isFallback: boolean } {
    return inOutage()
      ? { store: fallbackStore, isFallback: true }
      : { store, isFallback: false };
  }

  /**
   * One acquire attempt. Returns `granted`. A *thrown* store error trips the
   * outage breaker and is reported via `outaged` so the caller retries against
   * the fallback immediately (no wasted backoff).
   */
  async function attempt(
    key: string,
    capacity: number,
  ): Promise<{ granted: boolean; outaged: boolean }> {
    const active = activeStore();
    try {
      const granted = await active.store.tryAcquire(key, capacity, ttlSeconds);
      return { granted, outaged: false };
    } catch {
      // Only the *shared* store tripping matters; the in-memory fallback
      // never throws. Engage / extend the outage window and signal a retry.
      if (!active.isFallback) tripOutage();
      return { granted: false, outaged: true };
    }
  }

  function bumpLocal(key: string, delta: number): void {
    const next = (localInflight.get(key) ?? 0) + delta;
    if (next <= 0) localInflight.delete(key);
    else localInflight.set(key, next);
  }

  function makeRelease(key: string): SlotRelease {
    let released = false;
    return function release(): void {
      if (released) return;
      released = true;
      bumpLocal(key, -1);
      // Release against whichever store is currently active. Both clamp at
      // zero; a cross-store mismatch during the brief outage flip is bounded
      // by the TTL guard. Fire-and-forget keeps the caller's finally cheap.
      void activeStore().store.release(key);
    };
  }

  async function acquire(reqOpts: AcquireOptions): Promise<SlotRelease> {
    const capacity = reqOpts.capacity ?? getDefaultTenantCapacity();
    const timeoutMs = reqOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const key = storeKey(reqOpts.tenantId);
    const deadline = now() + timeoutMs;

    let delay = INITIAL_BACKOFF_MS;
    // Polling loop: exits on grant or on the deadline check.
    for (;;) {
      const { granted, outaged } = await attempt(key, capacity);
      if (granted) {
        bumpLocal(key, 1);
        return makeRelease(key);
      }

      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new SlotAcquireTimeoutError(reqOpts.tenantId, timeoutMs);
      }

      // On a fresh outage, retry immediately against the now-active fallback
      // (do not burn the backoff window waiting on a dead store).
      if (outaged) continue;

      const jitter = Math.floor(random() * JITTER_MS);
      const wait = Math.min(delay + jitter, remaining);
      await sleep(wait);
      delay = Math.min(delay * 2, MAX_BACKOFF_MS);
    }
  }

  function stats(): {
    tenantInflight: Readonly<Record<string, number>>;
    globalInflight: number;
    waiting: number;
  } {
    const snap: Record<string, number> = {};
    let total = 0;
    for (const [k, v] of localInflight) {
      const tenant = k.startsWith('tenant:') ? k.slice('tenant:'.length) : k;
      snap[tenant] = v;
      total += v;
    }
    // Waiters poll locally rather than queue; depth is not observable here.
    return { tenantInflight: snap, globalInflight: total, waiting: 0 };
  }

  return { acquire, stats };
}
