/**
 * MiningEvent — the closed set of operational facts the Borjie
 * mining-ops ledger records.
 *
 * Ported from @litfin/ledger LendingEvent. The store mechanics are
 * verbatim; the event TYPES are the mining-domain meat (shift /
 * production / chain-of-custody / royalty).
 *
 * Every event:
 *   - Carries a `type` discriminator.
 *   - Carries an `occurredAt` ISO-8601 timestamp set by the caller
 *     (the SOURCE truth time; distinct from the store's `recordedAt`
 *     which is when WE saw the event).
 *   - Is JSON-serialisable; no Dates, no functions.
 *
 * The set is intentionally narrow. Adding a new event type requires:
 *   1. Adding it to MiningEventType.
 *   2. Adding the typed payload below.
 *   3. Adding a database CHECK constraint entry (see migration).
 *   4. Adding a projector reducer (when needed).
 * That mechanical cost is the point — the ledger is supposed to feel
 * heavy to extend.
 *
 * Monetary amounts are integer minor units (e.g. cents of TZS). The
 * `currency` field is ISO 4217 (TZS, USD, KES, UGX, etc.). Storing
 * an integer minor unit avoids float drift over thousands of
 * royalty / payout events.
 *
 * Mass / volume amounts are integer micro-units (grams * 1000 for
 * tiny amounts, kg * 1000 for bulk) to avoid float drift on small-
 * scale gold weighings.
 */

export type MiningEventType =
  | "shift_started"
  | "shift_paused"
  | "shift_resumed"
  | "shift_ended"
  | "production_recorded"
  | "production_reversed"
  | "sample_assayed"
  | "consignment_sealed"
  | "consignment_dispatched"
  | "consignment_received"
  | "royalty_assessed"
  | "royalty_paid"
  | "payout_scheduled"
  | "payout_disbursed"
  | "payout_reversed"
  | "incident_logged"
  | "incident_resolved"
  | "operation_closed";

interface BaseEvent {
  readonly occurredAt: string;
  /** Optional user-facing memo for the audit timeline. */
  readonly memo?: string;
  /** Optional officer / system actor that recorded the event. */
  readonly actor?: {
    readonly kind: "manager" | "system" | "worker" | "owner" | "regulator";
    readonly id: string;
  };
}

export interface ShiftStarted extends BaseEvent {
  readonly type: "shift_started";
  readonly siteId: string;
  readonly shiftPlanId: string;
  readonly managerId: string;
  readonly headcount: number;
  readonly plannedMineralCode: string;
}

export interface ShiftPaused extends BaseEvent {
  readonly type: "shift_paused";
  readonly reason: "weather" | "safety" | "equipment" | "regulator" | "other";
}

export interface ShiftResumed extends BaseEvent {
  readonly type: "shift_resumed";
}

export interface ShiftEnded extends BaseEvent {
  readonly type: "shift_ended";
  readonly summary: {
    readonly netGramsMicro: number;
    readonly headcountFinal: number;
    readonly incidentCount: number;
  };
}

export interface ProductionRecorded extends BaseEvent {
  readonly type: "production_recorded";
  readonly mineralCode: string;
  readonly massMicroGrams: number;
  /** Optional purity (parts per million if relevant). */
  readonly puritiePpm?: number;
  readonly collectedByActorId: string;
}

export interface ProductionReversed extends BaseEvent {
  readonly type: "production_reversed";
  /** The production event being reversed (by ledger globalSeq). */
  readonly originalGlobalSeq: number;
  readonly reason: string;
}

export interface SampleAssayed extends BaseEvent {
  readonly type: "sample_assayed";
  readonly mineralCode: string;
  readonly labReference: string;
  readonly assayPpm: number;
  readonly massSampleMicroGrams: number;
}

export interface ConsignmentSealed extends BaseEvent {
  readonly type: "consignment_sealed";
  readonly consignmentId: string;
  readonly mineralCode: string;
  readonly grossMicroGrams: number;
  readonly tamperSealRef: string;
}

export interface ConsignmentDispatched extends BaseEvent {
  readonly type: "consignment_dispatched";
  readonly consignmentId: string;
  readonly carrier: string;
  readonly destinationCustodianId: string;
  readonly bondReference?: string;
}

export interface ConsignmentReceived extends BaseEvent {
  readonly type: "consignment_received";
  readonly consignmentId: string;
  readonly receiverCustodianId: string;
  readonly tamperSealVerified: boolean;
  readonly weightOnReceiptMicroGrams: number;
}

export interface RoyaltyAssessed extends BaseEvent {
  readonly type: "royalty_assessed";
  readonly mineralCode: string;
  readonly baseValueMinor: number;
  readonly currency: string;
  readonly ratePercent: number;
  readonly royaltyMinor: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface RoyaltyPaid extends BaseEvent {
  readonly type: "royalty_paid";
  readonly amountMinor: number;
  readonly currency: string;
  readonly regulator: "PCCB" | "NEMC" | "EITI" | "other";
  readonly receiptReference: string;
}

export interface PayoutScheduled extends BaseEvent {
  readonly type: "payout_scheduled";
  readonly beneficiaryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly dueDate: string; // ISO date
  readonly basis: "shift" | "production" | "royalty-share" | "bonus";
}

export interface PayoutDisbursed extends BaseEvent {
  readonly type: "payout_disbursed";
  readonly beneficiaryId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly channel: "m-pesa" | "tigo-pesa" | "bank-transfer" | "cash" | "agent";
  readonly externalReference?: string;
}

export interface PayoutReversed extends BaseEvent {
  readonly type: "payout_reversed";
  readonly originalGlobalSeq: number;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string;
}

export interface IncidentLogged extends BaseEvent {
  readonly type: "incident_logged";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly category: "safety" | "environmental" | "compliance" | "operational";
  readonly description: string;
}

export interface IncidentResolved extends BaseEvent {
  readonly type: "incident_resolved";
  readonly resolverActorId: string;
  readonly resolutionNotes: string;
}

export interface OperationClosed extends BaseEvent {
  readonly type: "operation_closed";
  readonly closureReason:
    | "shift_complete"
    | "consignment_settled"
    | "operation_suspended"
    | "regulator_action";
}

export type MiningEvent =
  | ShiftStarted
  | ShiftPaused
  | ShiftResumed
  | ShiftEnded
  | ProductionRecorded
  | ProductionReversed
  | SampleAssayed
  | ConsignmentSealed
  | ConsignmentDispatched
  | ConsignmentReceived
  | RoyaltyAssessed
  | RoyaltyPaid
  | PayoutScheduled
  | PayoutDisbursed
  | PayoutReversed
  | IncidentLogged
  | IncidentResolved
  | OperationClosed;

export const MINING_EVENT_TYPES: ReadonlyArray<MiningEventType> = [
  "shift_started",
  "shift_paused",
  "shift_resumed",
  "shift_ended",
  "production_recorded",
  "production_reversed",
  "sample_assayed",
  "consignment_sealed",
  "consignment_dispatched",
  "consignment_received",
  "royalty_assessed",
  "royalty_paid",
  "payout_scheduled",
  "payout_disbursed",
  "payout_reversed",
  "incident_logged",
  "incident_resolved",
  "operation_closed",
];
