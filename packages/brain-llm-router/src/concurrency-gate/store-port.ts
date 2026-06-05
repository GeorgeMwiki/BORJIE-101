/**
 * concurrency-gate/store-port — the atomic counter store behind the gate.
 *
 * The in-memory `ConcurrencyGate` (concurrency-gate.ts) keeps its counters in a
 * process-local Map. That is correct on one replica but fragments across
 * replicas — each instance enforces its own cap, so the *effective* per-tenant
 * limit silently multiplies by the replica count. LP-10 closes that by routing
 * the counter through an injected, shared `ConcurrencyStore` (Redis/Upstash in
 * prod) while keeping a pure in-memory store as the dev default.
 *
 * The store exposes exactly two atomic operations — `tryAcquire` (check-cap +
 * INCR + set-TTL in one indivisible step) and `release` (clamped DECR). All the
 * queueing / backoff / fallback lives in `store-backed-gate.ts`; the store is a
 * dumb, swappable counter.
 *
 * Ports inject the transport (no direct redis/fetch import in leaf logic).
 */

export interface ConcurrencyStore {
  /**
   * Atomically: if the counter for `key` is `< capacity`, increment it, set a
   * `ttlSeconds` expiry guard, and return `true`. Otherwise return `false`
   * WITHOUT incrementing. Must be a single indivisible operation (Redis Lua
   * eval / SET NX semantics) so two acquirers cannot race the check→incr gap.
   *
   * Should resolve `false` on any backend error rather than throw — the gate
   * treats a rejected/false result as a miss and retries until timeout. (The
   * Upstash adapter returns `false` on network blips; the gate's outage
   * fallback catches *thrown* errors for the harder failure mode.)
   */
  tryAcquire(key: string, capacity: number, ttlSeconds: number): Promise<boolean>;

  /** Decrement the counter for `key`, clamped at zero. Best-effort. */
  release(key: string): Promise<void>;

  /** Best-effort current value (observability only; 0 if unknown). */
  current?(key: string): Promise<number>;
}

// ─────────────────────── In-memory store (dev default) ───────────────────────

interface Counter {
  value: number;
  expiresAtMs: number;
}

/**
 * Pure in-memory `ConcurrencyStore`. Single-replica only — this is the dev /
 * test / fallback backend. TTL is honoured so a leaked acquire (release never
 * called) self-heals exactly like the Redis key would.
 *
 * Construct a fresh instance per gate (no module-level shared state).
 */
export class InMemoryConcurrencyStore implements ConcurrencyStore {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private liveValue(key: string): number {
    const c = this.counters.get(key);
    if (!c) return 0;
    if (c.expiresAtMs <= this.now()) {
      this.counters.delete(key);
      return 0;
    }
    return c.value;
  }

  async tryAcquire(key: string, capacity: number, ttlSeconds: number): Promise<boolean> {
    const cap = Math.max(1, capacity);
    const current = this.liveValue(key);
    if (current >= cap) return false;
    this.counters.set(key, {
      value: current + 1,
      expiresAtMs: this.now() + ttlSeconds * 1_000,
    });
    return true;
  }

  async release(key: string): Promise<void> {
    const c = this.counters.get(key);
    if (!c) return;
    const next = c.value - 1;
    if (next <= 0) {
      this.counters.delete(key);
    } else {
      this.counters.set(key, { value: next, expiresAtMs: c.expiresAtMs });
    }
  }

  async current(key: string): Promise<number> {
    return this.liveValue(key);
  }

  /** Test helper — wipe all counters. */
  reset(): void {
    this.counters.clear();
  }
}
