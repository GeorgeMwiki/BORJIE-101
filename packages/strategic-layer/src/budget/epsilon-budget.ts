/**
 * `EpsilonBudgetManager` — per-tenant per-period (monthly) ε-budget
 * accounting using Rényi-DP composition (Mironov 2017).
 *
 * Spec: STRATEGIC_DIRECTION_LAYER_SPEC.md §15.7.
 *
 * Composition formula (Mironov 2017 Theorem 1, linear at fixed α):
 *
 *   ε_total(α) = Σ ε_i(α)
 *
 * Conversion to standard (ε, δ)-DP (Mironov 2017 Proposition 3):
 *
 *   ε_eff(δ) = ε_total(α) + log(1/δ) / (α - 1)
 *
 * We default to α = 4 (Google DP team default), δ = 10⁻⁶.
 *
 * Citations:
 *   - Mironov, "Rényi Differential Privacy" (2017-02-24)
 *     https://arxiv.org/abs/1702.07476
 *   - Google differential-privacy library (2024)
 *     https://github.com/google/differential-privacy/
 *   - OpenDP / Opacus reference DP libraries
 */

import { randomUUID } from 'node:crypto';
import {
  type ChargeBudgetInput,
  type ChargeBudgetResult,
  type EpsilonBudget,
  type EpsilonBudgetsRepository,
  type EpsilonLedgerEntry,
  type EpsilonLedgerRepository,
  type InitialiseBudgetInput,
  STRATEGIC_CONSTANTS,
  EpsilonBudgetExhausted,
  StrategicLayerError,
} from '../types.js';
import { computeStrategicAuditHash } from '../audit/audit-chain-link.js';

