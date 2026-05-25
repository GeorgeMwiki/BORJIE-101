/**
 * DP cross-tenant aggregator.
 *
 * Wires a `TenantAggregateSource` that produces per-tenant
 * contributions, a `PlatformBudgetLedger` that meters privacy spend,
 * and a `NoiseSource` that adds calibrated Laplace/Gaussian noise
 * into a single `aggregate(query)` function.
 *
 * Invariants (enforced programmatically):
 *   1. Refuses slices below k-anonymity threshold (k_min).
 *   2. Never publishes a per-tenant value — only the combined
 *      statistic.
 *   3. Consumes the platform privacy budget BEFORE producing output
 *      (reserve-first), so a ledger failure can't leak info.
 *   4. Returns a structured refusal, never an opaque error or a
 *      fallback unsafe value.
 *
 * This file contains business logic only; adapters for the ports
 * (Postgres ledger, Memgraph tenant source, crypto-PRNG noise) live
 * in separate files and are wired at the composition root.
 *
 * Wave-K W-Data — unified budget composer (G2 closure)
 * ─────────────────────────────────────────────────────
 * Historically the aggregator drove its own `PlatformBudgetLedger`.
 * That ledger was independent of the per-tenant
 * `PrivacyBudgetLedger` consumed by `cross-tenant-query.ts`, so an
 * attacker who alternated between the two could compound effective ε
 * past either ledger's cap without either noticing. The unified
 * `PrivacyBudgetComposerService` (K6.2) lives in
 * `@borjie/database/services/privacy-budget-composer.service.ts`
 * and gates BOTH sides.
 *
 * `DpAggregatorDeps.budgetComposer` is the migration path. When
 * provided, the aggregator routes ALL budget read/write through the
 * composer (instead of `PlatformBudgetLedger`). When absent we fall
 * back to `PlatformBudgetLedger` for back-compat — callers that
 * haven't migrated keep working untouched.
 */

import type {
  AggregateOutcome,
  AggregateQuery,
  AggregateResult,
  DPMechanism,
  NoiseSource,
  PlatformAuthContext,
  PlatformBudgetLedger,
  TenantAggregateSource,
} from '../types.js';
import { PrivacyBudgetExhaustedError } from '../types.js';

/**
 * Narrow shape of the K6.2 `PrivacyBudgetComposerService`. Declared
 * structurally so this package does NOT depend on
 * `@borjie/database` (would create a cycle — database imports
 * graph-privacy types via the analytics surface). The composition
 * root passes a concrete impl that satisfies this shape.
 */
export interface PrivacyBudgetComposerLike {
  checkBudgetAvailable(args: {
    readonly tenantId: string;
    readonly tier: 'platform' | 'pro' | 'enterprise';
    readonly requestedEpsilon: number;
    readonly requestedDelta: number;
  }): Promise<{
    readonly ok: boolean;
    readonly reason: string | null;
    readonly remainingEpsilon: number;
    readonly remainingDelta: number;
  }>;
  recordSpend(args: {
    readonly tenantId: string;
    readonly tier: 'platform' | 'pro' | 'enterprise';
    readonly epsilon: number;
    readonly delta: number;
    readonly queryId: string;
  }): Promise<unknown>;
}

export interface DpAggregatorDeps {
  readonly tenantSource: TenantAggregateSource;
  /**
   * Legacy in-process ledger. Always required so callers that haven't
   * migrated to the composer keep working. When `budgetComposer` is
   * also present the composer wins and this slot becomes the audit
   * trail / fallback.
   */
  readonly ledger: PlatformBudgetLedger;
  /**
   * Unified privacy-budget composer (K6.2). When provided, the
   * aggregator routes budget reads + spend records through the
   * composer instead of the legacy ledger. The legacy `ledger` slot
   * is still required because the composer doesn't expose the
   * `snapshot()` surface some operators rely on for dashboarding;
   * mixing the two is intentional during the migration window.
   */
  readonly budgetComposer?: PrivacyBudgetComposerLike;
  readonly noise: NoiseSource;
  readonly clock?: () => Date;
}

export interface DpAggregator {
  aggregate(
    query: AggregateQuery,
    ctx: PlatformAuthContext,
  ): Promise<AggregateOutcome>;
}

