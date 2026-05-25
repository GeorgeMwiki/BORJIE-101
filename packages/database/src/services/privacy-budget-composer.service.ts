/**
 * privacy-budget-composer.service.ts — unified (ε, δ) ledger composer
 * for K6.2 (parity-gap G2).
 *
 * Today BOSS has TWO ledgers:
 *   • `platform_privacy_budget` — singleton, platform-wide cohort spend
 *     consumed by `dp-aggregator.ts`.
 *   • per-tenant `PrivacyBudgetLedger` in `@borjie/ai-copilot/dp-memory`
 *     — consumed by `cross-tenant-query.ts`.
 *
 * Independently the two are safe; together an attacker who alternates
 * between cross-tenant queries (debits per-tenant) and platform cohort
 * queries (debits platform) can compound effective ε without either
 * ledger noticing. This composer is the SINGLE refusal gate that the
 * api-gateway should consult before either underlying ledger reserves.
 *
 * Capacity model
 * ──────────────
 * Hard tier caps per tenant per 30-day rolling window:
 *   • PLATFORM   tier: (ε=5.0,  δ=1e-5)
 *   • PRO        tier: (ε=10.0, δ=1e-5)
 *   • ENTERPRISE tier: (ε=50.0, δ=1e-5)
 *
 * The composer is intentionally tier-derived — bumping a tenant's plan
 * is reflected at the next window boundary; no migration / backfill.
 *
 * Concurrency
 * ───────────
 * `recordSpend` performs an atomic increment via the repository port.
 * The Drizzle-backed adapter uses an INSERT … ON CONFLICT … DO UPDATE
 * with `spent_epsilon = privacy_budget_ledger.spent_epsilon + EXCLUDED`
 * so concurrent callers cannot race the read-modify-write. The
 * in-memory adapter uses a Map.set under a single-promise lock.
 *
 * Immutability
 * ────────────
 * Every public method returns a fresh value. Inputs are never mutated.
 * Outputs are plain JSON-friendly records, no opaque handles.
 */

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export type PrivacyBudgetTier = 'platform' | 'pro' | 'enterprise';

/** Window length — 30 calendar days. Caps and rolling window align. */
export const PRIVACY_BUDGET_WINDOW_DAYS = 30;

/** Hard tier caps. Frozen — composition root must not mutate. */
export const PRIVACY_BUDGET_TIER_CAPS: Readonly<
  Record<PrivacyBudgetTier, { readonly epsilon: number; readonly delta: number }>
> = Object.freeze({
  platform: Object.freeze({ epsilon: 5.0, delta: 1e-5 }),
  pro: Object.freeze({ epsilon: 10.0, delta: 1e-5 }),
  enterprise: Object.freeze({ epsilon: 50.0, delta: 1e-5 }),
});

/** Tolerance for floating-point comparisons. */
const EPS_TOLERANCE = 1e-9;

export interface PrivacyBudgetWindow {
  readonly tenantId: string;
  readonly tier: PrivacyBudgetTier;
  /** ISO timestamp of the 30-day window start. */
  readonly windowStart: string;
  readonly totalEpsilon: number;
  readonly totalDelta: number;
  readonly spentEpsilon: number;
  readonly spentDelta: number;
}

export interface RemainingBudget {
  readonly tenantId: string;
  readonly tier: PrivacyBudgetTier;
  readonly windowStart: string;
  readonly totalEpsilon: number;
  readonly totalDelta: number;
  readonly spentEpsilon: number;
  readonly spentDelta: number;
  readonly remainingEpsilon: number;
  readonly remainingDelta: number;
}

export interface RecordSpendArgs {
  readonly tenantId: string;
  readonly tier: PrivacyBudgetTier;
  readonly epsilon: number;
  readonly delta: number;
  readonly queryId: string;
}

export interface CheckBudgetArgs {
  readonly tenantId: string;
  readonly tier: PrivacyBudgetTier;
  readonly requestedEpsilon: number;
  readonly requestedDelta: number;
}

