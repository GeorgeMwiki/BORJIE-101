/**
 * Daily revival counter — tracks per-day revival-attempt totals for the
 * platform-wide retry budget (founder decision #5: 50/day).
 *
 * One row per (attempted_on, tenant_id) — `tenant_id IS NULL` is the
 * platform-wide aggregate. The decider reads "today's count" before
 * permitting a new attempt; when count >= `DAILY_REVIVAL_BUDGET`, the
 * wave is marked unrecoverable with reason `daily_budget_exhausted`.
 *
 * Production wires a Drizzle-backed adapter against the
 * `daily_revival_counters` table (migration 0032). Tests + degraded
 * mode use the in-memory implementation here.
 */

/** Return today's date in UTC as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface DailyCounterRepository {
  /**
   * Count of revival attempts recorded today (UTC), aggregated across
   * all tenants when `tenant_id` is undefined.
   */
  getTodayAttemptCount(tenant_id?: string | null): Promise<number>;
  /** Atomic increment of today's counter. Returns the new value. */
  incrementToday(tenant_id?: string | null): Promise<number>;
}

interface CounterKey {
  readonly date: string;
  readonly tenantId: string | null;
}

function keyOf(k: CounterKey): string {
  return `${k.date}|${k.tenantId ?? ''}`;
}

export function createInMemoryDailyCounterRepository(opts?: {
  readonly now?: () => Date;
}): DailyCounterRepository & {
  readonly snapshot: () => ReadonlyArray<{
    readonly date: string;
    readonly tenant_id: string | null;
    readonly count: number;
  }>;
} {
  const counts = new Map<string, number>();
  const meta = new Map<string, CounterKey>();
  const now = opts?.now ?? (() => new Date());

  function bumpKey(tenant_id: string | null | undefined): {
    readonly key: string;
    readonly meta: CounterKey;
  } {
    const k: CounterKey = { date: todayUtc(now()), tenantId: tenant_id ?? null };
    const key = keyOf(k);
    return { key, meta: k };
  }

  return {
    snapshot() {
      const out: Array<{
        date: string;
        tenant_id: string | null;
        count: number;
      }> = [];
      for (const [key, count] of counts.entries()) {
        const m = meta.get(key);
        if (!m) continue;
        out.push({ date: m.date, tenant_id: m.tenantId, count });
      }
      return out;
    },
    async getTodayAttemptCount(tenant_id) {
      const today = todayUtc(now());
      if (tenant_id === undefined) {
        // Platform-wide aggregate: sum every counter whose date is today.
        let total = 0;
        for (const [key, count] of counts.entries()) {
          const m = meta.get(key);
          if (m?.date === today) total += count;
        }
        return total;
      }
      const k: CounterKey = { date: today, tenantId: tenant_id ?? null };
      return counts.get(keyOf(k)) ?? 0;
    },
    async incrementToday(tenant_id) {
      const { key, meta: m } = bumpKey(tenant_id);
      const current = counts.get(key) ?? 0;
      const next = current + 1;
      counts.set(key, next);
      meta.set(key, m);
      return next;
    },
  };
}
