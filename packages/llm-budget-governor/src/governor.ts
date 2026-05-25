/**
 * LLM budget governor.
 *
 * `evaluateCall({ tenantId, model, estimatedTokens })` returns a
 * GovernanceDecision the caller acts upon (route to model, downgrade,
 * or block).
 *
 * The governor only READS — it does not record spend. Call
 * `recordSpend()` after a successful LLM completion.
 */

import { nextAllowedTier, projectCallCostCents } from './auto-downgrade/index.js';
import {
  DEFAULT_COST_PER_1K_CENTS,
  type BudgetGovernorOptions,
  type GovernanceDecision,
  type ModelTier,
  type PeriodKey,
  type TenantBudget,
  type TenantId,
} from './types.js';

export interface EvaluateCallArgs {
  readonly tenantId: TenantId;
  readonly model: ModelTier;
  readonly estimatedTokens: number;
}

export interface LLMBudgetGovernor {
  evaluateCall(args: EvaluateCallArgs): Promise<GovernanceDecision>;
  recordSpend(args: {
    tenantId: TenantId;
    model: ModelTier;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void>;
  /** Inspect the current usage snapshot for a tenant. */
  snapshot(tenantId: TenantId): Promise<{
    budget: TenantBudget | null;
    periodKey: PeriodKey;
    usedCents: number;
    usedTokens: number;
  }>;
}

export function createLLMBudgetGovernor(
  opts: BudgetGovernorOptions,
): LLMBudgetGovernor {
  const now = opts.now ?? (() => new Date());
  const costTable = opts.costTable ?? DEFAULT_COST_PER_1K_CENTS;
  const store = opts.store;

  function periodKeyFor(budget: TenantBudget, t = now()): PeriodKey {
    if (budget.period === 'daily') {
      return formatDay(t);
    }
    return formatMonth(t);
  }

  return {
    async evaluateCall(args): Promise<GovernanceDecision> {
      const budget = await store.getBudget(args.tenantId);
      if (!budget) {
        // No cap configured for this tenant → pass through. Production
        // composition should always seed a default budget at signup so
        // this branch is rarely hit; treat as proceed for safety.
        return {
          kind: 'proceed',
          model: args.model,
          remainingCents: Number.POSITIVE_INFINITY,
          remainingTokens: Number.POSITIVE_INFINITY,
        };
      }

      const periodKey = periodKeyFor(budget);
      const usage = await store.getUsage(args.tenantId, periodKey);
      const projectedCents = projectCallCostCents(
        args.estimatedTokens,
        args.model,
        costTable,
      );
      const wouldBeCents = usage.usedCents + projectedCents;
      const wouldBeTokens = usage.usedTokens + args.estimatedTokens;

      // Hard block first.
      if (usage.usedCents >= budget.capCents) {
        await opts.alertSink?.emitBlock({
          tenantId: args.tenantId,
          periodKey,
          reason: 'over-cap-cents',
        });
        return {
          kind: 'block',
          reason: 'over-cap-cents',
          usedCents: usage.usedCents,
          usedTokens: usage.usedTokens,
          capCents: budget.capCents,
          capTokens: budget.capTokens,
          resetsAt: nextPeriodKey(budget, now()),
        };
      }
      if (usage.usedTokens >= budget.capTokens) {
        await opts.alertSink?.emitBlock({
          tenantId: args.tenantId,
          periodKey,
          reason: 'over-cap-tokens',
        });
        return {
          kind: 'block',
          reason: 'over-cap-tokens',
          usedCents: usage.usedCents,
          usedTokens: usage.usedTokens,
          capCents: budget.capCents,
          capTokens: budget.capTokens,
          resetsAt: nextPeriodKey(budget, now()),
        };
      }

      // Tier-allowed check + auto-downgrade if tier not allowed.
      let effectiveModel = args.model;
      let downgradeReason: 'approaching-cap' | 'tier-not-allowed' | null = null;
      if (!budget.allowedTiers.includes(args.model)) {
        const cheaper = nextAllowedTier(args.model, budget.allowedTiers);
        if (cheaper === null) {
          return {
            kind: 'block',
            reason: 'no-tier-fits',
            usedCents: usage.usedCents,
            usedTokens: usage.usedTokens,
            capCents: budget.capCents,
            capTokens: budget.capTokens,
            resetsAt: nextPeriodKey(budget, now()),
          };
        }
        effectiveModel = cheaper;
        downgradeReason = 'tier-not-allowed';
      }

      // Approaching-cap check.
      const wouldFraction =
        Math.max(
          wouldBeCents / budget.capCents,
          wouldBeTokens / budget.capTokens,
        );
      if (
        downgradeReason === null &&
        wouldFraction >= budget.downgradeAtFraction
      ) {
        const cheaper = nextAllowedTier(args.model, budget.allowedTiers);
        if (cheaper !== null && cheaper !== args.model) {
          effectiveModel = cheaper;
          downgradeReason = 'approaching-cap';
        }
      }

      if (downgradeReason !== null) {
        await opts.alertSink?.emitDowngrade({
          tenantId: args.tenantId,
          periodKey,
          requested: args.model,
          downgradedTo: effectiveModel,
          reason: downgradeReason,
        });
        return {
          kind: 'downgrade',
          requested: args.model,
          downgradedTo: effectiveModel,
          reason: downgradeReason,
          remainingCents: Math.max(0, budget.capCents - usage.usedCents),
          remainingTokens: Math.max(0, budget.capTokens - usage.usedTokens),
        };
      }

      return {
        kind: 'proceed',
        model: args.model,
        remainingCents: Math.max(0, budget.capCents - usage.usedCents),
        remainingTokens: Math.max(0, budget.capTokens - usage.usedTokens),
      };
    },

    async recordSpend(args): Promise<void> {
      const budget = await store.getBudget(args.tenantId);
      if (!budget) return;
      const periodKey = periodKeyFor(budget);
      const tokens = args.inputTokens + args.outputTokens;
      const cents = projectCallCostCents(tokens, args.model, costTable);
      await store.recordSpend(
        args.tenantId,
        periodKey,
        cents,
        tokens,
        args.model,
      );
    },

    async snapshot(tenantId) {
      const budget = await store.getBudget(tenantId);
      if (!budget) {
        const periodKey = formatDay(now());
        return {
          budget: null,
          periodKey,
          usedCents: 0,
          usedTokens: 0,
        };
      }
      const periodKey = periodKeyFor(budget);
      const usage = await store.getUsage(tenantId, periodKey);
      return {
        budget,
        periodKey,
        usedCents: usage.usedCents,
        usedTokens: usage.usedTokens,
      };
    },
  };
}

function nextPeriodKey(budget: TenantBudget, t: Date): PeriodKey {
  if (budget.period === 'daily') {
    const next = new Date(t);
    next.setUTCDate(next.getUTCDate() + 1);
    return formatDay(next);
  }
  const next = new Date(t);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return formatMonth(next);
}

function formatDay(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatMonth(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
