/**
 * `@borjie/llm-budget-governor` — Postgres-backed BudgetStore.
 *
 * Fixes BUG-HI-3: the in-memory store kept per-tenant LLM spend in the
 * api-gateway process heap. On restart (deploy, OOM kill, scale-down)
 * every tenant's daily budget reset to zero — tenants got unlimited
 * LLM spend until the in-memory counter rebuilt. This adapter persists
 * spend to Postgres so caps survive restarts.
 *
 * Schema (see `packages/database/src/migrations/0272_tenant_llm_budgets.sql`):
 *
 *   CREATE TABLE tenant_llm_budgets (
 *     tenant_id     text NOT NULL,
 *     period_kind   text NOT NULL CHECK (period_kind IN ('daily','monthly')),
 *     period_start  timestamptz NOT NULL,
 *     period_end    timestamptz NOT NULL,
 *     spend_tokens  bigint NOT NULL DEFAULT 0,
 *     spend_cents   bigint NOT NULL DEFAULT 0,
 *     updated_at    timestamptz NOT NULL DEFAULT now(),
 *     PRIMARY KEY (tenant_id, period_kind, period_start)
 *   );
 *
 * Atomic increment via `INSERT ... ON CONFLICT DO UPDATE SET spend_*
 * = spend_* + EXCLUDED.spend_*`. A separate `tenant_llm_budget_caps`
 * table holds per-tenant cap configuration (cap cents / cap tokens /
 * allowed tiers / downgrade threshold) so the per-period usage rows
 * stay narrow.
 *
 * Port shape:
 *   The adapter takes a generic SQL-port (`SqlClient`) interface rather
 *   than importing `postgres` or Drizzle directly. This keeps the
 *   package zero-Drizzle and zero-postgres-runtime-dep; the composition
 *   root passes its `postgres-js` `Sql` handle at wiring time (the
 *   `Sql` shape from `postgres` is structurally compatible).
 *
 * Wiring note:
 *   This adapter ships standalone in this commit. The api-gateway
 *   composition root swap is DEFERRED — P75 is actively editing
 *   `services/api-gateway/src/composition/service-registry.ts` to wire
 *   per-tenant budget caps + auto-downgrade ladder. The swap to
 *   `createPostgresBudgetStore` must land in a follow-up wave once
 *   P75 has merged to avoid stomping on its registry edits.
 */

import type {
  BudgetStore,
  BudgetUsage,
  ModelTier,
  PeriodKey,
  TenantBudget,
  TenantId,
} from './types.js';

/**
 * Minimal SQL-port that the postgres-store consumes. Structurally
 * compatible with `postgres-js`'s tagged-template `Sql` handle —
 * callers in the composition root pass `db.$client` directly. The port
 * is duck-typed so this package never needs to import `postgres`.
 */
export interface SqlClient {
  /**
   * Tagged-template query — same shape as `postgres-js`'s `sql`.
   * Returns an array of row objects.
   */
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: ReadonlyArray<unknown>
  ): Promise<ReadonlyArray<T>>;
}

export interface CreatePostgresBudgetStoreArgs {
  /** SQL handle (e.g. `db.$client` from a Drizzle Postgres-js instance). */
  readonly db: SqlClient;
}

interface UsageRow {
  readonly tenant_id: string;
  readonly period_kind: 'daily' | 'monthly';
  readonly period_start: Date;
  readonly period_end: Date;
  readonly spend_tokens: string | number;
  readonly spend_cents: string | number;
  readonly highest_tier_used: ModelTier | null;
}

interface BudgetRow {
  readonly tenant_id: string;
  readonly period_kind: 'daily' | 'monthly';
  readonly cap_cents: string | number;
  readonly cap_tokens: string | number;
  readonly allowed_tiers: ReadonlyArray<string>;
  readonly downgrade_at_fraction: string | number;
}

const TIER_RANK: Record<ModelTier, number> = {
  haiku: 1,
  sonnet: 2,
  opus: 3,
};

