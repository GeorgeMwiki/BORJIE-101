/**
 * eviction-workflow — Temporal workflow definition for tenant
 * eviction (multi-month, multi-step, regulator-grade).
 *
 * Why Temporal here? See `./temporal-client.ts` header — eviction
 * legally requires a deterministic, audit-replayable history of:
 *
 *   1. issueNotice(tenantId, breachKind, statutoryDays) — TZ Land
 *      Act §43(2) requires written notice; statutoryDays varies by
 *      breach kind (rent-arrears = 60d, illegal-sublet = 30d).
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
 * swap in real eviction-court-gateway calls without touching the
 * workflow shape.
 *
 * Phase C follow-ups (#33):
 *   - Replace `delegateTo` with proxyActivities() from
 *     @temporalio/workflow
 *   - Provide real activity implementations via the worker registry
 *   - Add compensation handler for writ rejection
 *   - Wire the workflow start from agency executor (eviction is the
 *     output of a `tenant.evict` HQ tool)
 */

import {
  type TemporalClientLike,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from './temporal-client.js';

export type EvictionBreachKind =
  | 'rent-arrears'
  | 'illegal-sublet'
  | 'property-damage'
  | 'unauthorised-use';

export interface EvictionWorkflowInput {
  readonly tenantId: string;
  readonly leaseId: string;
  readonly breachKind: EvictionBreachKind;
  /** Mandatory in TZ for any judicial step — caller responsible. */
  readonly initiatedByUserId: string;
  /** Optional override on statutory notice period. Defaults map per
   *  breachKind below. */
  readonly statutoryDaysOverride?: number;
}

export interface EvictionWorkflowResult {
  readonly tenantId: string;
  readonly leaseId: string;
  /** Final state — `executed` when writ of possession completed,
   *  `withdrawn` when the workflow was cancelled, `failed-court`
   *  when the court rejected the claim. */
  readonly outcome: 'executed' | 'withdrawn' | 'failed-court';
  readonly courtRef: string | null;
  readonly writRef: string | null;
}

/** Default notice periods per breach. TZ Land Act §43(2). */
export const EVICTION_STATUTORY_DAYS: Readonly<Record<EvictionBreachKind, number>> = {
  'rent-arrears': 60,
  'illegal-sublet': 30,
  'property-damage': 14,
  'unauthorised-use': 30,
};

// ---------------------------------------------------------------------------
// Activity signatures — Phase C bodies will be Temporal activity
// proxies; Phase B uses a delegate callback so tests can pin shape.
// ---------------------------------------------------------------------------

export interface EvictionActivities {
  issueNotice(args: {
    tenantId: string;
    leaseId: string;
    breachKind: EvictionBreachKind;
    statutoryDays: number;
  }): Promise<{ noticeId: string; issuedAt: string }>;

  filePossessionClaim(args: {
    tenantId: string;
    leaseId: string;
    noticeId: string;
  }): Promise<{ courtRef: string; filedAt: string }>;

  executeWritOfPossession(args: {
    tenantId: string;
    leaseId: string;
    courtRef: string;
  }): Promise<{ writRef: string; outcome: 'executed' | 'failed-court' }>;
}

// ---------------------------------------------------------------------------
// Workflow body — delegates to a callback so Phase B can test the
// signature without a real Temporal runtime.
// ---------------------------------------------------------------------------

export interface EvictionWorkflowDeps {
  readonly activities: EvictionActivities;
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
export async function tenantEvictionWorkflowBody(
  input: EvictionWorkflowInput,
  deps: EvictionWorkflowDeps,
): Promise<EvictionWorkflowResult> {
  const statutoryDays =
    input.statutoryDaysOverride ?? EVICTION_STATUTORY_DAYS[input.breachKind];

  const notice = await deps.activities.issueNotice({
    tenantId: input.tenantId,
    leaseId: input.leaseId,
    breachKind: input.breachKind,
    statutoryDays,
  });
  // Statutory wait — Temporal sleep is the durable primitive in C.
  await deps.sleep(statutoryDays * 24 * 60 * 60 * 1000);
  const filing = await deps.activities.filePossessionClaim({
    tenantId: input.tenantId,
    leaseId: input.leaseId,
    noticeId: notice.noticeId,
  });
  await deps.awaitHearingDate();
  const writ = await deps.activities.executeWritOfPossession({
    tenantId: input.tenantId,
    leaseId: input.leaseId,
    courtRef: filing.courtRef,
  });
  return {
    tenantId: input.tenantId,
    leaseId: input.leaseId,
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

export interface StartEvictionWorkflowArgs {
  readonly client: TemporalClientLike;
  readonly input: EvictionWorkflowInput;
}

/** Build a deterministic workflow id — re-starting with the same
 *  id is a no-op in Temporal (single-instance constraint). */
export function evictionWorkflowId(leaseId: string): string {
  return `eviction-${leaseId}`;
}

export async function startEvictionWorkflow(
  args: StartEvictionWorkflowArgs,
): Promise<{ workflowId: string; runId: string }> {
  const handle = await args.client.start({
    workflowId: evictionWorkflowId(args.input.leaseId),
    workflowType: TEMPORAL_WORKFLOW_TYPES.EVICTION,
    taskQueue: TEMPORAL_TASK_QUEUES.EVICTION,
    args: [args.input],
  });
  return { workflowId: handle.workflowId, runId: handle.runId };
}