export interface BudgetAvailability {
  readonly ok: boolean;
  /** Discriminated reason on refusal. `null` on success. */
  readonly reason:
    | 'epsilon-exhausted'
    | 'delta-exhausted'
    | 'invalid-input'
    | null;
  readonly remainingEpsilon: number;
  readonly remainingDelta: number;
}

export class PrivacyBudgetExceededError extends Error {
  readonly tenantId: string;
  readonly requestedEpsilon: number;
  readonly remainingEpsilon: number;
  constructor(tenantId: string, requestedEpsilon: number, remainingEpsilon: number) {
    super(
      `Privacy budget exceeded for tenant ${tenantId}: requested ε=${requestedEpsilon}, remaining ε=${remainingEpsilon}`,
    );
    this.name = 'PrivacyBudgetExceededError';
    this.tenantId = tenantId;
    this.requestedEpsilon = requestedEpsilon;
    this.remainingEpsilon = remainingEpsilon;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Repository port. Drizzle adapter lives in the composition root; the
// in-memory default ships with the package for dev + tests.
// ─────────────────────────────────────────────────────────────────────

export interface PrivacyBudgetRepository {
  /**
   * Read (or lazily insert) the current 30-day window row for the
   * given tenant. Returns the persisted state.
   */
  upsertWindow(args: {
    readonly tenantId: string;
    readonly tier: PrivacyBudgetTier;
    readonly windowStart: string;
    readonly totalEpsilon: number;
    readonly totalDelta: number;
  }): Promise<PrivacyBudgetWindow>;

  /**
   * Atomic increment of the spend totals for the (tenant, window) row.
   * Implementation MUST be atomic w.r.t. concurrent callers — use
   * `UPDATE … SET spent_epsilon = spent_epsilon + $1` in Drizzle.
   * Appends a row to the audit log keyed by `queryId`.
   */
  appendSpend(args: {
    readonly tenantId: string;
    readonly windowStart: string;
    readonly tier: PrivacyBudgetTier;
    readonly epsilon: number;
    readonly delta: number;
    readonly queryId: string;
  }): Promise<PrivacyBudgetWindow>;

  /** Peek without writing. Returns null if the window has not been opened. */
  peek(args: {
    readonly tenantId: string;
    readonly windowStart: string;
  }): Promise<PrivacyBudgetWindow | null>;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory adapter — production callers swap with a Drizzle adapter.
// ─────────────────────────────────────────────────────────────────────

export class InMemoryPrivacyBudgetRepository implements PrivacyBudgetRepository {
  private readonly windows = new Map<string, PrivacyBudgetWindow>();
  private readonly seenQueryIds = new Set<string>();
  private lock: Promise<void> = Promise.resolve();

  async upsertWindow(args: {
    readonly tenantId: string;
    readonly tier: PrivacyBudgetTier;
    readonly windowStart: string;
    readonly totalEpsilon: number;
    readonly totalDelta: number;
  }): Promise<PrivacyBudgetWindow> {
    return this.serialised(async () => {
      const key = windowKey(args.tenantId, args.windowStart);
      const existing = this.windows.get(key);
      if (existing) return { ...existing };
      const fresh: PrivacyBudgetWindow = Object.freeze({
        tenantId: args.tenantId,
        tier: args.tier,
        windowStart: args.windowStart,
        totalEpsilon: args.totalEpsilon,
        totalDelta: args.totalDelta,
        spentEpsilon: 0,
        spentDelta: 0,
      });
      this.windows.set(key, fresh);
      return { ...fresh };
    });
  }

  async appendSpend(args: {
    readonly tenantId: string;
    readonly windowStart: string;
    readonly tier: PrivacyBudgetTier;
    readonly epsilon: number;
    readonly delta: number;
    readonly queryId: string;
  }): Promise<PrivacyBudgetWindow> {
    return this.serialised(async () => {
      const key = windowKey(args.tenantId, args.windowStart);
      const current = this.windows.get(key);
      if (!current) {
        throw new Error(
          `privacy-budget-composer: window not opened for tenant ${args.tenantId} @ ${args.windowStart}`,
        );
      }
      // Idempotency: if this queryId already spent, return the current state.
      if (this.seenQueryIds.has(args.queryId)) {
        return { ...current };
      }
      this.seenQueryIds.add(args.queryId);
      const next: PrivacyBudgetWindow = Object.freeze({
        ...current,
        spentEpsilon: current.spentEpsilon + args.epsilon,
        spentDelta: current.spentDelta + args.delta,
      });
      this.windows.set(key, next);
      return { ...next };
    });
  }

  async peek(args: {
    readonly tenantId: string;
    readonly windowStart: string;
  }): Promise<PrivacyBudgetWindow | null> {
    const found = this.windows.get(windowKey(args.tenantId, args.windowStart));
    return found ? { ...found } : null;
  }

  private serialised<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Composer service.
// ─────────────────────────────────────────────────────────────────────

export interface PrivacyBudgetComposerConfig {
  readonly repository?: PrivacyBudgetRepository;
  readonly now?: () => Date;
  /** Override the tier-cap table — useful for tests. Defaults to PRIVACY_BUDGET_TIER_CAPS. */
  readonly tierCaps?: typeof PRIVACY_BUDGET_TIER_CAPS;
}

export interface PrivacyBudgetComposerService {
  getRemainingBudget(args: {
    readonly tenantId: string;
    readonly tier: PrivacyBudgetTier;
    /** Optional pin — useful for tests. Defaults to current rolling window. */
    readonly windowStart?: string;
  }): Promise<RemainingBudget>;

  checkBudgetAvailable(args: CheckBudgetArgs): Promise<BudgetAvailability>;

  recordSpend(args: RecordSpendArgs): Promise<RemainingBudget>;
}

export function createPrivacyBudgetComposerService(
  config: PrivacyBudgetComposerConfig = {},
): PrivacyBudgetComposerService {
  const repository = config.repository ?? new InMemoryPrivacyBudgetRepository();
  const now = config.now ?? (() => new Date());
  const tierCaps = config.tierCaps ?? PRIVACY_BUDGET_TIER_CAPS;

  function currentWindowStart(at: Date = now()): string {
    return computeWindowStart(at);
  }

  return {
    async getRemainingBudget({ tenantId, tier, windowStart }) {
      assertTenantId(tenantId);
      assertTier(tier);
      const caps = tierCaps[tier];
      const ws = windowStart ?? currentWindowStart();
      const window = await repository.upsertWindow({
        tenantId,
        tier,
        windowStart: ws,
        totalEpsilon: caps.epsilon,
        totalDelta: caps.delta,
      });
      return toRemaining(window);
    },

    async checkBudgetAvailable({ tenantId, tier, requestedEpsilon, requestedDelta }) {
      assertTenantId(tenantId);
      assertTier(tier);
      if (!Number.isFinite(requestedEpsilon) || requestedEpsilon <= 0) {
        return refusal('invalid-input', 0, 0);
      }
      if (!Number.isFinite(requestedDelta) || requestedDelta < 0) {
        return refusal('invalid-input', 0, 0);
      }
      const caps = tierCaps[tier];
      const ws = currentWindowStart();
      const window = await repository.upsertWindow({
        tenantId,
        tier,
        windowStart: ws,
        totalEpsilon: caps.epsilon,
        totalDelta: caps.delta,
      });
      const remainingEpsilon = window.totalEpsilon - window.spentEpsilon;
      const remainingDelta = window.totalDelta - window.spentDelta;
      if (requestedEpsilon > remainingEpsilon + EPS_TOLERANCE) {
        return refusal('epsilon-exhausted', remainingEpsilon, remainingDelta);
      }
      if (requestedDelta > remainingDelta + EPS_TOLERANCE) {
        return refusal('delta-exhausted', remainingEpsilon, remainingDelta);
      }
      return {
        ok: true,
        reason: null,
        remainingEpsilon,
        remainingDelta,
      };
    },

    async recordSpend({ tenantId, tier, epsilon, delta, queryId }) {
      assertTenantId(tenantId);
      assertTier(tier);
      if (!queryId || typeof queryId !== 'string') {
        throw new Error('recordSpend: queryId is required');
      }
      if (!Number.isFinite(epsilon) || epsilon <= 0) {
        throw new Error(`recordSpend: epsilon must be > 0, got ${epsilon}`);
      }
      if (!Number.isFinite(delta) || delta < 0) {
        throw new Error(`recordSpend: delta must be >= 0, got ${delta}`);
      }
      const caps = tierCaps[tier];
      const ws = currentWindowStart();
      // Ensure the window exists; upsert is idempotent.
      await repository.upsertWindow({
        tenantId,
        tier,
        windowStart: ws,
        totalEpsilon: caps.epsilon,
        totalDelta: caps.delta,
      });
      // Pre-check before write — refuse rather than blow past the cap.
      const peek = await repository.peek({ tenantId, windowStart: ws });
      const peekSpentEps = peek?.spentEpsilon ?? 0;
      const remainingEpsilon = caps.epsilon - peekSpentEps;
      if (epsilon > remainingEpsilon + EPS_TOLERANCE) {
        throw new PrivacyBudgetExceededError(tenantId, epsilon, remainingEpsilon);
      }
      const next = await repository.appendSpend({
        tenantId,
        windowStart: ws,
        tier,
        epsilon,
        delta,
        queryId,
      });
      return toRemaining(next);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers (pure).
// ─────────────────────────────────────────────────────────────────────

function assertTenantId(t: string): void {
  if (!t || typeof t !== 'string') {
    throw new Error('privacy-budget-composer: tenantId is required');
  }
}

function assertTier(tier: PrivacyBudgetTier): void {
  if (tier !== 'platform' && tier !== 'pro' && tier !== 'enterprise') {
    throw new Error(
      `privacy-budget-composer: unknown tier ${String(tier)} (expected platform|pro|enterprise)`,
    );
  }
}

function refusal(
  reason: 'epsilon-exhausted' | 'delta-exhausted' | 'invalid-input',
  remainingEpsilon: number,
  remainingDelta: number,
): BudgetAvailability {
  return { ok: false, reason, remainingEpsilon, remainingDelta };
}

function toRemaining(w: PrivacyBudgetWindow): RemainingBudget {
  const remainingEpsilon = Math.max(0, w.totalEpsilon - w.spentEpsilon);
  const remainingDelta = Math.max(0, w.totalDelta - w.spentDelta);
  return {
    tenantId: w.tenantId,
    tier: w.tier,
    windowStart: w.windowStart,
    totalEpsilon: w.totalEpsilon,
    totalDelta: w.totalDelta,
    spentEpsilon: w.spentEpsilon,
    spentDelta: w.spentDelta,
    remainingEpsilon,
    remainingDelta,
  };
}

function windowKey(tenantId: string, windowStart: string): string {
  return `${tenantId}::${windowStart}`;
}

/**
 * Rolling 30-day window. Start = `at` floored to the day, then walked
 * back to a deterministic anchor every PRIVACY_BUDGET_WINDOW_DAYS. We
 * use the Unix epoch as the anchor so two callers in the same window
 * always see the same `windowStart` value.
 */
function computeWindowStart(at: Date): string {
  const ms = at.getTime();
  if (!Number.isFinite(ms)) {
    throw new Error('privacy-budget-composer: now() returned invalid Date');
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const windowMs = PRIVACY_BUDGET_WINDOW_DAYS * dayMs;
  const windowsSinceEpoch = Math.floor(ms / windowMs);
  return new Date(windowsSinceEpoch * windowMs).toISOString();
}
