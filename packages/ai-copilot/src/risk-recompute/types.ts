/**
 * Risk-Recompute types — Wave 27 (Part B.6 amplification).
 *
 * Event-driven risk score recomputation. Today credit-rating +
 * property-grade + vendor-scorecard + churn-probability are all
 * scheduled batches. This module flips them to event-driven: every
 * relevant event (payment/missed-payment/lease-signed/case-opened/
 * inspection-completed/message-received) triggers an async recompute
 * of affected risk scores for the affected entities.
 *
 * Design principles:
 *   - Idempotent: the same job emitted twice is safe (job key = entity
 *     kind + id + event id).
 *   - Non-blocking: dispatcher returns immediately; actual recompute
 *     happens out-of-band.
 *   - Fail-soft: a throwing recompute fn must not tear down the event
 *     publisher. The dispatcher swallows + reports via telemetry.
 *   - Observable: every dispatch emits a telemetry event with kind,
 *     entity, trigger event id, and elapsed ms.
 */

export type RiskKind =
  | 'credit_rating'
  | 'property_grade'
  | 'vendor_scorecard'
  | 'churn_probability'
  | 'tenant_sentiment';

export const RISK_KINDS: readonly RiskKind[] = [
  'credit_rating',
  'property_grade',
  'vendor_scorecard',
  'churn_probability',
  'tenant_sentiment',
] as const;

/**
 * A queued recompute job. `entityId` is the subject the score is
 * computed against:
 *   - credit_rating      → customerId (tenant-of-property / lessee)
 *   - property_grade     → propertyId
 *   - vendor_scorecard   → vendorId
 *   - churn_probability  → customerId
 *   - tenant_sentiment   → customerId
 */
export interface RiskComputeJob {
  readonly tenantId: string;
  readonly kind: RiskKind;
  readonly entityId: string;
  readonly triggerEventId: string;
  readonly triggerEventType: string;
  readonly enqueuedAt: string;
}

export interface RiskDispatchResult {
  readonly jobsDispatched: number;
  readonly failures: ReadonlyArray<{
    readonly kind: RiskKind;
    readonly entityId: string;
    readonly reason: string;
  }>;
}

/** Per-kind compute function the dispatcher invokes. */
export type RiskComputeFn = (job: RiskComputeJob) => Promise<void>;

/** Registry: `kind → compute fn` map. */
export type RiskComputeRegistry = {
  readonly [K in RiskKind]?: RiskComputeFn;
};

/**
 * Classifier: from a domain event type + payload, decide which risk
 * kinds + entity ids should be recomputed. Return `[]` to skip.
 */
export interface RiskTriggerMatch {
  readonly kind: RiskKind;
  readonly entityId: string;
}

export type RiskEventClassifier = (
  eventType: string,
  payload: Record<string, unknown>,
) => readonly RiskTriggerMatch[];

export interface RiskDispatcherTelemetry {
  readonly tickAt: string;
  readonly kind: RiskKind;
  readonly entityId: string;
  readonly triggerEventId: string;
  readonly triggerEventType: string;
  readonly outcome: 'ok' | 'error';
  readonly durationMs: number;
  readonly errorMessage?: string;
}
