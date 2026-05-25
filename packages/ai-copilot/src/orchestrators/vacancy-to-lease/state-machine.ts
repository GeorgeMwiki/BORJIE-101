/**
 * VacancyToLeaseOrchestrator — pure transition function.
 *
 * Hand-rolled xstate-style machine. No runtime dep on xstate, zero I/O:
 * every function in this file is synchronous and deterministic so the
 * orchestrator-service can reason about what *would* happen before it
 * reaches out to a domain service.
 *
 * Valid transitions (happy path):
 *
 *   idle
 *     └─ StartPipeline                      → listed
 *   listed
 *     ├─ InquiryReceived                    → receiving_inquiries
 *     └─ Cancelled                          → cancelled
 *   receiving_inquiries
 *     ├─ ApplicantScreened  (pass)          → screening_applicant
 *     ├─ ApplicantRejected                  → rejected
 *     └─ Cancelled                          → cancelled
 *   screening_applicant
 *     ├─ OfferExtended                      → offer_extended
 *     ├─ ApplicantRejected                  → rejected
 *     └─ ApplicantWithdrew                  → withdrew
 *   offer_extended
 *     ├─ OfferSigned                        → offer_signed
 *     ├─ OfferExpired                       → expired
 *     └─ ApplicantWithdrew                  → withdrew
 *   offer_signed
 *     └─ MoveInScheduled                    → move_in_scheduled
 *   move_in_scheduled
 *     └─ LeaseActivated                     → lease_active
 *
 * Branch: any state in [listed, receiving_inquiries, screening_applicant,
 * offer_extended, offer_signed, move_in_scheduled] can also fan out to
 * `awaiting_approval` when the tenant's autonomy policy blocks the
 * auto-transition (handled by orchestrator-service via `ApprovalGranted`/
 * `ApprovalDenied` which map back onto the intended `next_state`).
 */

import type {
  TransitionResult,
  VacancyPipelineEventType,
  VacancyPipelineState,
} from './types.js';

/**
 * Explicit allow-list of (state, event) → nextState. Anything not listed
 * here is rejected by `transition()`. Kept as a flat object of arrays so
 * new transitions are easy to add without touching the function body.
 */
const TRANSITIONS: Readonly<
  Record<
    VacancyPipelineState,
    ReadonlyArray<{
      readonly on: VacancyPipelineEventType;
      readonly to: VacancyPipelineState;
      readonly branch: TransitionResult['branch'];
      readonly reason: string;
    }>
  >
