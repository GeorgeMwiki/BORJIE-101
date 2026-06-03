/**
 * MCP per-tenant tool-call meter (LP-20a).
 *
 * Counts MCP tool calls per (tenant, UTC-day) and enforces a daily
 * cap. This is the "calls" axis — distinct from the token/cost spend
 * tracked by {@link CostBatcher} in `cost-persistence.ts`. Without a
 * calls meter a single compromised api-key can exhaust the day for a
 * tenant even when each individual call is cheap (a high-frequency
 * scrape of a free tool burns infra without ever tripping a cost cap).
 *
 * Ported + re-skinned from LITFIN `src/core/mcp/budget/per-tenant-meter.ts`
 * to Borjie's SaaS tier model (`standard` / `pro` / `enterprise`).
 *
 * Defaults (override via env `BORJIE_MCP_CALLS_<TIER>_DAY`):
 *   - standard   :   5 000 / day
 *   - pro        :  50 000 / day
 *   - enterprise : 500 000 / day
 *
 * The store is injected (immutable, no I/O in this module). In tests we
 * use {@link InMemoryMeterStore}; in prod the gateway wires a Postgres-
 * or Redis-backed store whose `reserveCall` is a single atomic upsert.
 *
 * @module @borjie/mcp-server/per-tenant-meter
 */

import type { McpTier } from './types.js';

// ---------------------------------------------------------------------------
// Decision discriminator
// ---------------------------------------------------------------------------

export interface MeterDecisionOk {
  readonly ok: true;
  readonly tenantId: string;
  readonly tier: McpTier;
  readonly day: string;
  readonly used: number;
  readonly cap: number;
  readonly remaining: number;
}

export interface MeterDecisionBlocked {
  readonly ok: false;
  readonly reason: 'over-cap';
  readonly tenantId: string;
  readonly tier: McpTier;
  readonly day: string;
  readonly used: number;
  readonly cap: number;
}

export type MeterDecision = MeterDecisionOk | MeterDecisionBlocked;

// ---------------------------------------------------------------------------
// Store port
// ---------------------------------------------------------------------------

export interface MeterStore {
  read(tenantId: string, day: string): Promise<number>;
  increment(tenantId: string, day: string, by: number): Promise<number>;
  /**
   * Atomic precheck-and-increment. Returns the post-increment count
   * when it would be `<= cap`, or `null` when the increment would
   * breach the cap. Implementations MUST perform read+increment in a
   * single linearised operation to close the TOCTOU window between a
   * separate precheck and commit (the production Postgres/Redis
   * adapter does this with `INSERT ... ON CONFLICT ... WHERE` or a Lua
   * script).
   */
  incrementIfBelow(
    tenantId: string,
    day: string,
    cap: number,
  ): Promise<number | null>;
}

/**
 * In-memory meter store with a per-key mutex so concurrent
 * `incrementIfBelow` calls on the same (tenant, day) are linearised.
 * Immutable rows map (a new Map per write) per the no-mutation rule.
 */
export class InMemoryMeterStore implements MeterStore {
  private rows: ReadonlyMap<string, number> = new Map();
  private locks: Map<string, Promise<void>> = new Map();

  private key(tenantId: string, day: string): string {
    return `${tenantId}|${day}`;
  }

  async read(tenantId: string, day: string): Promise<number> {
    return this.rows.get(this.key(tenantId, day)) ?? 0;
  }

  async increment(tenantId: string, day: string, by: number): Promise<number> {
    const current = await this.read(tenantId, day);
    const next = current + by;
    const map = new Map(this.rows);
    map.set(this.key(tenantId, day), next);
    this.rows = map;
    return next;
  }

  async incrementIfBelow(
    tenantId: string,
    day: string,
    cap: number,
  ): Promise<number | null> {
    const k = this.key(tenantId, day);
    const prev = this.locks.get(k) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.then(() => gate);
    this.locks.set(k, chained);
    await prev;
    try {
      const current = this.rows.get(k) ?? 0;
      if (current >= cap) return null;
      const next = current + 1;
      const map = new Map(this.rows);
      map.set(k, next);
      this.rows = map;
      return next;
    } finally {
      release();
      if (this.locks.get(k) === chained) this.locks.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

const DEFAULT_CAPS: Readonly<Record<McpTier, number>> = {
  standard: 5_000,
  pro: 50_000,
  enterprise: 500_000,
};

/**
 * Resolve the daily cap for a tier. An env override
 * `BORJIE_MCP_CALLS_<TIER>_DAY` (positive finite integer) wins, else
 * the built-in default. Reading env here mirrors the existing
 * tier-router's env-driven config; callers MAY pass an explicit
 * `capOverride` to avoid env entirely.
 */
export function getTierCallCap(
  tier: McpTier,
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const envKey = `BORJIE_MCP_CALLS_${tier.toUpperCase()}_DAY`;
  const raw = env[envKey];
  const parsed = Number(raw);
  if (raw !== undefined && Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return DEFAULT_CAPS[tier];
}

export function currentUtcDay(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MeterArgs {
  readonly tenantId: string;
  readonly tier: McpTier;
  readonly store: MeterStore;
  readonly day?: string;
  readonly capOverride?: number;
}

function resolveDayAndCap(args: MeterArgs): { day: string; cap: number } {
  return {
    day: args.day ?? currentUtcDay(),
    cap: args.capOverride ?? getTierCallCap(args.tier),
  };
}

/**
 * Atomic gate: increment-if-below-cap in one store operation. Returns
 * `ok` with the bumped count when it fits under the cap, or `over-cap`
 * when the increment would breach it. This is the TOCTOU-safe primitive
 * the route handler calls BEFORE dispatching a tool — on `over-cap` it
 * responds HTTP 429 without ever running the tool body.
 */
export async function reserveCall(args: MeterArgs): Promise<MeterDecision> {
  const { day, cap } = resolveDayAndCap(args);
  const newUsed = await args.store.incrementIfBelow(args.tenantId, day, cap);
  if (newUsed === null) {
    return Object.freeze({
      ok: false,
      reason: 'over-cap',
      tenantId: args.tenantId,
      tier: args.tier,
      day,
      used: cap,
      cap,
    });
  }
  return Object.freeze({
    ok: true,
    tenantId: args.tenantId,
    tier: args.tier,
    day,
    used: newUsed,
    cap,
    remaining: cap - newUsed,
  });
}

/** Read-only snapshot (admin dashboard / `GET /usage`). Never mutates. */
export interface MeterSnapshot {
  readonly tenantId: string;
  readonly tier: McpTier;
  readonly day: string;
  readonly used: number;
  readonly cap: number;
  readonly remaining: number;
}

export async function snapshotMeter(args: MeterArgs): Promise<MeterSnapshot> {
  const { day, cap } = resolveDayAndCap(args);
  const used = await args.store.read(args.tenantId, day);
  return Object.freeze({
    tenantId: args.tenantId,
    tier: args.tier,
    day,
    used,
    cap,
    remaining: Math.max(0, cap - used),
  });
}