function pickHighestTier(a: ModelTier | null, b: ModelTier): ModelTier {
  if (a === null) return b;
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function toBigIntNumber(v: string | number): number {
  if (typeof v === 'number') return v;
  // postgres-js returns BIGINT as a string by default — guard against
  // floating-point precision loss for spend values past 2^53.
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function periodKindFromKey(periodKey: PeriodKey): 'daily' | 'monthly' {
  // 'yyyy-mm-dd' (length 10) → daily; 'yyyy-mm' (length 7) → monthly.
  return periodKey.length === 10 ? 'daily' : 'monthly';
}

/**
 * Compute UTC start/end timestamps for the supplied period key. The end
 * is exclusive (`period_start + 1 day` for daily, `+ 1 month` for
 * monthly) so consecutive periods never overlap.
 */
function periodBoundsUtc(periodKey: PeriodKey): { start: Date; end: Date } {
  if (periodKey.length === 10) {
    const start = new Date(`${periodKey}T00:00:00.000Z`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }
  // monthly: yyyy-mm
  const [yearStr, monthStr] = periodKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // 0-indexed
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

/**
 * Build a Postgres-backed `BudgetStore`. Persists per-tenant usage to
 * the `tenant_llm_budgets` table; per-tenant cap config lives in
 * `tenant_llm_budget_caps`.
 */
export function createPostgresBudgetStore(
  args: CreatePostgresBudgetStoreArgs,
): BudgetStore {
  const { db } = args;

  return {
    async getBudget(tenantId: TenantId): Promise<TenantBudget | null> {
      const rows = await db<BudgetRow>`
        SELECT tenant_id,
               period_kind,
               cap_cents,
               cap_tokens,
               allowed_tiers,
               downgrade_at_fraction
          FROM tenant_llm_budget_caps
         WHERE tenant_id = ${tenantId}
         LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      return {
        tenantId: row.tenant_id,
        period: row.period_kind,
        capCents: toBigIntNumber(row.cap_cents),
        capTokens: toBigIntNumber(row.cap_tokens),
        allowedTiers: row.allowed_tiers as ReadonlyArray<ModelTier>,
        downgradeAtFraction: Number(row.downgrade_at_fraction),
      };
    },

    async setBudget(b: TenantBudget): Promise<void> {
      await db`
        INSERT INTO tenant_llm_budget_caps (
          tenant_id, period_kind, cap_cents, cap_tokens,
          allowed_tiers, downgrade_at_fraction, updated_at
        ) VALUES (
          ${b.tenantId}, ${b.period}, ${b.capCents}, ${b.capTokens},
          ${b.allowedTiers as unknown as string[]}, ${b.downgradeAtFraction}, now()
        )
        ON CONFLICT (tenant_id) DO UPDATE
          SET period_kind            = EXCLUDED.period_kind,
              cap_cents              = EXCLUDED.cap_cents,
              cap_tokens             = EXCLUDED.cap_tokens,
              allowed_tiers          = EXCLUDED.allowed_tiers,
              downgrade_at_fraction  = EXCLUDED.downgrade_at_fraction,
              updated_at             = now()
      `;
    },

    async getUsage(
      tenantId: TenantId,
      periodKey: PeriodKey,
    ): Promise<BudgetUsage> {
      const periodKind = periodKindFromKey(periodKey);
      const { start } = periodBoundsUtc(periodKey);
      const rows = await db<UsageRow>`
        SELECT tenant_id,
               period_kind,
               period_start,
               period_end,
               spend_tokens,
               spend_cents,
               highest_tier_used
          FROM tenant_llm_budgets
         WHERE tenant_id    = ${tenantId}
           AND period_kind  = ${periodKind}
           AND period_start = ${start}
         LIMIT 1
      `;
      const row = rows[0];
      if (!row) {
        return {
          tenantId,
          period: periodKind,
          periodKey,
          usedCents: 0,
          usedTokens: 0,
          highestTierUsed: null,
        };
      }
      return {
        tenantId: row.tenant_id,
        period: row.period_kind,
        periodKey,
        usedCents: toBigIntNumber(row.spend_cents),
        usedTokens: toBigIntNumber(row.spend_tokens),
        highestTierUsed: row.highest_tier_used,
      };
    },

    async recordSpend(
      tenantId: TenantId,
      periodKey: PeriodKey,
      cents: number,
      tokens: number,
      tier: ModelTier,
    ): Promise<BudgetUsage> {
      const periodKind = periodKindFromKey(periodKey);
      const { start, end } = periodBoundsUtc(periodKey);

      const rows = await db<UsageRow>`
        INSERT INTO tenant_llm_budgets (
          tenant_id, period_kind, period_start, period_end,
          spend_tokens, spend_cents, highest_tier_used, updated_at
        ) VALUES (
          ${tenantId}, ${periodKind}, ${start}, ${end},
          ${tokens}, ${cents}, ${tier}, now()
        )
        ON CONFLICT (tenant_id, period_kind, period_start) DO UPDATE
          SET spend_tokens      = tenant_llm_budgets.spend_tokens + EXCLUDED.spend_tokens,
              spend_cents       = tenant_llm_budgets.spend_cents  + EXCLUDED.spend_cents,
              highest_tier_used = CASE
                WHEN tenant_llm_budgets.highest_tier_used IS NULL THEN EXCLUDED.highest_tier_used
                WHEN EXCLUDED.highest_tier_used = 'opus'   THEN 'opus'
                WHEN tenant_llm_budgets.highest_tier_used = 'opus' THEN 'opus'
                WHEN EXCLUDED.highest_tier_used = 'sonnet' THEN 'sonnet'
                WHEN tenant_llm_budgets.highest_tier_used = 'sonnet' THEN 'sonnet'
                ELSE EXCLUDED.highest_tier_used
              END,
              updated_at        = now()
        RETURNING tenant_id,
                  period_kind,
                  period_start,
                  period_end,
                  spend_tokens,
                  spend_cents,
                  highest_tier_used
      `;
      const row = rows[0];
      if (!row) {
        // Defensive — should never happen for an UPSERT with RETURNING.
        return {
          tenantId,
          period: periodKind,
          periodKey,
          usedCents: cents,
          usedTokens: tokens,
          highestTierUsed: tier,
        };
      }
      return {
        tenantId: row.tenant_id,
        period: row.period_kind,
        periodKey,
        usedCents: toBigIntNumber(row.spend_cents),
        usedTokens: toBigIntNumber(row.spend_tokens),
        highestTierUsed: pickHighestTier(row.highest_tier_used, tier),
      };
    },
  };
}
