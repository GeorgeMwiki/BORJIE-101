/**
 * platform.payout_owner — initiate an owner-payout Temporal workflow.
 *
 * Risk tier: `billing`. Money-movement is the canonical Temporal use
 * case (see B3's `owner-payout-workflow.ts`). Four-eye approval +
 * cost-ceiling gate. Sovereign-ledger persisted.
 *
 * Cost-ceiling behaviour:
 *   - The configured `maxPayoutUsdCents` (registry-level hard ceiling)
 *     is the FINAL gate. Any payout exceeding it is refused with
 *     `COST_CEILING_EXCEEDED` even if four-eye approval was granted.
 *   - Additionally, payouts whose USD-equivalent exceeds `extraHilUsdCents`
 *     (default $10k = 1_000_000 cents) demand an EXTRA HIL approval
 *     (5-eye). The tool refuses with `DOMAIN_LIMIT_EXCEEDED` when no
 *     `approvalRecordId` is bound — the gate must have run before the
 *     executor reaches us.
 *
 * Rollback semantics: payout reversal is a `refund` initiation on the
 * downstream bank gateway. The rollback signals the workflow to issue a
 * refund-request activity; if the bank transfer has not yet executed,
 * the workflow simply cancels the reservation instead.
 *
 * 5-eye approval gate metadata:
 *   - Intent:        transfer money from the platform escrow to an owner
 *   - Data lineage:  ledger entries + period boundary → bank gateway
 *   - Permissions:   platform:billing:write + platform:ops:write +
 *                    tenant-reachability
 *   - Blast radius:  recoverable via refund-initiation but reputationally costly
 *   - Rollback plan: signal `refundPayout` to the workflow; cancels the
 *                    bank reservation OR initiates a refund request if
 *                    the wire already left
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAllScopes,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

/** ISO-4217 currency code. Three uppercase letters. */
const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO-4217 code');

export const PayoutOwnerInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  ownerId: z.string().min(1).max(64),
  /** Net amount to pay, in MINOR units of `currency` (TZS cents, etc). */
  amount: z.number().int().positive(),
  currency: CurrencyCodeSchema,
  /** Opaque bank-account reference; format depends on the gateway. */
  bankAccount: z.string().min(1).max(120),
  /** Caller-supplied idempotency token — the dispatcher passes it
   *  through as the workflow id discriminator. Same token → same
   *  workflow id → Temporal de-dupes. */
  idempotencyKey: z.string().min(8).max(120),
  /** Period being settled — workflow uses (ownerId, periodEnd) as id. */
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  initiatedByUserId: z.string().min(1).max(120),
});

export const PayoutOwnerOutputSchema = z.object({
  tenantId: z.string(),
  ownerId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  status: z.enum(['started']),
  amount: z.number().int(),
  currency: z.string(),
  startedAt: z.string(),
});

export type PayoutOwnerInput = z.infer<typeof PayoutOwnerInputSchema>;
export type PayoutOwnerOutput = z.infer<typeof PayoutOwnerOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Dispatcher port
// ─────────────────────────────────────────────────────────────────────

export interface OwnerPayoutWorkflowDispatcherPort {
  start(args: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly amount: number;
    readonly currency: string;
    readonly bankAccount: string;
    readonly idempotencyKey: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly initiatedByUserId: string;
  }): Promise<{ workflowId: string; runId: string }>;
  /** Signal the workflow to refund / cancel. Idempotent. */
  refund(args: {
    readonly workflowId: string;
    readonly reason: string;
  }): Promise<void>;
  /**
   * USD-equivalent of `amount` in the supplied currency. The HQ tool
   * uses this to evaluate the extra-HIL threshold and the ceiling.
   * The dispatcher implementation can pull live FX or use a cached rate;
   * the tool itself stays currency-agnostic.
   */
  estimateUsdCents(args: {
    readonly amount: number;
    readonly currency: string;
  }): Promise<number>;
}

