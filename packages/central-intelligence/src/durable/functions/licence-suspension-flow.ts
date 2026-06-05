/**
 * Licence-suspension flow — multi-day durable workflow (SKELETAL).
 *
 * The licence-suspension process is the canonical long-horizon flow that
 * motivated adopting Inngest in the first place: a notice-of-default issued
 * today needs to wait the legally-mandated cure period (sourced from the
 * per-jurisdiction config — see `cureExpiresAt` on the event payload), then
 * check whether the operator cured the breach, and only then escalate to the
 * next step. The legacy in-process executor cannot survive a server restart
 * inside that wait — Inngest's `step.sleepUntil(...)` suspends the function
 * and resumes it on schedule.
 *
 * Scope of this file: DECLARATIONS + TOOL-CALL STUBS. The wiring is
 * intentionally skeletal; real production logic lives in:
 *   - `@borjie/operator-lifecycle` (licence-suspension service)
 *   - `@borjie/notifications`       (notice issuance)
 *   - `@borjie/payments`            (cure-payment lookup)
 *
 * The stubs document the step boundaries so future contributors know
 * exactly where the checkpoint goes. Each `step.run(...)` becomes a
 * resumable unit — a crash in step 4 does NOT re-issue step 1's notice.
 *
 * Compliance note: the cure period MUST come from the per-jurisdiction
 * config (we never hard-code a statutory window in business logic — see
 * `feedback_world_starting_tz`). The stub below pulls it from the
 * event payload so the orchestrator can vary it per jurisdiction.
 */

import type {
  DurableFunctionContext,
  DurableFunctionDefinition,
  InngestComposition,
} from '../inngest-client.js';

// ---------------------------------------------------------------------------
// Event contract
// ---------------------------------------------------------------------------

export const LICENCE_SUSPENSION_FLOW_STARTED_EVENT = 'licence-suspension-flow/started';

export interface LicenceSuspensionFlowStartedEvent {
  readonly name: typeof LICENCE_SUSPENSION_FLOW_STARTED_EVENT;
  readonly data: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly proposerUserId: string;
    /** ISO-8601 timestamp at which the cure period expires. */
    readonly cureExpiresAt: string;
    /** Idempotency key — duplicate events with the same id are deduped. */
    readonly flowId: string;
  };
}

// ---------------------------------------------------------------------------
// Structural ports — declare what services the flow depends on, but do
// NOT import them. The composition root injects the real adapters.
// ---------------------------------------------------------------------------

export interface LicenceSuspensionFlowServices {
  /** Issue the first notice-of-default to the operator. */
  readonly issueNoticeOfDefault: (args: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly proposerUserId: string;
  }) => Promise<{ readonly noticeId: string }>;

  /**
   * After the cure period expires, check whether the operator has paid
   * down enough outstanding royalties to abort the suspension.
   */
  readonly checkCureStatus: (args: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly asOf: string;
  }) => Promise<{ readonly cured: boolean; readonly outstandingCents: number }>;

  /**
   * Escalate to the regulator-grade licence-suspension proposal (routes
   * through the four-eye approval gate downstream).
   */
  readonly proposeSuspension: (args: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly proposerUserId: string;
    readonly flowId: string;
  }) => Promise<{ readonly approvalActionId: string }>;

  /**
   * Close out the flow when the operator cures — drops audit + notifies
   * the owner.
   */
  readonly closeFlowCured: (args: {
    readonly tenantId: string;
    readonly licenceId: string;
    readonly flowId: string;
    readonly outstandingCents: number;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Function registration
// ---------------------------------------------------------------------------

export interface LicenceSuspensionFlowDeps {
  readonly composition: InngestComposition;
  readonly services: LicenceSuspensionFlowServices;
}

/**
 * Register the licence-suspension-flow Inngest function with the given client.
 *
 * Step layout:
 *   1. `issue-notice`        — emit notice-of-default; idempotent on the
 *                              service side (keyed by `licenceId`).
 *   2. `sleep-until-cure`    — Inngest suspends the function; the
 *                              runtime resumes the handler at
 *                              `cureExpiresAt` even if our service has
 *                              been restarted N times in between.
 *   3. `check-cure`          — re-read outstanding royalties; operator may
 *                              have paid.
 *   4. `branch`              — either close the flow (cured) or escalate
 *                              to the regulator-grade proposal. Both
 *                              are wrapped as `step.run` so the branch
 *                              decision is itself a checkpoint.
 */
export function registerLicenceSuspensionFlow(
  deps: LicenceSuspensionFlowDeps,
): DurableFunctionDefinition {
  const { composition, services } = deps;

  return composition.client.createFunction({
    id: `${composition.config.appId}.licence-suspension-flow`,
    name: 'licence-suspension-flow (durable, multi-day)',
    trigger: { event: LICENCE_SUSPENSION_FLOW_STARTED_EVENT },
    handler: async (ctx: DurableFunctionContext) => {
      const event = ctx.event as LicenceSuspensionFlowStartedEvent;
      const { tenantId, licenceId, proposerUserId, cureExpiresAt, flowId } =
        event.data;
      const stepKey = `${flowId}:${tenantId}:${licenceId}`;

      // Step 1 — issue the notice. Service-side dedupe keyed on
      // `licenceId + flowId` so replay is safe.
      const notice = await ctx.step.run(`issue-notice:${stepKey}`, () =>
        services.issueNoticeOfDefault({ tenantId, licenceId, proposerUserId }),
      );

      // Step 2 — suspend until the cure window closes. This is the
      // bit the legacy in-process executor cannot do safely.
      if (ctx.step.sleepUntil) {
        await ctx.step.sleepUntil(
          `sleep-until-cure:${stepKey}`,
          cureExpiresAt,
        );
      }

      // Step 3 — re-read outstanding royalties.
      const cure = await ctx.step.run(`check-cure:${stepKey}`, () =>
        services.checkCureStatus({
          tenantId,
          licenceId,
          asOf: cureExpiresAt,
        }),
      );

      // Step 4 — branch. Both branches are themselves checkpointed so
      // a crash inside the branch body does not replay the cure check.
      if (cure.cured) {
        await ctx.step.run(`close-cured:${stepKey}`, () =>
          services.closeFlowCured({
            tenantId,
            licenceId,
            flowId,
            outstandingCents: cure.outstandingCents,
          }),
        );
        return {
          flowId,
          outcome: 'cured' as const,
          noticeId: notice.noticeId,
          outstandingCents: cure.outstandingCents,
        };
      }

      const proposal = await ctx.step.run(`propose-suspension:${stepKey}`, () =>
        services.proposeSuspension({
          tenantId,
          licenceId,
          proposerUserId,
          flowId,
        }),
      );

      return {
        flowId,
        outcome: 'escalated' as const,
        noticeId: notice.noticeId,
        approvalActionId: proposal.approvalActionId,
        outstandingCents: cure.outstandingCents,
      };
    },
  });
}
