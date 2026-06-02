/**
 * licence-suspension-workflow — Temporal workflow definition for mining
 * licence suspension (multi-month, multi-step, regulator-grade).
 *
 * Why Temporal here? See `./temporal-client.ts` header — licence
 * suspension legally requires a deterministic, audit-replayable history
 * of:
 *
 *   1. issueNotice(tenantId, breachKind, statutoryDays) — TZ Mining
 *      Act requires written notice; statutoryDays varies by
 *      breach kind (illicit-extraction = 60d, equipment-theft = 30d).
 *   2. WAIT for statutoryDays (Temporal `sleep`) — the workflow
 *      survives process restarts and resumes the timer.
 *   3. filePossessionClaim(tenantId, courtId) — files in District
 *      Land Tribunal. The activity returns the court reference.
 *   4. WAIT for hearingDate signal — court schedules vary; the
 *      workflow blocks on a `setHearingDate` signal.
 *   5. executeWritOfPossession(tenantId, writRef) — terminal
 *      activity, compensating if rejected.
 *
 * Phase B (this PR): types + workflow + activity SIGNATURES only.
 * The bodies delegate to a `delegateTo` callback so Phase C can
 * swap in real licence-suspension-court-gateway calls without touching
 * the workflow shape.
 *
 * Phase C follow-ups (#33):
 *   - Replace `delegateTo` with proxyActivities() from
 *     @temporalio/workflow
 *   - Provide real activity implementations via the worker registry
 *   - Add compensation handler for writ rejection
 *   - Wire the workflow start from agency executor (licence suspension
 *     is the output of a `licence.suspend` HQ tool)
 */

import {
  type TemporalClientLike,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from './temporal-client.js';

export type LicenceSuspensionBreachKind =
  | 'illicit-extraction'
  | 'equipment-theft'
  | 'environmental-damage'
  | 'unauthorised-operation';

export interface LicenceSuspensionWorkflowInput {
  readonly tenantId: string;
  readonly licenceId: string;
  readonly breachKind: LicenceSuspensionBreachKind;
  /** Mandatory in TZ for any judicial step — caller responsible. */
  readonly initiatedByUserId: string;
  /** Optional override on statutory notice period. Defaults map per
   *  breachKind below. */
  readonly statutoryDaysOverride?: number;
}

export interface LicenceSuspensionWorkflowResult {
  readonly tenantId: string;
  readonly licenceId: string;
  /** Final state — `executed` when writ of possession completed,
   *  `withdrawn` when the workflow was cancelled, `failed-court`
   *  when the court rejected the claim. */
  readonly outcome: 'executed' | 'withdrawn' | 'failed-court';
  readonly courtRef: string | null;
  readonly writRef: string | null;
}

/** Default notice periods per breach. TZ Mining Act (licence-suspension). */
export const LICENCE_SUSPENSION_STATUTORY_DAYS: Readonly<Record<LicenceSuspensionBreachKind, number>> = {
  'illicit-extraction': 60,
  'equipment-theft': 30,
  'environmental-damage': 14,
  'unauthorised-operation': 30,
};

// ---------------------------------------------------------------------------
// Activity signatures — Phase C bodies will be Temporal activity
// proxies; Phase B uses a delegate callback so tests can pin shape.
// ---------------------------------------------------------------------------

export interface LicenceSuspensionActivities {
  issueNotice(args: {
    tenantId: string;
    licenceId: string;
    breachKind: LicenceSuspensionBreachKind;
    statutoryDays: number;
  }): Promise<{ noticeId: string; issuedAt: string }>;

  filePossessionClaim(args: {
    tenantId: string;
    licenceId: string;
    noticeId: string;
  }): Promise<{ courtRef: string; filedAt: string }>;

  executeWritOfPossession(args: {
    tenantId: string;
    licenceId: string;
    courtRef: string;
  }): Promise<{ writRef: string; outcome: 'executed' | 'failed-court' }>;
}

// ---------------------------------------------------------------------------
// Workflow body — delegates to a callback so Phase B can test the
// signature without a real Temporal runtime.
// ---------------------------------------------------------------------------

export interface LicenceSuspensionWorkflowDeps {
  readonly activities: LicenceSuspensionActivities;
  /** Sleeper for the statutory waiting period. In Temporal this is
   *  replaced by `sleep()` from `@temporalio/workflow`. Tests inject
   *  a no-op. */
  readonly sleep: (ms: number) => Promise<void>;
  /** Awaits the `setHearingDate` signal. Phase C uses
   *  `condition()` from @temporalio/workflow. */
  readonly awaitHearingDate: () => Promise<{ hearingDate: string }>;
}

/**
 * Pure workflow body. Composition over inheritance: Phase C wraps
 * this body inside `@temporalio/workflow`'s `defineWorkflow`. Until
 * then we treat it as a plain async function that takes deps.
 */
export async function licenceSuspensionWorkflowBody(
  input: LicenceSuspensionWorkflowInput,
  deps: LicenceSuspensionWorkflowDeps,
): Promise<LicenceSuspensionWorkflowResult> {
  const statutoryDays =
    input.statutoryDaysOverride ?? LICENCE_SUSPENSION_STATUTORY_DAYS[input.breachKind];

  const notice = await deps.activities.issueNotice({
    tenantId: input.tenantId,
    licenceId: input.licenceId,
    breachKind: input.breachKind,
    statutoryDays,
  });
  // Statutory wait — Temporal sleep is the durable primitive in C.
  await deps.sleep(statutoryDays * 24 * 60 * 60 * 1000);
  const filing = await deps.activities.filePossessionClaim({
    tenantId: input.tenantId,
    licenceId: input.licenceId,
    noticeId: notice.noticeId,
  });
  await deps.awaitHearingDate();
  const writ = await deps.activities.executeWritOfPossession({
    tenantId: input.tenantId,
    licenceId: input.licenceId,
    courtRef: filing.courtRef,
  });
  return {
    tenantId: input.tenantId,
    licenceId: input.licenceId,
    outcome: writ.outcome === 'executed' ? 'executed' : 'failed-court',
    courtRef: filing.courtRef,
    writRef: writ.writRef,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher — composition root uses this to start the workflow.
// Uses the narrow `TemporalClientLike` port so MockTemporalClient
// works in tests.
// ---------------------------------------------------------------------------

export interface StartLicenceSuspensionWorkflowArgs {
  readonly client: TemporalClientLike;
  readonly input: LicenceSuspensionWorkflowInput;
}

/** Build a deterministic workflow id — re-starting with the same
 *  id is a no-op in Temporal (single-instance constraint). */
export function licenceSuspensionWorkflowId(licenceId: string): string {
  return `licence-suspension-${licenceId}`;
}

export async function startLicenceSuspensionWorkflow(
  args: StartLicenceSuspensionWorkflowArgs,
): Promise<{ workflowId: string; runId: string }> {
  const handle = await args.client.start({
    workflowId: licenceSuspensionWorkflowId(args.input.licenceId),
    workflowType: TEMPORAL_WORKFLOW_TYPES.LICENCE_SUSPENSION,
    taskQueue: TEMPORAL_TASK_QUEUES.LICENCE_SUSPENSION,
    args: [args.input],
  });
  return { workflowId: handle.workflowId, runId: handle.runId };
}
