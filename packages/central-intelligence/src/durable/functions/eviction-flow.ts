/**
 * Eviction flow — multi-day durable workflow (SKELETAL).
 *
 * The eviction process is the canonical long-horizon flow that motivated
 * adopting Inngest in the first place: a notice-of-default issued today
 * needs to wait the legally-mandated cure period (≤ 30 days in TZ),
 * then check whether the tenant cured the breach, and only then escalate
 * to the next step. The legacy in-process executor cannot survive a
 * server restart inside that wait — Inngest's `step.sleepUntil(...)`
 * suspends the function and resumes it on schedule.
 *
 * Scope of this file: DECLARATIONS + TOOL-CALL STUBS. The wiring is
 * intentionally skeletal; real production logic lives in:
 *   - `@borjie/tenant-lifecycle` (eviction service)
 *   - `@borjie/notifications`    (notice issuance)
 *   - `@borjie/payments`         (cure-payment lookup)
 *
 * The stubs document the step boundaries so future contributors know
 * exactly where the checkpoint goes. Each `step.run(...)` becomes a
 * resumable unit — a crash in step 4 does NOT re-issue step 1's notice.
 *
 * Compliance note: the cure period MUST come from the per-jurisdiction
 * config (we never hard-code "30 days" in business logic — see
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

export const EVICTION_FLOW_STARTED_EVENT = 'eviction-flow/started';

export interface EvictionFlowStartedEvent {
  readonly name: typeof EVICTION_FLOW_STARTED_EVENT;
  readonly data: {
    readonly tenantId: string;
    readonly leaseId: string;
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

export interface EvictionFlowServices {
  /** Issue the first notice-of-default to the tenant. */
  readonly issueNoticeOfDefault: (args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly proposerUserId: string;
  }) => Promise<{ readonly noticeId: string }>;

  /**
   * After the cure period expires, check whether the tenant has paid
   * down enough arrears to abort the eviction.
   */
  readonly checkCureStatus: (args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly asOf: string;
  }) => Promise<{ readonly cured: boolean; readonly outstandingCents: number }>;

  /**
   * Escalate to the regulator-grade eviction proposal (routes through
   * the four-eye approval gate downstream).
   */
  readonly proposeEviction: (args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly proposerUserId: string;
    readonly flowId: string;
  }) => Promise<{ readonly approvalActionId: string }>;

  /**
   * Close out the flow when the tenant cures — drops audit + notifies
   * the property manager.
   */
  readonly closeFlowCured: (args: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly flowId: string;
    readonly outstandingCents: number;
  }) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Function registration
// ---------------------------------------------------------------------------

export interface EvictionFlowDeps {
  readonly composition: InngestComposition;
  readonly services: EvictionFlowServices;
}

/**
 * Register the eviction-flow Inngest function with the given client.
 *
 * Step layout:
 *   1. `issue-notice`        — emit notice-of-default; idempotent on the
 *                              service side (keyed by `leaseId`).
 *   2. `sleep-until-cure`    — Inngest suspends the function; the
 *                              runtime resumes the handler at
 *                              `cureExpiresAt` even if our service has
 *                              been restarted N times in between.
 *   3. `check-cure`          — re-read arrears; tenant may have paid.
 *   4. `branch`              — either close the flow (cured) or escalate
 *                              to the regulator-grade proposal. Both
 *                              are wrapped as `step.run` so the branch
 *                              decision is itself a checkpoint.
 */
export function registerEvictionFlow(
  deps: EvictionFlowDeps,
): DurableFunctionDefinition {
  const { composition, services } = deps;

  return composition.client.createFunction({
    id: `${composition.config.appId}.eviction-flow`,
    name: 'eviction-flow (durable, multi-day)',
    trigger: { event: EVICTION_FLOW_STARTED_EVENT },
    handler: async (ctx: DurableFunctionContext) => {
      const event = ctx.event as EvictionFlowStartedEvent;
      const { tenantId, leaseId, proposerUserId, cureExpiresAt, flowId } =
        event.data;
      const stepKey = `${flowId}:${tenantId}:${leaseId}`;

      // Step 1 — issue the notice. Service-side dedupe keyed on
      // `leaseId + flowId` so replay is safe.
      const notice = await ctx.step.run(`issue-notice:${stepKey}`, () =>
        services.issueNoticeOfDefault({ tenantId, leaseId, proposerUserId }),
      );

      // Step 2 — suspend until the cure window closes. This is the
      // bit the legacy in-process executor cannot do safely.
      if (ctx.step.sleepUntil) {
        await ctx.step.sleepUntil(
          `sleep-until-cure:${stepKey}`,
          cureExpiresAt,
        );
      }

      // Step 3 — re-read arrears.
      const cure = await ctx.step.run(`check-cure:${stepKey}`, () =>
        services.checkCureStatus({
          tenantId,
          leaseId,
          asOf: cureExpiresAt,
        }),
      );

      // Step 4 — branch. Both branches are themselves checkpointed so
      // a crash inside the branch body does not replay the cure check.
      if (cure.cured) {
        await ctx.step.run(`close-cured:${stepKey}`, () =>
          services.closeFlowCured({
            tenantId,
            leaseId,
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

      const proposal = await ctx.step.run(`propose-eviction:${stepKey}`, () =>
        services.proposeEviction({
          tenantId,
          leaseId,
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
