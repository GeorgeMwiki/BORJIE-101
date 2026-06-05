/**
 * platform.suspend_licence — initiate a licence-suspension Temporal workflow.
 *
 * Risk tier: `destroy`. A licence-suspension is multi-month, multi-step, and
 * legally irreversible once the Mining Commission revocation executes. Four-eye
 * approval MANDATORY (the executor also routes through the counter-model review
 * for `destroy` tier — see B5's counter-model package; production wiring
 * lives in C1's `sovereign.ts` integration). The DESTROY classification
 * carried in `riskTier` is what triggers that counter-model invocation.
 *
 * Rollback semantics: a licence-suspension workflow CAN be withdrawn before the
 * revocation executes (Mining Act 2010 (am.2017) permits the owner to
 * discontinue the action up until the day of execution). The tool's rollback
 * signals `withdrawSuspension` to the workflow; if the workflow already
 * terminated (revocation executed) the signal is a no-op and the human operator
 * is notified via the sovereign-ledger row.
 *
 * 5-eye approval gate metadata:
 *   - Intent:        legally suspend an operator's licence on a site
 *   - Data lineage:  operator + licence records → regulatory filing system
 *   - Permissions:   platform:licence-suspension:write + platform:ops:write +
 *                    tenant-reachability
 *   - Blast radius:  permanent — the Mining Commission revocation is final
 *   - Rollback plan: signal `withdrawSuspension` to the workflow up until
 *                    the revocation-execution activity completes
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

export const SuspendLicenceBreachKindSchema = z.enum([
  'illicit-extraction',
  'equipment-theft',
  'environmental-damage',
  'unauthorised-operation',
]);

export const SuspendLicenceInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  licenceId: z.string().min(1).max(64),
  /** ISO date — when the suspension notice was (or will be) issued. */
  suspensionDate: z.string().datetime({ offset: true }),
  /** Optional hearing-reference if the case was pre-filed. */
  hearingRef: z.string().min(1).max(120).optional(),
  /** The breach kind drives the statutory notice period in the workflow. */
  breachKind: SuspendLicenceBreachKindSchema,
  /** Caller user id (legally required per Mining Act 2010). */
  initiatedByUserId: z.string().min(1).max(120),
});

export const SuspendLicenceOutputSchema = z.object({
  tenantId: z.string(),
  licenceId: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  /** Echoes the dispatcher status — `started` is the only success today. */
  status: z.enum(['started']),
  /** When the dispatcher persisted the start call. */
  startedAt: z.string(),
});

export type SuspendLicenceInput = z.infer<typeof SuspendLicenceInputSchema>;
export type SuspendLicenceOutput = z.infer<typeof SuspendLicenceOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Dispatcher port — invoked to start the underlying Temporal workflow
// ─────────────────────────────────────────────────────────────────────

/**
 * Narrow port the HQ tool calls to start the licence-suspension Temporal
 * workflow. The composition root binds this to
 * `services/api-gateway/.../temporal/licence-suspension-workflow.startLicenceSuspensionWorkflow`
 * with a real or mock `TemporalClientLike`.
 */
export interface LicenceSuspensionWorkflowDispatcherPort {
  start(args: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly breachKind:
      | 'illicit-extraction'
      | 'equipment-theft'
      | 'environmental-damage'
      | 'unauthorised-operation';
    readonly initiatedByUserId: string;
    readonly suspensionDate: string;
    readonly hearingRef: string | null;
  }): Promise<{ workflowId: string; runId: string }>;
  /** Signal the workflow to abandon. Idempotent — no-op if already terminal. */
  withdraw(args: {
    readonly workflowId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface SuspendLicenceDeps {
  readonly licenceSuspensionDispatcher: LicenceSuspensionWorkflowDispatcherPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:licence-suspension:write',
  'platform:ops:write',
];

export function createSuspendLicenceTool(
  deps: SuspendLicenceDeps,
): HqToolSpec<SuspendLicenceInput, SuspendLicenceOutput> {
  return {
    name: 'platform.suspend_licence',
    riskTier: 'destroy',
    description:
      'Initiate a licence-suspension Temporal workflow. DESTROY-tier; four-eye approval and counter-model review required. Rollback signals the workflow to withdraw (only valid until the Mining Commission revocation executes).',
    inputSchema: SuspendLicenceInputSchema,
    outputSchema: SuspendLicenceOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    rollback: async (output, _ctx) => {
      await deps.licenceSuspensionDispatcher.withdraw({
        workflowId: output.workflowId,
        reason: `automated rollback of ${output.workflowId}`,
      });
    },
    async execute(
      input: SuspendLicenceInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<SuspendLicenceOutput>> {
      return withHqTelemetry({
        toolName: 'platform.suspend_licence',
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
              'caller lacks platform:licence-suspension:write + platform:ops:write scopes',
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
            started = await deps.licenceSuspensionDispatcher.start({
              tenantId: input.tenantId,
              licenceId: input.licenceId,
              breachKind: input.breachKind,
              initiatedByUserId: input.initiatedByUserId,
              suspensionDate: input.suspensionDate,
              hearingRef: input.hearingRef ?? null,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `licence-suspension-dispatcher-failed: ${err.message}`
                  : 'licence-suspension-dispatcher-failed: unknown error',
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              licenceId: input.licenceId,
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