export interface PayoutOwnerDeps {
  readonly ownerPayoutDispatcher: OwnerPayoutWorkflowDispatcherPort;
  /**
   * Hard ceiling for a single payout, in USD cents. Calls exceeding
   * this are refused with `COST_CEILING_EXCEEDED` even after four-eye
   * approval — the ceiling is the FINAL gate.
   */
  readonly maxPayoutUsdCents: number;
  /**
   * Threshold above which an EXTRA HIL approval (5-eye) is required.
   * Defaults to $10,000 (1_000_000 cents) per spec.
   */
  readonly extraHilUsdCents?: number;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:billing:write',
  'platform:ops:write',
];

const DEFAULT_EXTRA_HIL_USD_CENTS = 1_000_000; // $10k

/** Conservative pre-call cost estimate — used for the OTel attribute. */
const COST_ESTIMATE_USD = 0.10;

export function createPayoutOwnerTool(
  deps: PayoutOwnerDeps,
): HqToolSpec<PayoutOwnerInput, PayoutOwnerOutput> {
  const extraHilUsdCents = deps.extraHilUsdCents ?? DEFAULT_EXTRA_HIL_USD_CENTS;
  return {
    name: 'platform.payout_owner',
    riskTier: 'billing',
    description:
      'Initiate an owner-payout Temporal workflow. Four-eye approval + cost-ceiling gate; payouts >$10k USD-equivalent require extra HIL (5-eye). Rollback signals refund / reservation-cancel.',
    inputSchema: PayoutOwnerInputSchema,
    outputSchema: PayoutOwnerOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    costEstimateUsd: COST_ESTIMATE_USD,
    rollback: async (output, _ctx) => {
      await deps.ownerPayoutDispatcher.refund({
        workflowId: output.workflowId,
        reason: `automated rollback of ${output.workflowId}`,
      });
    },
    async execute(
      input: PayoutOwnerInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<PayoutOwnerOutput>> {
      return withHqTelemetry({
        toolName: 'platform.payout_owner',
        riskTier: 'billing',
        approvalRequired: true,
        costEstimateUsd: COST_ESTIMATE_USD,
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:billing:write + platform:ops:write scopes',
            );
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          // Sanity-check period ordering before invoking FX.
          if (Date.parse(input.periodStart) >= Date.parse(input.periodEnd)) {
            return refusal(
              'INVARIANT_VIOLATION',
              `periodStart (${input.periodStart}) must be < periodEnd (${input.periodEnd})`,
            );
          }
          let usdCents: number;
          try {
            usdCents = await deps.ownerPayoutDispatcher.estimateUsdCents({
              amount: input.amount,
              currency: input.currency,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `payout-fx-estimate-failed: ${err.message}`
                  : 'payout-fx-estimate-failed: unknown error',
            };
          }
          if (usdCents > deps.maxPayoutUsdCents) {
            return refusal(
              'COST_CEILING_EXCEEDED',
              `payout USD-equivalent ${usdCents} exceeds ceiling ${deps.maxPayoutUsdCents}`,
            );
          }
          if (usdCents > extraHilUsdCents && !ctx.approvalRecordId) {
            // Extra HIL (5-eye) required and the gate did not run.
            return refusal(
              'DOMAIN_LIMIT_EXCEEDED',
              `payout USD-equivalent ${usdCents} exceeds extra-HIL threshold ${extraHilUsdCents}; 5-eye approval missing`,
            );
          }
          let started: { workflowId: string; runId: string };
          try {
            started = await deps.ownerPayoutDispatcher.start({
              tenantId: input.tenantId,
              ownerId: input.ownerId,
              amount: input.amount,
              currency: input.currency,
              bankAccount: input.bankAccount,
              idempotencyKey: input.idempotencyKey,
              periodStart: input.periodStart,
              periodEnd: input.periodEnd,
              initiatedByUserId: input.initiatedByUserId,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `payout-dispatcher-failed: ${err.message}`
                  : 'payout-dispatcher-failed: unknown error',
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              ownerId: input.ownerId,
              workflowId: started.workflowId,
              runId: started.runId,
              status: 'started',
              amount: input.amount,
              currency: input.currency,
              startedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
