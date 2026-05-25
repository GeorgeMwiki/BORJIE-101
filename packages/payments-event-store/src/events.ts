/**
 * Event types — scoped to the CRITICAL payment paths (rent + arrears).
 * Out of scope this pass: deposits, refunds, water/electric, service
 * fees. Those follow later once this base proves out in live test.
 */

export interface BaseEvent {
  readonly type: string;
  readonly occurredAt: string; // ISO-8601
}

/** Rent has become due for a tenant (lease cycle). */
export interface RentDueRecorded extends BaseEvent {
  readonly type: "rent.due.recorded";
  readonly leaseId: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly dueDate: string;
}

/** Tenant kicked off a payment (e.g. M-Pesa STK push initiated). */
export interface PaymentInitiated extends BaseEvent {
  readonly type: "payment.initiated";
  readonly leaseId: string;
  readonly providerRef: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly provider: "mpesa" | "stripe" | "bank-transfer";
}

/** Provider confirmed the payment. Money is in transit / settled. */
export interface PaymentConfirmed extends BaseEvent {
  readonly type: "payment.confirmed";
  readonly leaseId: string;
  readonly providerRef: string;
  readonly amountCents: number;
  readonly currency: string;
}

/** Payment failed at the provider. */
export interface PaymentFailed extends BaseEvent {
  readonly type: "payment.failed";
  readonly leaseId: string;
  readonly providerRef: string;
  readonly failureCode: string;
  readonly failureMessage: string;
}

/** A due rent has aged past grace period; arrears now apply. */
export interface ArrearsAccrued extends BaseEvent {
  readonly type: "arrears.accrued";
  readonly leaseId: string;
  readonly arrearsCents: number;
  readonly currency: string;
  readonly fromDueDate: string;
}

/** Operator wrote off / forgave the arrears (rare; requires approval). */
export interface ArrearsForgiven extends BaseEvent {
  readonly type: "arrears.forgiven";
  readonly leaseId: string;
  readonly forgivenCents: number;
  readonly currency: string;
  readonly approvedBy: string;
  readonly reason: string;
}

/** Confirmed payment was reconciled against the due rent + arrears. */
export interface RentReconciled extends BaseEvent {
  readonly type: "rent.reconciled";
  readonly leaseId: string;
  readonly paidCents: number;
  readonly currency: string;
  readonly remainingArrearsCents: number;
}

/** Discriminated union — exhaustive switches lean on this. */
export type PaymentEvent =
  | RentDueRecorded
  | PaymentInitiated
  | PaymentConfirmed
  | PaymentFailed
  | ArrearsAccrued
  | ArrearsForgiven
  | RentReconciled;

export type PaymentEventType = PaymentEvent["type"];
