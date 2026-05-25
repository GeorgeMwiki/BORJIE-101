/**
 * Recommendation types — the composer's output entities.
 *
 * A `Recommendation` is what the chat-workspace renders. It wraps a
 * detected anomaly/opportunity with: human-facing copy, a
 * `suggestedAction` (what the owner is being asked to approve), an
 * `approvalAsk` (the one-line "want me to do it?" question), and a
 * pre-rendered `agUiPart` (the ApprovalDialog spec the FW-B2 hardened
 * ag-ui consumes inline).
 *
 * Discriminated union — `kind` matches detector kinds so the type
 * system catches missing composer arms when we add a new detector.
 */
import type {
  AnomalyKind,
  OpportunityKind,
  Confidence,
  Severity,
} from '../contracts/events.js';

/**
 * Pre-rendered ag-ui part. We keep the shape minimal here — full
 * ApprovalDialog schema lives in @borjie/genui; this is the
 * subset J5 emits. Downstream rendering will widen this.
 */
export interface AgUiApprovalDialogPart {
  readonly kind: 'ag-ui.ApprovalDialog.v1';
  readonly title: string;
  readonly body: string;
  readonly approveLabel: string;
  readonly declineLabel: string;
  /** Stable correlation id; the chat-workspace ties approvals back to this. */
  readonly correlationId: string;
  /** Optional ETA hint ("3 minutes", "next business day"). */
  readonly estimatedDuration?: string;
}

export interface RecommendationBase {
  readonly id: string;
  readonly tenantId: string | null;
  readonly scope: 'tenant' | 'platform-internal';
  readonly confidence: Confidence;
  readonly severity: Severity;
  readonly projectedImpactUsdCents: number; // 0 if non-monetary
  readonly suggestedAction: string; // e.g. "Send STK push reminders to top 5 arrears tenants"
  readonly approvalAsk: string; // e.g. "Want me to do it?"
  readonly summary: string; // owner-facing one-liner
  readonly agUiPart: AgUiApprovalDialogPart;
  readonly createdAt: string;
  /** Pointer back to the originating detector event. */
  readonly sourceEventId: string;
}

export interface AnomalyRecommendation extends RecommendationBase {
  readonly type: 'anomaly';
  readonly kind: AnomalyKind;
}

export interface OpportunityRecommendation extends RecommendationBase {
  readonly type: 'opportunity';
  readonly kind: OpportunityKind;
}

export type Recommendation = AnomalyRecommendation | OpportunityRecommendation;
