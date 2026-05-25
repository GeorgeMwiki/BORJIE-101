/**
 * platform.evict_tenant — initiate a tenant-eviction Temporal workflow.
 *
 * Risk tier: `destroy`. Eviction is multi-month, multi-step, and legally
 * irreversible once the writ of possession executes. Four-eye approval
 * MANDATORY (the executor also routes through the counter-model review
 * for `destroy` tier — see B5's counter-model package; production wiring
 * lives in C1's `sovereign.ts` integration). The DESTROY classification
 * carried in `riskTier` is what triggers that counter-model invocation.
 *
 * Rollback semantics: an eviction workflow CAN be withdrawn before the
 * writ executes (TZ Land Act §43(4) permits the landlord to discontinue
 * the action up until the day of execution). The tool's rollback signals
 * `withdrawEviction` to the workflow; if the workflow already terminated
 * (writ executed) the signal is a no-op and the human operator is
 * notified via the sovereign-ledger row.
 *
 * 5-eye approval gate metadata:
 *   - Intent:        legally remove a tenant from a property
 *   - Data lineage:  tenant + lease records → court filing system
 *   - Permissions:   platform:eviction:write + platform:ops:write +
 *                    tenant-reachability
 *   - Blast radius:  permanent — the writ of possession is final
 *   - Rollback plan: signal `withdrawEviction` to the workflow up until
 *                    the writ-execution activity completes
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

export const EvictTenantBreachKindSchema = z.enum([
  'rent-arrears',
  'illegal-sublet',
  'property-damage',
  'unauthorised-use',
]);

export const EvictTenantInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  leaseId: z.string().min(1).max(64),
  /** ISO date — when the eviction notice was (or will be) issued. */
  evictionDate: z.string().datetime({ offset: true }),
  /** Optional court-reference if the case was pre-filed. */
  courtRef: z.string().min(1).max(120).optional(),
  /** The breach kind drives the statutory notice period in the workflow. */
  breachKind: EvictTenantBreachKindSchema,
  /** Caller user id (legally required per TZ Land Act). */
  initiatedByUserId: z.string().min(1).max(120),
});

export const EvictTenantOutputSchema = z.object({
  tenantId: z.string(),
  leaseId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  /** Echoes the dispatcher status — `started` is the only success today. */
  status: z.enum(['started']),
  /** When the dispatcher persisted the start call. */
  startedAt: z.string(),
});

export type EvictTenantInput = z.infer<typeof EvictTenantInputSchema>;
export type EvictTenantOutput = z.infer<typeof EvictTenantOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Dispatcher port — invoked to start the underlying Temporal workflow
// ─────────────────────────────────────────────────────────────────────

/**
 * Narrow port the HQ tool calls to start the eviction Temporal workflow.
 * The composition root binds this to
 * `services/api-gateway/.../temporal/eviction-workflow.startEvictionWorkflow`
 * with a real or mock `TemporalClientLike`.
 */
export interface EvictionWorkflowDispatcherPort {
  start(args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly breachKind: 'rent-arrears' | 'illegal-sublet' | 'property-damage' | 'unauthorised-use';
    readonly initiatedByUserId: string;
    readonly evictionDate: string;
    readonly courtRef: string | null;
  }): Promise<{ workflowId: string; runId: string }>;
  /** Signal the workflow to abandon. Idempotent — no-op if already terminal. */
  withdraw(args: {
    readonly workflowId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface EvictTenantDeps {
  readonly evictionDispatcher: EvictionWorkflowDispatcherPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:eviction:write',
  'platform:ops:write',
];

export function createEvictTenantTool(
  deps: EvictTenantDeps,
): HqToolSpec<EvictTenantInput, EvictTenantOutput> {
  return {
    name: 'platform.evict_tenant',
    riskTier: 'destroy',
    description:
      'Initiate a tenant-eviction Temporal workflow. DESTROY-tier; four-eye approval and counter-model review required. Rollback signals the workflow to withdraw (only valid until writ-of-possession executes).',
    inputSchema: EvictTenantInputSchema,
    outputSchema: EvictTenantOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    rollback: async (output, _ctx) => {
      await deps.evictionDispatcher.withdraw({
        workflowId: output.workflowId,
        reason: `automated rollback of ${output.workflowId}`,
      });
    },
    async execute(
      input: EvictTenantInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<EvictTenantOutput>> {
      return withHqTelemetry({
        toolName: 'platform.evict_tenant',
        riskTier: 'destroy',
        approvalRequired: true,
        costEstimateUsd: null,
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:eviction:write + platform:ops:write scopes',
            );
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          let started: { workflowId: string; runId: string };
          try {
            started = await deps.evictionDispatcher.start({
              tenantId: input.tenantId,
              leaseId: input.leaseId,
              breachKind: input.breachKind,
              initiatedByUserId: input.initiatedByUserId,
              evictionDate: input.evictionDate,
              courtRef: input.courtRef ?? null,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `eviction-dispatcher-failed: ${err.message}`
                  : 'eviction-dispatcher-failed: unknown error',
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              leaseId: input.leaseId,
              workflowId: started.workflowId,
              runId: started.runId,
              status: 'started',
              startedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
