/**
 * Per-tenant concurrency gate — caps in-flight LLM calls per tenant
 * and globally, to prevent a single noisy tenant from burning the
 * org-wide RPM quota.
 *
 * Ported from LITFIN `acquireSlot({bankId, capacity, timeoutMs})`.
 *
 * Defaults:
 *   - per-tenant: 8 in-flight (env: `BORJIE_TENANT_LLM_CAPACITY`)
 *   - global:   200 in-flight (env: `BORJIE_GLOBAL_LLM_CAPACITY`)
 *   - timeout:  5_000 ms
 *
 * Critical streaming pattern:
 *
 *     const release = await acquireSlot({ tenantId })
 *     try {
 *       for await (const chunk of streamLLM()) yield chunk
 *     } finally {
 *       release()  // ALWAYS release, even on abort
 *     }
 *
 * Backpressure: callers waiting for a slot are queued. When the gate
 * releases a slot, the oldest waiter is resolved. Waiters that exceed
 * `timeoutMs` reject with `SlotAcquireTimeoutError`.
 *
 * State is module-scoped so all callers share the same gate. Test
 * helper `resetConcurrencyGate()` wipes both maps + waiter queue.
 */

// ───────────────────────── Types + errors ──────────────────────────

export class SlotAcquireTimeoutError extends Error {
  public readonly tenantId: string;
  public readonly timeoutMs: number;
  constructor(tenantId: string, timeoutMs: number) {
    super(
      `[concurrency-gate] tenant=${tenantId} timed out after ${timeoutMs}ms ` +
        `waiting for an LLM slot`,
    );
    this.name = 'SlotAcquireTimeoutError';
    this.tenantId = tenantId;
    this.timeoutMs = timeoutMs;
  }
}

export interface AcquireOptions {
  readonly tenantId: string;
  /** Override per-tenant capacity (default from env). */
  readonly capacity?: number;
  /** Max ms to wait for a slot. Default 5000. */
  readonly timeoutMs?: number;
  /** Override global capacity (rarely needed). */
  readonly globalCapacity?: number;
}

/** Calling `release()` more than once is a no-op. */
export type SlotRelease = () => void;

export interface ConcurrencyGate {
  acquire(opts: AcquireOptions): Promise<SlotRelease>;
  /** Read-only stats for observability. */
  stats(): {
    tenantInflight: Readonly<Record<string, number>>;
    globalInflight: number;
    waiting: number;
  };
}

// ──────────────────────── Env-driven defaults ──────────────────────

function readPositiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function getDefaultTenantCapacity(): number {
  return readPositiveIntFromEnv('BORJIE_TENANT_LLM_CAPACITY', 8);
}

export function getDefaultGlobalCapacity(): number {
  return readPositiveIntFromEnv('BORJIE_GLOBAL_LLM_CAPACITY', 200);
}

const DEFAULT_TIMEOUT_MS = 5_000;

// ──────────────────────── Implementation ──────────────────────────

interface Waiter {
  readonly tenantId: string;
  readonly resolve: (release: SlotRelease) => void;
  readonly reject: (err: Error) => void;
  readonly enqueuedAtMs: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
}

function createGate(): ConcurrencyGate {
  const tenantInflight = new Map<string, number>();
  let globalInflight = 0;
  const waiters: Waiter[] = [];

  function effectiveCapacity(opts: AcquireOptions): {
    tenantCap: number;
    globalCap: number;
  } {
    return {
      tenantCap: opts.capacity ?? getDefaultTenantCapacity(),
      globalCap: opts.globalCapacity ?? getDefaultGlobalCapacity(),
    };
  }

  function tryAdmit(opts: AcquireOptions): SlotRelease | null {
    const { tenantCap, globalCap } = effectiveCapacity(opts);
    const current = tenantInflight.get(opts.tenantId) ?? 0;
    if (current >= tenantCap) return null;
    if (globalInflight >= globalCap) return null;
    tenantInflight.set(opts.tenantId, current + 1);
    globalInflight += 1;
    return makeReleaseFn(opts.tenantId);
  }

  function makeReleaseFn(tenantId: string): SlotRelease {
    let released = false;
    return function release(): void {
      if (released) return;
      released = true;
      const count = tenantInflight.get(tenantId) ?? 0;
      const nextCount = Math.max(0, count - 1);
      if (nextCount === 0) {
        tenantInflight.delete(tenantId);
      } else {
        tenantInflight.set(tenantId, nextCount);
      }
      globalInflight = Math.max(0, globalInflight - 1);
      // Wake oldest waiter that fits.
      drainWaiters();
    };
  }

  function drainWaiters(): void {
    // Walk waiters FIFO; admit those who can now fit.
    for (let i = 0; i < waiters.length; i += 1) {
      const w = waiters[i]!;
      const release = tryAdmit({ tenantId: w.tenantId });
      if (!release) continue;
      // Remove from queue
      waiters.splice(i, 1);
      i -= 1;
      if (w.timeoutHandle) clearTimeout(w.timeoutHandle);
      w.resolve(release);
      // Continue draining — globalCap may still allow another waiter.
    }
  }

  async function acquire(opts: AcquireOptions): Promise<SlotRelease> {
    // Fast path — slot available immediately.
    const release = tryAdmit(opts);
    if (release) return release;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise<SlotRelease>((resolve, reject) => {
      const waiter: Waiter = {
        tenantId: opts.tenantId,
        resolve,
        reject,
        enqueuedAtMs: Date.now(),
        timeoutHandle: null,
      };
      waiter.timeoutHandle = setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new SlotAcquireTimeoutError(opts.tenantId, timeoutMs));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  function stats(): {
    tenantInflight: Readonly<Record<string, number>>;
    globalInflight: number;
    waiting: number;
  } {
    const snap: Record<string, number> = {};
    for (const [k, v] of tenantInflight) snap[k] = v;
    return {
      tenantInflight: snap,
      globalInflight,
      waiting: waiters.length,
    };
  }

  function reset(): void {
    tenantInflight.clear();
    globalInflight = 0;
    while (waiters.length > 0) {
      const w = waiters.pop()!;
      if (w.timeoutHandle) clearTimeout(w.timeoutHandle);
      w.reject(new Error('[concurrency-gate] reset() called'));
    }
  }

  return Object.assign({ acquire, stats }, { __reset: reset });
}

const defaultGate = createGate();

// ───────────────────────── Public API ─────────────────────────────

export function acquireSlot(opts: AcquireOptions): Promise<SlotRelease> {
  return defaultGate.acquire(opts);
}

export function createConcurrencyGate(): ConcurrencyGate {
  return createGate();
}

export function resetConcurrencyGate(): void {
  (defaultGate as ConcurrencyGate & { __reset: () => void }).__reset();
}
