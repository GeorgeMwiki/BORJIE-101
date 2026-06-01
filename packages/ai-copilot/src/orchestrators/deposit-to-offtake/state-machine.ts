/**
 * DepositToOfftakeOrchestrator — pure transition function.
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
 *     ├─ BuyerScreened  (pass)          → screening_buyer
 *     ├─ BuyerRejected                  → rejected
 *     └─ Cancelled                          → cancelled
 *   screening_buyer
 *     ├─ OfferExtended                      → offer_extended
 *     ├─ BuyerRejected                  → rejected
 *     └─ BuyerWithdrew                  → withdrew
 *   offer_extended
 *     ├─ OfferSigned                        → offer_signed
 *     ├─ OfferExpired                       → expired
 *     └─ BuyerWithdrew                  → withdrew
 *   offer_signed
 *     └─ MobilisationScheduled                    → mobilisation_scheduled
 *   mobilisation_scheduled
 *     └─ OfftakeActivated                     → offtake_active
 *
 * Branch: any state in [listed, receiving_inquiries, screening_buyer,
 * offer_extended, offer_signed, mobilisation_scheduled] can also fan out to
 * `awaiting_approval` when the tenant's autonomy policy blocks the
 * auto-transition (handled by orchestrator-service via `ApprovalGranted`/
 * `ApprovalDenied` which map back onto the intended `next_state`).
 */

import type {
  TransitionResult,
  OfftakePipelineEventType,
  OfftakePipelineState,
} from './types.js';

/**
 * Explicit allow-list of (state, event) → nextState. Anything not listed
 * here is rejected by `transition()`. Kept as a flat object of arrays so
 * new transitions are easy to add without touching the function body.
 */
const TRANSITIONS: Readonly<
  Record<
    OfftakePipelineState,
    ReadonlyArray<{
      readonly on: OfftakePipelineEventType;
      readonly to: OfftakePipelineState;
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
      on: 'BuyerScreened',
      to: 'screening_buyer',
      branch: 'happy',
      reason: 'Top buyer identified — running full screening.',
    },
    {
      on: 'BuyerRejected',
      to: 'rejected',
      branch: 'rejected',
      reason: 'Buyer failed credit / background screen.',
    },
    {
      on: 'Cancelled',
      to: 'cancelled',
      branch: 'cancelled',
      reason: 'Pipeline cancelled during inquiry phase.',
    },
    {
      on: 'ApprovalGranted',
      to: 'screening_buyer',
      branch: 'approval',
      reason: 'Approval granted to advance to screening.',
    },
  ],
  screening_buyer: [
    {
      on: 'OfferExtended',
      to: 'offer_extended',
      branch: 'happy',
      reason: 'Screening passed — offtake offer drafted + extended.',
    },
    {
      on: 'BuyerRejected',
      to: 'rejected',
      branch: 'rejected',
      reason: 'Buyer rejected at screening.',
    },
    {
      on: 'BuyerWithdrew',
      to: 'withdrew',
      branch: 'withdrew',
      reason: 'Buyer withdrew during screening.',
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
      reason: 'Offtake offer countersigned by buyer.',
    },
    {
      on: 'OfferExpired',
      to: 'expired',
      branch: 'expired',
      reason: 'Offer window expired without signature.',
    },
    {
      on: 'BuyerWithdrew',
      to: 'withdrew',
      branch: 'withdrew',
      reason: 'Buyer withdrew after offer.',
    },
  ],
  offer_signed: [
    {
      on: 'MobilisationScheduled',
      to: 'mobilisation_scheduled',
      branch: 'happy',
      reason: 'Site inspection + mobilisation scheduled.',
    },
    {
      on: 'ApprovalGranted',
      to: 'mobilisation_scheduled',
      branch: 'approval',
      reason: 'Approval granted to schedule mobilisation.',
    },
  ],
  mobilisation_scheduled: [
    {
      on: 'OfftakeActivated',
      to: 'offtake_active',
      branch: 'happy',
      reason: 'Offtake activated — capacity committed + waitlist notified.',
    },
    {
      on: 'ApprovalGranted',
      to: 'offtake_active',
      branch: 'approval',
      reason: 'Approval granted to activate offtake.',
    },
  ],
  offtake_active: [],
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
  currentState: OfftakePipelineState,
  event: OfftakePipelineEventType,
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
    ...(match.branch !== undefined ? { branch: match.branch } : {}),
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
export function isTerminal(state: OfftakePipelineState): boolean {
  const edges = TRANSITIONS[state];
  return edges.length === 0;
}

/**
 * Introspection helper — used by the docs endpoint + tests to assert
 * every state has exactly the allow-listed outgoing edges.
 */
export function listAllowedEvents(
  state: OfftakePipelineState,
): readonly OfftakePipelineEventType[] {
  return TRANSITIONS[state].map((e) => e.on);
}
