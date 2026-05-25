/**
 * Budgets — create / fetch / availability / block-on-overspend.
 *
 * `availableSpend(budget) = amount - spent - committed - reserved`.
 *
 * Alert levels:
 *   green  : utilisation <= 80%
 *   amber  : 80%  < utilisation <= 95%
 *   red    : 95%  < utilisation < 100%
 *   over   : utilisation >= 100%
 *
 * `blockIfOverBudget()` is the pre-check called by requisitions /
 * purchase-order services BEFORE any reservation or commitment is
 * added — it returns a structured decision so the caller can either
 * raise an error or fall back to a soft-warning UX based on tenant
 * policy.
 */

import { z } from 'zod';
import type {
  Budget,
  BudgetAvailability,
  BudgetId,
  ClockPort,
  CurrencyCode,
  ProcurementDataPort,
} from '../types.js';

const CreateBudgetSchema = z.object({
  tenantId: z.string().min(1),
  scope: z.enum(['org', 'department', 'property', 'category']),
  scopeKey: z.string().min(1),
  period: z.enum(['monthly', 'quarterly', 'annual']),
  periodStart: z.string(),
  periodEnd: z.string(),
  amount: z.number().positive(),
  currency: z.string().length(3),
  alertThresholdsPct: z.array(z.number().positive().max(200)).optional(),
});

export interface BudgetService {
  createBudget(input: z.input<typeof CreateBudgetSchema>): Promise<Budget>;
  fetchAvailability(args: { readonly id: BudgetId }): Promise<BudgetAvailability>;
  /**
   * Pre-check whether a candidate spend can be absorbed by the budget.
   * Returns `{ allowed: false }` if the spend would push utilisation
   * past 100% (when `block` is true).
   */
  blockIfOverBudget(args: {
    readonly id: BudgetId;
    readonly amount: number;
    readonly currency: CurrencyCode;
    readonly block?: boolean;
  }): Promise<{
    readonly allowed: boolean;
    readonly available: number;
    readonly utilisationPctAfter: number;
    readonly reason: string | null;
  }>;
  listBudgets(args: { readonly tenantId: string }): Promise<ReadonlyArray<Budget>>;
}

export interface BudgetServiceDeps {
  readonly dataPort: ProcurementDataPort;
  readonly clock?: ClockPort;
  readonly idFactory?: () => string;
}

const DEFAULT_ALERT_THRESHOLDS = [80, 95, 100];

export function createBudgetService(deps: BudgetServiceDeps): BudgetService {
  // clock is reserved for future period-rollover work; not used today
  // but kept on the dependency object so callers wire it once.
  void deps.clock;
  const idFactory = deps.idFactory ?? defaultIdFactory;
  const port = deps.dataPort;

  return {
    async createBudget(rawInput) {
      const input = CreateBudgetSchema.parse(rawInput);
      if (new Date(input.periodStart) >= new Date(input.periodEnd)) {
        throw new Error('Budget periodEnd must be after periodStart');
      }
      const budget: Budget = {
        id: `bud_${idFactory()}`,
        tenantId: input.tenantId,
        scope: input.scope,
        scopeKey: input.scopeKey,
        period: input.period,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        spent: 0,
        committed: 0,
        reserved: 0,
        alertThresholdsPct: input.alertThresholdsPct ?? DEFAULT_ALERT_THRESHOLDS,
      };
      await port.insertBudget(budget);
      return budget;
    },

    async fetchAvailability(args) {
      const budget = await port.findBudget(args.id);
      if (!budget) throw new Error(`Budget ${args.id} not found`);
      return computeAvailability(budget);
    },

    async blockIfOverBudget(args) {
      const budget = await port.findBudget(args.id);
      if (!budget) throw new Error(`Budget ${args.id} not found`);
      if (budget.currency.toUpperCase() !== args.currency.toUpperCase()) {
        return {
          allowed: false,
          available: 0,
          utilisationPctAfter: 0,
          reason: `Currency mismatch: budget=${budget.currency} spend=${args.currency}`,
        };
      }
      const available = budget.amount - budget.spent - budget.committed - budget.reserved;
      const wouldOverspend = args.amount > available;
      const utilisationPctAfter =
        ((budget.spent + budget.committed + budget.reserved + args.amount) / budget.amount) * 100;
      if (wouldOverspend && (args.block ?? true)) {
        return {
          allowed: false,
          available,
          utilisationPctAfter,
          reason: `Spend ${args.amount} exceeds remaining ${available.toFixed(2)} on budget ${budget.id}`,
        };
      }
      return {
        allowed: true,
        available,
        utilisationPctAfter,
        reason: null,
      };
    },

    async listBudgets(args) {
      return port.listBudgets(args.tenantId);
    },
  };
}

export function computeAvailability(budget: Budget): BudgetAvailability {
  const available = budget.amount - budget.spent - budget.committed - budget.reserved;
  const utilisationPct =
    ((budget.spent + budget.committed + budget.reserved) / budget.amount) * 100;
  const alertLevel: BudgetAvailability['alertLevel'] =
    utilisationPct >= 100
      ? 'over'
      : utilisationPct > 95
        ? 'red'
        : utilisationPct > 80
          ? 'amber'
          : 'green';
  return {
    budget,
    available: round2(available),
    utilisationPct: round2(utilisationPct),
    alertLevel,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

let counter = 0;
function defaultIdFactory(): string {
  counter += 1;
  return `${Date.now().toString(36)}_${counter.toString(36)}`;
}
