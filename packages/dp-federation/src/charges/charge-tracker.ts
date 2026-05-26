/**
 * DP charge tracker — record per-operation ε spends and refuse
 * operations that would exhaust the per-tenant budget.
 *
 * Spec: Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md §3.5.
 *
 * The strategic-layer's `epsilon_budgets` table is the source of
 * truth for the per-period budget; this tracker sums `dp_charges`
 * rows from the per-operation table to compute the remaining budget.
 */

import type {
  ChargeTrackerDeps,
  DpCharge,
} from '../types.js';

export class BudgetExhaustedError extends Error {
  public override readonly name = 'BudgetExhaustedError';
  public readonly tenantId: string;
  public readonly periodStart: string;
  public readonly requestedEpsilon: number;
  public readonly remainingEpsilon: number;

  public constructor(args: {
    tenantId: string;
    periodStart: string;
    requestedEpsilon: number;
    remainingEpsilon: number;
  }) {
    super(
      `Tenant ${args.tenantId} ε-budget exhausted for period ${args.periodStart}: ` +
        `requested ${args.requestedEpsilon.toFixed(6)}, remaining ${args.remainingEpsilon.toFixed(6)}`,
    );
    this.tenantId = args.tenantId;
    this.periodStart = args.periodStart;
    this.requestedEpsilon = args.requestedEpsilon;
    this.remainingEpsilon = args.remainingEpsilon;
  }
}

export interface ChargeRequest {
  readonly tenantId: string;
  readonly periodStart: string;
  readonly operation: string;
  readonly opId: string;
  readonly epsilonDelta: number;
  /** Optional prev_hash for the audit chain. */
  readonly prevHash?: string | null;
}

export interface ChargeOutcome {
  readonly charge: DpCharge;
  readonly remainingEpsilon: number;
}

export function createChargeTracker(deps: ChargeTrackerDeps): {
  readonly record: (request: ChargeRequest) => Promise<ChargeOutcome>;
  readonly remaining: (
    tenantId: string,
    periodStart: string,
  ) => Promise<number>;
} {
  return Object.freeze({
    async record(request: ChargeRequest): Promise<ChargeOutcome> {
      if (
        !Number.isFinite(request.epsilonDelta) ||
        request.epsilonDelta < 0
      ) {
        throw new Error(
          `epsilonDelta must be a non-negative finite number (got ${request.epsilonDelta})`,
        );
      }

      // Idempotency: if a charge with this (tenantId, opId) already
      // exists, return it unchanged. Insert-only repositories assume
      // the UNIQUE index on (tenant_id, op_id) at the SQL layer.
      const existing = await deps.chargesRepository.findById(
        request.tenantId,
        request.opId,
      );
      if (existing) {
        const spent = await deps.chargesRepository.sumForPeriod(
          request.tenantId,
          request.periodStart,
        );
        const budget = await deps.budgetPort.get(
          request.tenantId,
          request.periodStart,
        );
        return Object.freeze({
          charge: existing,
          remainingEpsilon: budget.epsilonTotal - spent,
        });
      }

      const spent = await deps.chargesRepository.sumForPeriod(
        request.tenantId,
        request.periodStart,
      );
      const budget = await deps.budgetPort.get(
        request.tenantId,
        request.periodStart,
      );
      const remaining = budget.epsilonTotal - spent;
      if (remaining < request.epsilonDelta) {
        deps.logger?.warn('dp budget exhausted', {
          tenantId: request.tenantId,
          periodStart: request.periodStart,
          remaining,
          requested: request.epsilonDelta,
        });
        throw new BudgetExhaustedError({
          tenantId: request.tenantId,
          periodStart: request.periodStart,
          requestedEpsilon: request.epsilonDelta,
          remainingEpsilon: remaining,
        });
      }

      const id = deps.uuid.next();
      const recordedAt = deps.clock.nowIso();
      const payload = {
        id,
        tenantId: request.tenantId,
        periodStart: request.periodStart,
        operation: request.operation,
        opId: request.opId,
        epsilonDelta: request.epsilonDelta,
        recordedAt,
      } as const;
      const auditHash = deps.auditChain.hash(
        request.prevHash ?? null,
        payload,
      );

      const charge: DpCharge = Object.freeze({
        id,
        tenantId: request.tenantId,
        periodStart: request.periodStart,
        epsilonDelta: request.epsilonDelta,
        operation: request.operation,
        opId: request.opId,
        recordedAt,
        auditHash,
      });
      await deps.chargesRepository.insert(charge);

      const newRemaining = remaining - request.epsilonDelta;
      deps.logger?.info('dp charge recorded', {
        tenantId: request.tenantId,
        opId: request.opId,
        operation: request.operation,
        epsilon: request.epsilonDelta,
        remaining: newRemaining,
      });

      return Object.freeze({
        charge,
        remainingEpsilon: newRemaining,
      });
    },

    async remaining(
      tenantId: string,
      periodStart: string,
    ): Promise<number> {
      const spent = await deps.chargesRepository.sumForPeriod(
        tenantId,
        periodStart,
      );
      const budget = await deps.budgetPort.get(tenantId, periodStart);
      return budget.epsilonTotal - spent;
    },
  });
}