export interface EpsilonBudgetManagerDeps {
  readonly budgetRepo: EpsilonBudgetsRepository;
  readonly ledgerRepo: EpsilonLedgerRepository;
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export interface EpsilonBudgetManager {
  initialise(input: InitialiseBudgetInput): Promise<EpsilonBudget>;
  charge(input: ChargeBudgetInput): Promise<ChargeBudgetResult>;
  remaining(tenantId: string, periodStart: string): Promise<number>;
  /** Sum a list of ε-charges under Rényi-α composition at fixed α. */
  composeRenyi(
    charges: ReadonlyArray<number>,
    alpha?: number,
  ): number;
  /** Convert a Rényi ε at α to standard (ε, δ)-DP. */
  toEpsilonDelta(
    renyiEpsilon: number,
    alpha?: number,
    delta?: number,
  ): number;
}

export function createEpsilonBudgetManager(
  deps: EpsilonBudgetManagerDeps,
): EpsilonBudgetManager {
  const { budgetRepo, ledgerRepo, now } = deps;

  return {
    async initialise(
      input: InitialiseBudgetInput,
    ): Promise<EpsilonBudget> {
      if (input.totalEpsilon <= 0) {
        throw new StrategicLayerError(
          `totalEpsilon must be > 0 — got ${input.totalEpsilon}`,
          'INVALID_BUDGET_TOTAL',
          { totalEpsilon: input.totalEpsilon },
        );
      }
      assertPeriodFormat(input.periodStart);
      const existing = await budgetRepo.find(
        input.tenantId,
        input.periodStart,
      );
      if (existing !== null) {
        // Idempotent — same period already initialised.
        return existing;
      }
      const createdAt = now().toISOString();
      const auditHash = computeStrategicAuditHash({
        op: 'budget_initialise',
        tenantId: input.tenantId,
        periodStart: input.periodStart,
        totalEpsilon: input.totalEpsilon,
        at: createdAt,
      });
      const row: EpsilonBudget = Object.freeze({
        tenantId: input.tenantId,
        periodStart: input.periodStart,
        totalEpsilon: input.totalEpsilon,
        spentEpsilon: 0,
        createdAt,
        updatedAt: createdAt,
        auditHash,
      });
      return budgetRepo.insert(row);
    },

    async charge(input: ChargeBudgetInput): Promise<ChargeBudgetResult> {
      if (input.chargeEpsilon <= 0) {
        throw new StrategicLayerError(
          `chargeEpsilon must be > 0 — got ${input.chargeEpsilon}`,
          'INVALID_CHARGE',
          { chargeEpsilon: input.chargeEpsilon },
        );
      }
      assertPeriodFormat(input.periodStart);

      // Idempotency — if we have already recorded this (opKind, opId),
      // return the prior charge effect rather than double-counting.
      const priorLedger = await ledgerRepo.findByIdempotencyKey(
        input.tenantId,
        input.opKind,
        input.opId,
      );
      if (priorLedger !== null) {
        const currentBudget = await budgetRepo.find(
          input.tenantId,
          input.periodStart,
        );
        if (currentBudget === null) {
          throw new StrategicLayerError(
            'Idempotent ledger entry exists but budget row is missing — corruption',
            'BUDGET_CORRUPTED',
            { tenantId: input.tenantId, periodStart: input.periodStart },
          );
        }
        return {
          remaining: currentBudget.totalEpsilon - currentBudget.spentEpsilon,
          entry: priorLedger,
        };
      }

      const budget = await budgetRepo.find(
        input.tenantId,
        input.periodStart,
      );
      if (budget === null) {
        throw new StrategicLayerError(
          `No budget initialised: tenant=${input.tenantId} period=${input.periodStart}`,
          'BUDGET_NOT_INITIALISED',
          {
            tenantId: input.tenantId,
            periodStart: input.periodStart,
          },
        );
      }

      const newSpent = budget.spentEpsilon + input.chargeEpsilon;
      if (newSpent > budget.totalEpsilon) {
        throw new EpsilonBudgetExhausted(
          input.tenantId,
          input.periodStart,
          input.chargeEpsilon,
          budget.totalEpsilon - budget.spentEpsilon,
        );
      }

      const recordedAt = now().toISOString();
      const ledgerId = randomUUID();
      const ledgerAuditHash = computeStrategicAuditHash({
        op: 'budget_charge',
        id: ledgerId,
        tenantId: input.tenantId,
        periodStart: input.periodStart,
        chargeEpsilon: input.chargeEpsilon,
        opKind: input.opKind,
        opId: input.opId,
        at: recordedAt,
      });
      const ledgerEntry: EpsilonLedgerEntry = Object.freeze({
        id: ledgerId,
        tenantId: input.tenantId,
        periodStart: input.periodStart,
        chargeEpsilon: input.chargeEpsilon,
        opKind: input.opKind,
        opId: input.opId,
        recordedAt,
        auditHash: ledgerAuditHash,
      });
      await ledgerRepo.insert(ledgerEntry);

      const budgetAuditHash = computeStrategicAuditHash(
        {
          op: 'budget_apply_charge',
          tenantId: input.tenantId,
          periodStart: input.periodStart,
          delta: input.chargeEpsilon,
          ledgerEntryId: ledgerId,
          at: recordedAt,
        },
        budget.auditHash,
      );
      const updated = await budgetRepo.applyCharge(
        input.tenantId,
        input.periodStart,
        input.chargeEpsilon,
        recordedAt,
        budgetAuditHash,
      );

      return {
        remaining: updated.totalEpsilon - updated.spentEpsilon,
        entry: ledgerEntry,
      };
    },

    async remaining(
      tenantId: string,
      periodStart: string,
    ): Promise<number> {
      assertPeriodFormat(periodStart);
      const budget = await budgetRepo.find(tenantId, periodStart);
      if (budget === null) {
        return 0;
      }
      return budget.totalEpsilon - budget.spentEpsilon;
    },

    composeRenyi(
      charges: ReadonlyArray<number>,
      alpha: number = STRATEGIC_CONSTANTS.RENYI_ALPHA,
    ): number {
      if (alpha <= 1) {
        throw new StrategicLayerError(
          `Rényi α must be > 1 — got ${alpha}`,
          'INVALID_RENYI_ALPHA',
          { alpha },
        );
      }
      // Mironov 2017 Theorem 1: linear additive composition at fixed α.
      let sum = 0;
      for (const charge of charges) {
        if (charge < 0) {
          throw new StrategicLayerError(
            `Rényi ε must be ≥ 0 — got ${charge}`,
            'INVALID_RENYI_EPSILON',
            { charge },
          );
        }
        sum += charge;
      }
      return sum;
    },

    toEpsilonDelta(
      renyiEpsilon: number,
      alpha: number = STRATEGIC_CONSTANTS.RENYI_ALPHA,
      delta: number = STRATEGIC_CONSTANTS.RENYI_DELTA,
    ): number {
      if (alpha <= 1) {
        throw new StrategicLayerError(
          `Rényi α must be > 1 — got ${alpha}`,
          'INVALID_RENYI_ALPHA',
          { alpha },
        );
      }
      if (delta <= 0 || delta >= 1) {
        throw new StrategicLayerError(
          `δ must be in (0, 1) — got ${delta}`,
          'INVALID_RENYI_DELTA',
          { delta },
        );
      }
      // Mironov 2017 Proposition 3.
      return renyiEpsilon + Math.log(1 / delta) / (alpha - 1);
    },
  };
}

const PERIOD_REGEX = /^\d{4}-\d{2}-01$/;

function assertPeriodFormat(periodStart: string): void {
  if (!PERIOD_REGEX.test(periodStart)) {
    throw new StrategicLayerError(
      `periodStart must be YYYY-MM-01 — got "${periodStart}"`,
      'INVALID_PERIOD_FORMAT',
      { periodStart },
    );
  }
}