> = {
  idle: [
    {
      on: 'StartPipeline',
      to: 'listed',
      branch: 'happy',
      reason: 'Pipeline started — listing published.',
    },
    {
      on: 'Cancelled',
      to: 'cancelled',
      branch: 'cancelled',
      reason: 'Pipeline cancelled before start.',
    },
  ],
  listed: [
    {
      on: 'InquiryReceived',
      to: 'receiving_inquiries',
      branch: 'happy',
      reason: 'First inquiry received — now screening prospects.',
    },
    {
      on: 'Cancelled',
      to: 'cancelled',
      branch: 'cancelled',
      reason: 'Pipeline cancelled while listed.',
    },
    {
      on: 'ApprovalGranted',
      to: 'receiving_inquiries',
      branch: 'approval',
      reason: 'Approval granted to proceed to inquiry processing.',
    },
  ],
  receiving_inquiries: [
    {
      on: 'ApplicantScreened',
      to: 'screening_applicant',
      branch: 'happy',
      reason: 'Top applicant identified — running full screening.',
    },
    {
      on: 'ApplicantRejected',
      to: 'rejected',
      branch: 'rejected',
      reason: 'Applicant failed credit / background screen.',
    },
    {
      on: 'Cancelled',
      to: 'cancelled',
      branch: 'cancelled',
      reason: 'Pipeline cancelled during inquiry phase.',
    },
    {
      on: 'ApprovalGranted',
      to: 'screening_applicant',
      branch: 'approval',
      reason: 'Approval granted to advance to screening.',
    },
  ],
  screening_applicant: [
    {
      on: 'OfferExtended',
      to: 'offer_extended',
      branch: 'happy',
      reason: 'Screening passed — offer drafted + extended.',
    },
    {
      on: 'ApplicantRejected',
      to: 'rejected',
      branch: 'rejected',
      reason: 'Applicant rejected at screening.',
    },
    {
      on: 'ApplicantWithdrew',
      to: 'withdrew',
      branch: 'withdrew',
      reason: 'Applicant withdrew during screening.',
    },
    {
      on: 'ApprovalGranted',
      to: 'offer_extended',
      branch: 'approval',
      reason: 'Approval granted to extend offer.',
    },
  ],
  offer_extended: [
    {
      on: 'OfferSigned',
      to: 'offer_signed',
      branch: 'happy',
      reason: 'Offer countersigned by applicant.',
    },
    {
      on: 'OfferExpired',
      to: 'expired',
      branch: 'expired',
      reason: 'Offer window expired without signature.',
    },
    {
      on: 'ApplicantWithdrew',
      to: 'withdrew',
      branch: 'withdrew',
      reason: 'Applicant withdrew after offer.',
    },
  ],
  offer_signed: [
    {
      on: 'MoveInScheduled',
      to: 'move_in_scheduled',
      branch: 'happy',
      reason: 'Inspection + utilities scheduled — move-in booked.',
    },
    {
      on: 'ApprovalGranted',
      to: 'move_in_scheduled',
      branch: 'approval',
      reason: 'Approval granted to schedule move-in.',
    },
  ],
  move_in_scheduled: [
    {
      on: 'LeaseActivated',
      to: 'lease_active',
      branch: 'happy',
      reason: 'Lease activated — unit marked filled + waitlist notified.',
    },
    {
      on: 'ApprovalGranted',
      to: 'lease_active',
      branch: 'approval',
      reason: 'Approval granted to activate lease.',
    },
  ],
  lease_active: [],
  awaiting_approval: [
    {
      on: 'ApprovalGranted',
      to: 'listed', // Placeholder — orchestrator-service overrides with intendedState.
      branch: 'approval',
      reason: 'Approval granted — resuming pipeline.',
    },
    {
      on: 'ApprovalDenied',
      to: 'rejected',
      branch: 'rejected',
      reason: 'Approval denied — pipeline halted.',
    },
    {
      on: 'Cancelled',
      to: 'cancelled',
      branch: 'cancelled',
      reason: 'Pipeline cancelled while awaiting approval.',
    },
  ],
  rejected: [],
  withdrew: [],
  expired: [],
  cancelled: [],
};

/**
 * Pure transition. Returns `allowed=false` when the event is not valid
 * for the current state — callers must handle that case by either
 * rejecting the request or routing to `awaiting_approval` via
 * `routeToApproval()` below.
 */
export function transition(
  currentState: VacancyPipelineState,
  event: VacancyPipelineEventType,
): TransitionResult {
  const edges = TRANSITIONS[currentState];
  const match = edges.find((e) => e.on === event);
  if (!match) {
    return {
      nextState: currentState,
      allowed: false,
      reason: `No transition from ${currentState} on ${event}.`,
    };
  }
  return {
    nextState: match.to,
    allowed: true,
    reason: match.reason,
    branch: match.branch,
  };
}

/**
 * When the autonomy policy blocks an auto-advance, the orchestrator
 * routes through `awaiting_approval` with the intended next state
 * memoised so `ApprovalGranted` can resume cleanly.
 */
export function routeToApproval(
  reason: string,
): TransitionResult {
  return {
    nextState: 'awaiting_approval',
    allowed: true,
    reason,
    branch: 'approval',
  };
}

/**
 * Returns `true` iff the given state accepts no further transitions.
 * Helpful for the API-layer guard that refuses `advance` on a dead run.
 */
export function isTerminal(state: VacancyPipelineState): boolean {
  const edges = TRANSITIONS[state];
  return edges.length === 0;
}

/**
 * Introspection helper — used by the docs endpoint + tests to assert
 * every state has exactly the allow-listed outgoing edges.
 */
export function listAllowedEvents(
  state: VacancyPipelineState,
): readonly VacancyPipelineEventType[] {
  return TRANSITIONS[state].map((e) => e.on);
}
