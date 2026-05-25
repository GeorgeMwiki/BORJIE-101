/**
 * Anomaly + opportunity event contracts.
 *
 * Detectors are pure functions: `detect(input): AnomalyEvent[]`. They
 * never touch I/O. The tick-runner is the only piece allowed to write
 * detected events to the entity-store.
 */

export type AnomalyKind =
  | 'cashflow-dip'
  | 'arrears-spike'
  | 'churn-risk'
  | 'cost-anomaly'
  | 'slo-breach'
  | 'compliance-deadline-near'
  | 'vendor-reliability-drop';

export type OpportunityKind =
  | 'vendor-rate-arbitrage'
  | 'policy-tightening'
  | 'rent-vs-market';

/**
 * Confidence band. Detectors emit a numeric score in [0,1] and a label.
 * The composer uses the score for ranking; the label is for owner-facing
 * copy.
 */
export type Confidence =
  | { readonly label: 'low'; readonly score: number }
  | { readonly label: 'medium'; readonly score: number }
  | { readonly label: 'high'; readonly score: number };

/**
 * Severity tier. P0 = act-now (cash shortfall in 7d), P3 = nice-to-know.
 * The notification adapter routes P0/P1 to chat, P2 to digest, P3 to
 * weekly review.
 */
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export interface DetectorEventBase {
  readonly tenantId: string | null;
  /** `null` tenantId == platform-internal (HQ-admin scope). */
  readonly scope: 'tenant' | 'platform-internal';
  readonly detectedAt: string;
  readonly confidence: Confidence;
  readonly severity: Severity;
  /** Human-facing one-liner. The composer expands it into ag-ui copy. */
  readonly headline: string;
  /** Optional structured payload — detector-specific. */
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface AnomalyEvent extends DetectorEventBase {
  readonly type: 'anomaly';
  readonly kind: AnomalyKind;
  /** Stable id within (tenantId, kind) so re-detection is idempotent. */
  readonly id: string;
}

export interface OpportunityEvent extends DetectorEventBase {
  readonly type: 'opportunity';
  readonly kind: OpportunityKind;
  readonly id: string;
  /** Projected USD-cents impact over horizon — composer surfaces this. */
  readonly projectedImpactUsdCents: number;
}

export type DetectorEvent = AnomalyEvent | OpportunityEvent;
