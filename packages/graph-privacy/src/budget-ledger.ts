/**
 * In-process privacy-budget ledger with basic sequential composition.
 *
 * @deprecated Wave-K W-Data — use `PrivacyBudgetComposerService` from
 *   `@borjie/database/services/privacy-budget-composer.service`
 *   instead. The composer is the SINGLE gate that meters both the
 *   platform-wide cohort budget (this ledger) and the per-tenant
 *   budget (`PrivacyBudgetLedger` in `@borjie/ai-copilot/dp-memory`).
 *   Without unified accounting an attacker who alternated between
 *   cross-tenant queries and platform cohort queries could compound
 *   effective ε past either ledger's cap without either noticing.
 *
 *   Migration: pass `budgetComposer` into `createDpAggregator` and the
 *   aggregator routes all reserve/recordSpend through the composer.
 *   This ledger remains as the back-compat fallback for callers that
 *   haven't migrated and as a local audit shadow for callers that
 *   still rely on the `snapshot()` surface.
 *
 * Every Reserve call atomically debits against the configured total.
 * When the budget would go below zero, the Reserve throws and nothing
 * is debited — critical for the invariant "reserve before read" in
 * the aggregator.
 *
 * Composition model: basic (ε-additive) + advanced (sqrt(2k ln(1/δ')))
 * selectable per instance. Default is basic, which is the most
 * conservative and hardest to argue against; operators who have run
 * the math on their workload can opt into advanced composition.
 *
 * This implementation is in-memory. Production tenants should wire
 * the Postgres-backed adapter in a separate file that implements the
 * same `PlatformBudgetLedger` port; this in-process version is fine
 * for single-replica deployments or as a degraded fallback.
 */

import {
  PrivacyBudgetExhaustedError,
  type PlatformBudgetLedger,
} from './types.js';

export interface BudgetLedgerOptions {
  readonly totalEpsilon: number;
  /** For Gaussian mechanisms. Default 1e-6. */
  readonly totalDelta?: number;
  /** Composition mode. Default 'basic'. */
  readonly composition?: 'basic' | 'advanced';
}

export function createInMemoryBudgetLedger(
  opts: BudgetLedgerOptions,
): PlatformBudgetLedger {
  if (opts.totalEpsilon <= 0) {
    throw new RangeError('budget-ledger: totalEpsilon must be > 0');
  }
  const totalEpsilon = opts.totalEpsilon;
  const totalDelta = opts.totalDelta ?? 1e-6;
  const composition = opts.composition ?? 'basic';
  let spentEpsilon = 0;
  let spentDelta = 0;
  let queryCount = 0;

  // Serialise reserves to make the "reserve-before-read" guarantee
  // safe under concurrent callers. Single-flight queue: each reserve
  // awaits the previous one.
  let chain: Promise<unknown> = Promise.resolve();

  async function doReserve(args: {
    readonly epsilon: number;
    readonly delta: number;
  }): Promise<{
    readonly remainingEpsilon: number;
    readonly remainingDelta: number;
  }> {
    if (args.epsilon <= 0) {
      throw new RangeError('budget-ledger: reserve epsilon must be > 0');
    }
    if (args.delta < 0) {
      throw new RangeError('budget-ledger: reserve delta must be ≥ 0');
    }

    const nextCount = queryCount + 1;
    const nextSpentEpsilon =
      composition === 'basic'
        ? spentEpsilon + args.epsilon
        : advancedEpsilon(spentEpsilon, args.epsilon, nextCount, totalDelta);

    const nextSpentDelta = spentDelta + args.delta;

    if (nextSpentEpsilon > totalEpsilon) {
      throw new PrivacyBudgetExhaustedError(
        `platform privacy budget exhausted: spent=${spentEpsilon.toFixed(4)}, ` +
          `would-spend-after=${nextSpentEpsilon.toFixed(4)}, total=${totalEpsilon.toFixed(4)}`,
      );
    }
    if (nextSpentDelta > totalDelta) {
      throw new PrivacyBudgetExhaustedError(
        `platform delta budget exhausted: spent=${spentDelta.toExponential(3)}, ` +
          `would-spend-after=${nextSpentDelta.toExponential(3)}, total=${totalDelta.toExponential(3)}`,
      );
    }

    spentEpsilon = nextSpentEpsilon;
    spentDelta = nextSpentDelta;
    queryCount = nextCount;

    return {
      remainingEpsilon: totalEpsilon - spentEpsilon,
      remainingDelta: totalDelta - spentDelta,
    };
  }

  return {
    async reserve(args): Promise<{
      readonly remainingEpsilon: number;
      readonly remainingDelta: number;
    }> {
      const prior = chain;
      let resolver!: (v: {
        readonly remainingEpsilon: number;
        readonly remainingDelta: number;
      }) => void;
      let rejecter!: (e: unknown) => void;
      const next = new Promise<{
        readonly remainingEpsilon: number;
        readonly remainingDelta: number;
      }>((res, rej) => {
        resolver = res;
        rejecter = rej;
      });
      chain = next.catch(() => undefined);
      await prior.catch(() => undefined);
      try {
        const out = await doReserve(args);
        resolver(out);
        return out;
      } catch (err) {
        rejecter(err);
        throw err;
      }
    },
    async snapshot(): Promise<{
      readonly totalEpsilon: number;
      readonly spentEpsilon: number;
      readonly totalDelta: number;
      readonly spentDelta: number;
    }> {
      return { totalEpsilon, spentEpsilon, totalDelta, spentDelta };
    },
  };
}

/**
 * Approximate advanced composition bound (Dwork et al. 2010 Thm 3.20).
 *
 * For k ε-ε' DP mechanisms composed adaptively, overall privacy cost
 * is bounded by  ε_total ≤ sqrt(2k ln(1/δ')) ε' + k ε'(e^{ε'} - 1).
 *
 * We apply the bound incrementally: each new reserve adds
 *   Δε = sqrt(2 ln(1/δ')) ε_i + ε_i(e^{ε_i} - 1)
 * to the running ε_total. Conservative enough in practice, cheaper
 * than recomputing k × composition from scratch.
 */
function advancedEpsilon(
  runningEpsilon: number,
  newEpsilon: number,
  /* k= */ _queryCount: number,
  delta: number,
): number {
  const deltaPrime = delta / 2; // split budget between mechanism + composition
  const deltaAccountable = Math.max(deltaPrime, 1e-12);
  const term1 = Math.sqrt(2 * Math.log(1 / deltaAccountable)) * newEpsilon;
  const term2 = newEpsilon * (Math.exp(newEpsilon) - 1);
  return runningEpsilon + term1 + term2;
}
