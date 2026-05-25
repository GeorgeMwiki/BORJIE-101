/**
 * BORJIE AI cost circuit breaker — Wave-11 AI security hardening.
 *
 * Tighter than the Wave-10 budget guard:
 *   - Wave-10 budget-guard short-circuits on MONTHLY budget cap.
 *   - This breaker protects against short-horizon failure modes:
 *       * N consecutive failed turns (bad prompt, upstream errors, loops)
 *       * Spend rate > X microdollars / minute
 *
 * States:
 *   closed     → all calls flow
 *   open       → calls rejected until cooldown elapses
 *   half_open  → one trial call permitted; result decides closed vs open
 *
 * The breaker is pure in the sense that it has no I/O — it reads a monotonic
 * clock and an injected cost-ledger summary function. Callers coordinate with
 * `cost-ledger.ts` via the optional `getRecentSpend` hook.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface BreakerPolicy {
  readonly maxConsecutiveFailures: number;
  readonly spendRatePerMinuteMicro: number;
  readonly cooldownMs: number;
  readonly windowMs: number;
}

export interface BreakerDecision {
  readonly allowed: boolean;
  readonly state: CircuitState;
  readonly reason?: string;
  readonly cooldownRemainingMs?: number;
}

export interface BreakerSnapshot {
  readonly tenantId: string;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly openedAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
}

export interface RecentSpend {
  readonly spentUsdMicro: number;
  readonly windowMs: number;
}

export interface CostCircuitBreakerDeps {
  readonly policy?: Partial<BreakerPolicy>;
  readonly now?: () => number;
  readonly getRecentSpend?: (tenantId: string, windowMs: number) => Promise<RecentSpend>;
}

export interface CostCircuitBreaker {
  allow(tenantId: string): Promise<BreakerDecision>;
  recordSuccess(tenantId: string): void;
  recordFailure(tenantId: string, reason?: string): void;
  snapshot(tenantId: string): BreakerSnapshot;
  reset(tenantId?: string): void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_POLICY: BreakerPolicy = Object.freeze({
  maxConsecutiveFailures: 5,
  // 1 USD/minute default trip rate.
  spendRatePerMinuteMicro: 1_000_000,
  cooldownMs: 60_000,
  windowMs: 60_000,
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface MutableState {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

function freshState(): MutableState {
  return {
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

export function createCostCircuitBreaker(
  deps: CostCircuitBreakerDeps = {},
): CostCircuitBreaker {
  const policy: BreakerPolicy = { ...DEFAULT_POLICY, ...(deps.policy ?? {}) };
  const now = deps.now ?? (() => Date.now());
  const getRecentSpend = deps.getRecentSpend;
  const store: Map<string, MutableState> = new Map();

  function get(tenantId: string): MutableState {
    let s = store.get(tenantId);
    if (!s) {
      s = freshState();
      store.set(tenantId, s);
    }
    return s;
  }

  function maybeHalfOpen(tenantId: string): void {
    const s = get(tenantId);
    if (s.state !== 'open' || s.openedAt === null) return;
    const elapsed = now() - s.openedAt;
    if (elapsed >= policy.cooldownMs) {
      s.state = 'half_open';
    }
  }

  return {
    async allow(tenantId) {
      if (!tenantId) throw new Error('cost-circuit-breaker: tenantId required');
      maybeHalfOpen(tenantId);
      const s = get(tenantId);

      if (s.state === 'open' && s.openedAt !== null) {
        const remaining = Math.max(0, policy.cooldownMs - (now() - s.openedAt));
        return {
          allowed: false,
          state: 'open',
          reason: 'circuit_open',
          cooldownRemainingMs: remaining,
        };
      }

      if (getRecentSpend) {
        const spend = await getRecentSpend(tenantId, policy.windowMs);
        const minutesInWindow = spend.windowMs / 60_000;
        if (minutesInWindow > 0) {
          const rate = spend.spentUsdMicro / minutesInWindow;
          if (rate > policy.spendRatePerMinuteMicro) {
            s.state = 'open';
            s.openedAt = now();
            return {
              allowed: false,
              state: 'open',
              reason: `spend_rate_exceeded:${Math.round(rate)}_micro_per_min`,
              cooldownRemainingMs: policy.cooldownMs,
            };
          }
        }
      }

      return { allowed: true, state: s.state };
    },

    recordSuccess(tenantId) {
      // Round-3 audit M9 — `allow` already rejects empty tenantId, but
      // `recordSuccess` and `recordFailure` previously accepted any
      // string (including ''). The empty-tenant row then accumulated
      // forever as a global bookkeeping bucket. Reject the same way.
      if (!tenantId) {
        throw new Error('cost-circuit-breaker: tenantId required');
      }
      const s = get(tenantId);
      s.consecutiveFailures = 0;
      s.lastSuccessAt = now();
      if (s.state === 'half_open' || s.state === 'open') {
        s.state = 'closed';
        s.openedAt = null;
      }
    },

    recordFailure(tenantId, _reason) {
      // Round-3 audit M9 — see `recordSuccess` above. Same guard.
      if (!tenantId) {
        throw new Error('cost-circuit-breaker: tenantId required');
      }
      const s = get(tenantId);
      s.consecutiveFailures += 1;
      s.lastFailureAt = now();
      if (s.state === 'half_open') {
        s.state = 'open';
        s.openedAt = now();
        return;
      }
      if (s.consecutiveFailures >= policy.maxConsecutiveFailures) {
        s.state = 'open';
        s.openedAt = now();
      }
    },

    snapshot(tenantId) {
      const s = get(tenantId);
      return {
        tenantId,
        state: s.state,
        consecutiveFailures: s.consecutiveFailures,
        openedAt: s.openedAt,
        lastSuccessAt: s.lastSuccessAt,
        lastFailureAt: s.lastFailureAt,
      };
    },

    reset(tenantId) {
      if (tenantId) {
        store.set(tenantId, freshState());
      } else {
        store.clear();
      }
    },
  };
}