export function createDpAggregator(deps: DpAggregatorDeps): DpAggregator {
  const now = deps.clock ?? (() => new Date());

  return {
    async aggregate(query, ctx): Promise<AggregateOutcome> {
      assertPlatformAuth(ctx);

      // 1. Who is in the slice?
      const eligible = await deps.tenantSource.eligibleTenants(query.slice);
      if (eligible.length === 0) {
        return {
          kind: 'refused',
          reason: 'slice_empty',
          detail: 'no tenants match the slice',
        };
      }
      if (eligible.length < query.kMin) {
        return {
          kind: 'refused',
          reason: 'k_anonymity_not_met',
          detail: `slice has ${eligible.length} tenants, k_min=${query.kMin}`,
        };
      }

      // 2. Reserve privacy budget BEFORE reading any tenant values.
      //    If the reserve fails, we've leaked no information.
      //
      //    Wave-K W-Data: when a unified `budgetComposer` is wired,
      //    route through it (G2 closure — the platform AND per-tenant
      //    sides debit the same ledger). When absent, fall back to
      //    the legacy in-process ledger so unmigrated callers don't
      //    break.
      const delta = query.mechanism.kind === 'gaussian' ? query.mechanism.delta : 0;
      try {
        if (deps.budgetComposer) {
          const check = await deps.budgetComposer.checkBudgetAvailable({
            tenantId: 'platform',
            tier: 'platform',
            requestedEpsilon: query.mechanism.epsilon,
            requestedDelta: delta,
          });
          if (!check.ok) {
            return {
              kind: 'refused',
              reason: 'platform_budget_exhausted',
              detail: `composer refused: ${check.reason ?? 'unknown'} (remaining ε=${check.remainingEpsilon})`,
            };
          }
          await deps.budgetComposer.recordSpend({
            tenantId: 'platform',
            tier: 'platform',
            epsilon: query.mechanism.epsilon,
            delta,
            queryId: `${query.statistic}_${now().getTime()}_${Math.random().toString(36).slice(2, 8)}`,
          });
        } else {
          await deps.ledger.reserve({
            epsilon: query.mechanism.epsilon,
            delta,
          });
        }
      } catch (err) {
        if (err instanceof PrivacyBudgetExhaustedError) {
          return {
            kind: 'refused',
            reason: 'platform_budget_exhausted',
            detail: err.message,
          };
        }
        // PrivacyBudgetExceededError from the composer surfaces here
        // with a different name; convert to the same refusal shape.
        const e = err as { name?: string; message?: string };
        if (e?.name === 'PrivacyBudgetExceededError') {
          return {
            kind: 'refused',
            reason: 'platform_budget_exhausted',
            detail: e.message ?? 'composer refused',
          };
        }
        throw err;
      }

      // 3. Fetch per-tenant contributions in parallel. Each source
      //    returns an array of numbers (e.g. 0/1 per lease for a
      //    rate; raw days for a duration metric). We clip to the
      //    sensitivity range defensively even though each source is
      //    contracted to do so.
      const contributions = await Promise.all(
        eligible.map((tenantId) =>
          deps.tenantSource.contributionsFor({
            tenantId,
            statistic: query.statistic,
            slice: query.slice,
          }),
        ),
      );

      const rawValue = combineContributions(contributions, query.mechanism);
      const noisedValue = applyNoise(rawValue, query.mechanism, deps.noise);

      const result: AggregateResult = {
        statistic: query.statistic,
        slice: query.slice,
        noisedValue,
        contributingTenants: eligible.length,
        privacyCost: query.mechanism.epsilon,
        privacyDelta: query.mechanism.kind === 'gaussian' ? query.mechanism.delta : null,
        generatedAt: now().toISOString(),
      };
      return { kind: 'published', ...result };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Combining — per-tenant mean of means, so a tenant with 10,000 units
// doesn't dominate a tenant with 50. Each tenant contributes a single
// bounded value in [0, sensitivity].
// ─────────────────────────────────────────────────────────────────────

function combineContributions(
  perTenant: ReadonlyArray<ReadonlyArray<number>>,
  mechanism: DPMechanism,
): number {
  if (perTenant.length === 0) return 0;
  const perTenantMeans: number[] = [];
  for (const values of perTenant) {
    if (values.length === 0) continue;
    let sum = 0;
    for (const v of values) {
      // Clamp defensively to the sensitivity range
      const clipped = Math.max(-mechanism.sensitivity, Math.min(mechanism.sensitivity, v));
      sum += clipped;
    }
    perTenantMeans.push(sum / values.length);
  }
  if (perTenantMeans.length === 0) return 0;
  let outer = 0;
  for (const m of perTenantMeans) outer += m;
  return outer / perTenantMeans.length;
}

function applyNoise(
  rawValue: number,
  mechanism: DPMechanism,
  noise: NoiseSource,
): number {
  if (mechanism.kind === 'laplace') {
    const scale = mechanism.sensitivity / mechanism.epsilon;
    return rawValue + noise.laplace(scale);
  }
  // Gaussian
  const sigma =
    (mechanism.sensitivity *
      Math.sqrt(2 * Math.log(1.25 / mechanism.delta))) /
    mechanism.epsilon;
  return rawValue + noise.gaussian(sigma);
}

function assertPlatformAuth(ctx: PlatformAuthContext): void {
  if (ctx.kind !== 'platform') {
    throw new Error('graph-privacy: aggregate() requires a platform AuthContext');
  }
}
